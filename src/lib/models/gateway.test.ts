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
});
