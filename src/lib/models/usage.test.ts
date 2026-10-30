import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelClient } from "./gateway";
import { meteredClient } from "./usage";

vi.mock("@/db/client", () => ({
  db: () => ({ insert: () => ({ values: async () => {} }) }),
  schema: { modelUsage: {} },
}));

const admin = { id: "admin", isAdmin: true };

beforeEach(() => {
  process.env.DATABASE_URL ??= "postgres://test";
});

const collectStream = async (client: ModelClient) => {
  const run = meteredClient(client, admin).completeStream;
  if (!run) throw new Error("metered client must stream");
  const chunks: string[] = [];
  for await (const chunk of run("draft", [])) chunks.push(chunk);
  return chunks;
};

describe("meteredClient streams", () => {
  it("passes streamed chunks through", async () => {
    const client: ModelClient = {
      async complete() {
        throw new Error("should stream, not complete");
      },
      async *completeStream() {
        yield "Hel";
        yield "lo";
      },
    };

    await expect(collectStream(client)).resolves.toEqual(["Hel", "lo"]);
  });

  it("reads one chunk from clients without streams", async () => {
    const client: ModelClient = {
      async complete() {
        return { text: "whole", model: "m", promptTokens: 1, completionTokens: 1 };
      },
    };

    await expect(collectStream(client)).resolves.toEqual(["whole"]);
  });
});
