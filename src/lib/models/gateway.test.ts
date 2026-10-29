import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGateway, ModelError } from "./gateway";

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
