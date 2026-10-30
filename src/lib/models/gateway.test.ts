import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRole } from "@/env";
import { createGateway, ModelError, type ChatMessage, type ModelClient } from "./gateway";

const config = { baseUrl: "https://models.example/v1/", apiKey: "k", model: "m" };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const reply = {
  model: "served-model",
  choices: [{ message: { content: "hello" } }],
  usage: { prompt_tokens: 3, completion_tokens: 2 },
};

beforeEach(() => {
  vi.useFakeTimers();
  process.env.DATABASE_URL ??= "postgres://test";
});
afterEach(() => vi.useRealTimers());

describe("createGateway", () => {
  it("posts an OpenAI-style request and maps the reply", async () => {
    const fetchImpl = vi.fn(async () => ok(reply));
    const client = createGateway(() => config, fetchImpl as typeof fetch);
    const result = await client.complete("draft", [{ role: "user", content: "hi" }]);

    expect(result).toEqual({
      text: "hello",
      model: "served-model",
      promptTokens: 3,
      completionTokens: 2,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://models.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "m", temperature: 0 });
  });

  it("retries rate limits, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(ok(reply));
    const client = createGateway(() => config, fetchImpl as typeof fetch);
    const pending = client.complete("evaluate", []);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ text: "hello" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad key", { status: 401 }));
    const client = createGateway(() => config, fetchImpl as typeof fetch);
    await expect(client.complete("extract", [])).rejects.toBeInstanceOf(ModelError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("redoes a call on EXTRACT when a role's key is rejected, and keeps doing so for a while", async () => {
    const meta = { baseUrl: "https://meta.example/v1", apiKey: "good", model: "muse" };
    const baseten = { baseUrl: "https://baseten.example/v1", apiKey: "revoked", model: "open" };
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith("https://baseten")
        ? new Response('{"error":"please check the api-key you provided"}', { status: 403 })
        : ok(reply),
    );
    const client = createGateway(
      (role) => (role === "extract" ? meta : baseten),
      fetchImpl as unknown as typeof fetch,
    );
    await expect(client.complete("draft", [])).resolves.toMatchObject({ text: "hello" });
    await client.complete("draft", []);
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      "https://baseten.example/v1/chat/completions",
      "https://meta.example/v1/chat/completions",
      "https://meta.example/v1/chat/completions",
    ]);
  });

  it("still fails when EXTRACT itself is the rejected provider", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 403 }));
    const client = createGateway(() => config, fetchImpl as typeof fetch);
    await expect(client.complete("draft", [])).rejects.toMatchObject({ keyRejected: true });
  });

  it("gives a thinking model more room when it used the whole budget thinking", async () => {
    const empty = {
      choices: [{ message: { content: "" }, finish_reason: "length" }],
      usage: { completion_tokens: 1024 },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok(empty)).mockResolvedValueOnce(ok(reply));
    const client = createGateway(() => config, fetchImpl as typeof fetch);
    const result = await client.complete("draft", [], { maxTokens: 1024 });
    expect(result.text).toBe("hello");
    const budgets = fetchImpl.mock.calls.map(
      (c) => JSON.parse((c[1] as RequestInit).body as string).max_tokens,
    );
    expect(budgets).toEqual([1024, 3072]);
    expect(result.completionTokens).toBe(1024 + 2);
  });

  it("does not retry a short answer that simply finished", async () => {
    const fetchImpl = vi.fn(async () =>
      ok({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
    );
    const client = createGateway(() => config, fetchImpl as typeof fetch);
    await client.complete("draft", []);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends reasoning_effort only when the role sets it", async () => {
    const fetchImpl = vi.fn(async () => ok(reply));
    await createGateway(
      () => ({ ...config, reasoningEffort: "low" }),
      fetchImpl as typeof fetch,
    ).complete("draft", []);
    await createGateway(() => config, fetchImpl as typeof fetch).complete("draft", []);
    const sent = fetchImpl.mock.calls.map((c) =>
      JSON.parse((c as unknown as [string, RequestInit])[1].body as string),
    );
    expect(sent[0].reasoning_effort).toBe("low");
    expect(sent[1]).not.toHaveProperty("reasoning_effort");
  });

  it("retries a model-not-found answer, then uses the fallback model", async () => {
    const missing = () =>
      new Response(
        '{"error":{"code":"model_not_found","message":"The requested model was not found."}}',
        {
          status: 404,
        },
      );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(missing())
      .mockResolvedValueOnce(missing())
      .mockResolvedValueOnce(ok(reply));
    const client = createGateway(
      () => ({ ...config, model: "muse-spark-1.3", fallbackModel: "muse-spark-1.2" }),
      fetchImpl as typeof fetch,
    );
    const pending = client.complete("extract", []);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ text: "hello" });
    const models = fetchImpl.mock.calls.map(
      (c) => JSON.parse((c[1] as RequestInit).body as string).model,
    );
    expect(models).toEqual(["muse-spark-1.3", "muse-spark-1.3", "muse-spark-1.2"]);
  });

  it("gives up on a missing model when no fallback is set", async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"error":{"code":"model_not_found"}}', { status: 404 }),
    );
    const client = createGateway(() => config, fetchImpl as typeof fetch);
    const pending = client.complete("extract", []).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ modelMissing: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sends a call to the DRAFT provider when Meta has no model at all, but never audio", async () => {
    const meta = { ...config, baseUrl: "https://api.meta.ai/v1", model: "muse-spark-1.3" };
    const backup = { ...config, baseUrl: "https://inference.baseten.co/v1", model: "open" };
    const resolve = (role: string) => (role === "draft" ? backup : meta);
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith("https://api.meta.ai")
        ? new Response('{"error":{"code":"model_not_found"}}', { status: 404 })
        : ok(reply),
    );
    const client = createGateway(resolve as never, fetchImpl as unknown as typeof fetch);
    const image = [
      {
        role: "user" as const,
        content: [{ type: "image_url" as const, image_url: { url: "data:," } }],
      },
    ];
    const pending = client.complete("extract", image);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ text: "hello" });
    expect(fetchImpl.mock.calls.at(-1)![0]).toMatch(/^https:\/\/inference\.baseten\.co/);

    const audio = [
      {
        role: "user" as const,
        content: [
          { type: "input_audio" as const, input_audio: { data: "x", format: "wav" as const } },
        ],
      },
    ];
    const spoken = client.complete("listen", audio).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await spoken).toMatchObject({ modelMissing: true });
  });

  it("asks again without the reasoning setting when the fallback model refuses it", async () => {
    const missing = () => new Response('{"error":{"code":"model_not_found"}}', { status: 404 });
    const noMax = new Response(
      `{"error":{"message":"reasoning_effort 'max' is not supported for model 'muse-spark-1.2'."}}`,
      { status: 400 },
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(missing())
      .mockResolvedValueOnce(missing())
      .mockResolvedValueOnce(noMax)
      .mockResolvedValueOnce(ok(reply));
    const client = createGateway(
      () => ({
        ...config,
        model: "muse-spark-1.3",
        fallbackModel: "muse-spark-1.2",
        reasoningEffort: "max" as const,
      }),
      fetchImpl as typeof fetch,
    );
    const pending = client.complete("extract", []);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ text: "hello" });
    const sent = fetchImpl.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(sent.map((b) => [b.model, b.reasoning_effort ?? null])).toEqual([
      ["muse-spark-1.3", "max"],
      ["muse-spark-1.3", "max"],
      ["muse-spark-1.2", "max"],
      ["muse-spark-1.2", null],
    ]);
  });

  it("doesn't drop the setting for other 400 errors", async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"error":{"message":"messages is required"}}', { status: 400 }),
    );
    const client = createGateway(
      () => ({ ...config, reasoningEffort: "max" as const }),
      fetchImpl as typeof fetch,
    );
    await expect(client.complete("extract", [])).rejects.toBeInstanceOf(ModelError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks for the least reasoning when the call wants none, rather than the model's default", async () => {
    const fetchImpl = vi.fn(async () => ok(reply));
    const client = createGateway(
      () => ({ ...config, reasoningEffort: "max" as const }),
      fetchImpl as typeof fetch,
    );
    await client.complete("draft", [], { reasoningOff: true });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).reasoning_effort).toBe("minimal");
  });

  it("drops the least-reasoning ask if the provider refuses it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":{"message":"reasoning_effort is not supported"}}', { status: 400 }),
      )
      .mockResolvedValueOnce(ok(reply));
    const client = createGateway(() => config, fetchImpl as typeof fetch);
    await client.complete("draft", [], { reasoningOff: true });

    const sent = fetchImpl.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(sent[0].reasoning_effort).toBe("minimal");
    expect(sent[1]).not.toHaveProperty("reasoning_effort");
  });

  it("asks for JSON mode when told to, and drops it if the provider refuses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":{"message":"response_format json_object is not supported"}}', {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(ok(reply));
    const client = createGateway(() => config, fetchImpl as typeof fetch);
    await expect(client.complete("draft", [], { json: true })).resolves.toMatchObject({
      text: "hello",
    });
    const sent = fetchImpl.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(sent[0].response_format).toEqual({ type: "json_object" });
    expect(sent[1]).not.toHaveProperty("response_format");
  });
});

const sse = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
const event = (delta: unknown, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`;
const DONE = "data: [DONE]\n\n";
/** An SSE body delivered in awkward pieces, splitting mid-line and mid-event. */
const splitStream = (parts: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
const collect = async (stream: AsyncGenerator<string>) => {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
};
const collectStream = (client: ModelClient, role: ModelRole, messages: ChatMessage[]) => {
  if (!client.completeStream) throw new Error("test client must stream");
  return collect(client.completeStream(role, messages));
};
const sentBodies = (fetchImpl: ReturnType<typeof vi.fn>) =>
  fetchImpl.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));

describe("completeStream", () => {
  it("asks for a stream and yields each text delta", async () => {
    const fetchImpl = vi.fn(async () =>
      sse(`${event({ content: "Hel" })}${event({ content: "lo" })}${DONE}`),
    );
    const client = createGateway(() => config, fetchImpl as typeof fetch);
    const chunks = await collectStream(client, "draft", [{ role: "user", content: "hi" }]);

    expect(chunks).toEqual(["Hel", "lo"]);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ stream: true });
  });

  it("reassembles events split across reads", async () => {
    const body = `${event({ content: "Hello" })}${event({ content: " there" })}${DONE}`;
    const fetchImpl = vi.fn(async () =>
      splitStream([body.slice(0, 17), body.slice(17, 41), body.slice(41)]),
    );
    const client = createGateway(() => config, fetchImpl as typeof fetch);

    await expect(collectStream(client, "draft", [])).resolves.toEqual(["Hello", " there"]);
  });

  it("drops reasoning deltas and stops at [DONE]", async () => {
    const fetchImpl = vi.fn(async () =>
      sse(
        `${event({ content: "Hi", reasoning_content: "secret plan" })}${event({ reasoning: "more thinking" })}${DONE}${event({ content: "late" })}`,
      ),
    );
    const client = createGateway(() => config, fetchImpl as typeof fetch);

    await expect(collectStream(client, "draft", [])).resolves.toEqual(["Hi"]);
  });

  it("reads a lone event with no trailing blank line", async () => {
    const fetchImpl = vi.fn(async () => sse(event({ content: "solo" }).trimEnd()));
    const client = createGateway(() => config, fetchImpl as typeof fetch);

    await expect(collectStream(client, "draft", [])).resolves.toEqual(["solo"]);
  });

  it("yields one chunk when the provider answers without SSE", async () => {
    const fetchImpl = vi.fn(async () => ok(reply));
    const client = createGateway(() => config, fetchImpl as typeof fetch);

    await expect(collectStream(client, "draft", [])).resolves.toEqual(["hello"]);
  });

  it("retries without the stream flag when the provider refuses it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":{"message":"stream is not supported for this model"}}', {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(ok(reply));
    const client = createGateway(() => config, fetchImpl as typeof fetch);

    await expect(collectStream(client, "draft", [])).resolves.toEqual(["hello"]);
    const sent = sentBodies(fetchImpl);
    expect(sent).toHaveLength(2);
    expect(sent[0].stream).toBe(true);
    expect(sent[1]).not.toHaveProperty("stream");
  });

  it("retries rate limits before the first token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(sse(`${event({ content: "hi" })}${DONE}`));
    const client = createGateway(() => config, fetchImpl as typeof fetch);
    const pending = collectStream(client, "draft", []);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual(["hi"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("surfaces mid-stream errors without retrying", async () => {
    const fetchImpl = vi.fn(async () =>
      sse(
        `${event({ content: "hi" })}data: ${JSON.stringify({ error: { message: "cut off" } })}\n\n`,
      ),
    );
    const client = createGateway(() => config, fetchImpl as typeof fetch);

    await expect(collectStream(client, "draft", [])).rejects.toMatchObject({
      name: "ModelError",
      keyRejected: false,
      modelMissing: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("restarts roomier when the stream ends empty at the length limit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(sse(event({}, "length")))
      .mockResolvedValueOnce(sse(`${event({ content: "finally" })}${DONE}`));
    const client = createGateway(() => config, fetchImpl as typeof fetch);

    await expect(collectStream(client, "draft", [])).resolves.toEqual(["finally"]);
    const sent = sentBodies(fetchImpl);
    expect(sent).toHaveLength(2);
    expect(sent[0].max_tokens).toBe(4096);
    expect(sent[1].max_tokens).toBe(4096 * 3);
  });

  it("skips reasoning in streams when the call asks for none", async () => {
    const fetchImpl = vi.fn(async () => sse(`${event({ content: "hi" })}${DONE}`));
    const client = createGateway(
      () => ({ ...config, reasoningEffort: "max" as const }),
      fetchImpl as typeof fetch,
    );
    if (!client.completeStream) throw new Error("test client must stream");
    const chunks: string[] = [];
    for await (const chunk of client.completeStream("draft", [], { reasoningOff: true })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["hi"]);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).reasoning_effort).toBe("minimal");
  });

  it("drops the least-reasoning ask from a stream if the provider refuses it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":{"message":"reasoning_effort is not supported"}}', { status: 400 }),
      )
      .mockResolvedValueOnce(sse(`${event({ content: "hi" })}${DONE}`));
    const client = createGateway(() => config, fetchImpl as typeof fetch);
    if (!client.completeStream) throw new Error("test client must stream");
    const chunks = await collect(client.completeStream("draft", [], { reasoningOff: true }));

    expect(chunks).toEqual(["hi"]);
    const sent = sentBodies(fetchImpl);
    expect(sent[0].reasoning_effort).toBe("minimal");
    expect(sent[1]).not.toHaveProperty("reasoning_effort");
  });

  it("retries without reasoning_effort when the provider refuses it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":{"message":"reasoning_effort is not supported"}}', { status: 400 }),
      )
      .mockResolvedValueOnce(sse(`${event({ content: "hi" })}${DONE}`));
    const client = createGateway(
      () => ({ ...config, reasoningEffort: "max" as const }),
      fetchImpl as typeof fetch,
    );

    await expect(collectStream(client, "extract", [])).resolves.toEqual(["hi"]);
    const sent = sentBodies(fetchImpl);
    expect(sent[0].reasoning_effort).toBe("max");
    expect(sent[1]).not.toHaveProperty("reasoning_effort");
  });

  it("falls back to the next model when the first is missing", async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"error":{"message":"model_not_found"}}', { status: 404 }),
    );
    const client = createGateway(
      () => ({ ...config, fallbackModel: "backup" }),
      fetchImpl as typeof fetch,
    );
    const pending = collectStream(client, "draft", []);
    const assertion = expect(pending).rejects.toMatchObject({ modelMissing: true });
    await vi.runAllTimersAsync();
    await assertion;
    const sent = sentBodies(fetchImpl);
    expect(sent.map((b) => b.model)).toEqual(["m", "m", "backup"]);
  });

  it("streams from the DRAFT provider when Meta has no model at all, but never audio", async () => {
    const meta = { ...config, baseUrl: "https://api.meta.ai/v1", model: "muse-spark-1.3" };
    const backup = {
      ...config,
      baseUrl: "https://inference.baseten.co/v1",
      model: "open",
      reasoningEffort: "low",
    };
    const resolve = (role: string) => (role === "draft" ? backup : meta);
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith("https://api.meta.ai")
        ? new Response('{"error":{"code":"model_not_found"}}', { status: 404 })
        : sse(`${event({ content: "hello" })}${DONE}`),
    );
    const client = createGateway(resolve as never, fetchImpl as unknown as typeof fetch);
    const image: ChatMessage[] = [
      { role: "user", content: [{ type: "image_url", image_url: { url: "data:," } }] },
    ];
    const pending = collectStream(client, "listen", image);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual(["hello"]);
    expect(fetchImpl.mock.calls.at(-1)![0]).toMatch(/^https:\/\/inference\.baseten\.co/);
    expect(sentBodies(fetchImpl).at(-1)).not.toHaveProperty("reasoning_effort");

    const audio: ChatMessage[] = [
      {
        role: "user",
        content: [{ type: "input_audio", input_audio: { data: "x", format: "wav" } }],
      },
    ];
    const spoken = collectStream(client, "listen", audio).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await spoken).toMatchObject({ modelMissing: true });
  });

  it("falls back to EXTRACT on a rejected key, then keeps using it", async () => {
    const meta = { baseUrl: "https://stream-meta.example/v1", apiKey: "good", model: "muse" };
    const baseten = {
      baseUrl: "https://stream-baseten.example/v1",
      apiKey: "revoked",
      model: "open",
    };
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith("https://stream-baseten")
        ? new Response("revoked", { status: 403 })
        : sse(`${event({ content: "hi" })}${DONE}`),
    );
    const client = createGateway(
      (role) => (role === "extract" ? meta : baseten),
      fetchImpl as unknown as typeof fetch,
    );

    await expect(collectStream(client, "draft", [])).resolves.toEqual(["hi"]);
    await collectStream(client, "draft", []);
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      "https://stream-baseten.example/v1/chat/completions",
      "https://stream-meta.example/v1/chat/completions",
      "https://stream-meta.example/v1/chat/completions",
    ]);
  });
});
