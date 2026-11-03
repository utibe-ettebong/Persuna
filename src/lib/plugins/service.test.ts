import { beforeEach, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { audit } from "@/lib/audit";
import type { ModelClient } from "@/lib/models/gateway";
import { draftGrounded } from "@/lib/skill/engine";
import { trainingPairs } from "@/lib/skill/service";
import { applySkillForKey } from "./service";

process.env.DATABASE_URL ??= "postgres://localhost:5432/persuna_test";

vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  db: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/skill/service", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  trainingPairs: vi.fn(),
}));
vi.mock("@/lib/skill/engine", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  draftGrounded: vi.fn(),
}));

const KEY = { userId: "user-1", agentName: "docs-addon" };
const client = {} as ModelClient;

const stubDb = (skill: unknown, version: unknown) => {
  vi.mocked(db).mockReturnValue({
    query: {
      skills: { findFirst: async () => skill },
      skillVersions: { findFirst: async () => version },
    },
  } as never);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(trainingPairs).mockResolvedValue([]);
  vi.mocked(draftGrounded).mockResolvedValue({ draft: "edited text" } as never);
});

it("applies a published skill and audits ids only", async () => {
  stubDb({ id: "skill-1", slug: "brief", publishedVersionId: "v1" }, { id: "v1", sheet: {} });
  const result = await applySkillForKey(client, KEY, "brief", "raw text", { source: "docs" });
  expect(result).toEqual({ ok: true, edits: [{ op: "replace_selection", text: "edited text" }] });
  expect(vi.mocked(draftGrounded).mock.calls[0]?.[3]).toBe("raw text");
  const [first] = vi.mocked(audit).mock.calls;
  expect(first?.[0]).toMatchObject({
    actor: "agent:docs-addon",
    action: "plugin.run",
    entityType: "skill",
    entityId: "skill-1",
  });
  expect(JSON.stringify(first?.[0])).not.toContain("raw text");
});

it("prepends the instruction and honours the edit mode", async () => {
  stubDb({ id: "skill-1", slug: "brief", publishedVersionId: "v1" }, { id: "v1", sheet: {} });
  const result = await applySkillForKey(client, KEY, "brief", "raw", {
    instruction: "Shorten",
    mode: "append",
  });
  expect(result).toEqual({ ok: true, edits: [{ op: "append", text: "edited text" }] });
  expect(vi.mocked(draftGrounded).mock.calls[0]?.[3]).toBe("Shorten\n\nraw");
});

it("404s an unknown skill", async () => {
  stubDb(undefined, undefined);
  const result = await applySkillForKey(client, KEY, "missing", "raw");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.status).toBe(404);
  expect(audit).not.toHaveBeenCalled();
});

it("422s an unpublished skill or a missing version", async () => {
  stubDb({ id: "skill-1", slug: "drafty", publishedVersionId: null }, undefined);
  const unpublished = await applySkillForKey(client, KEY, "drafty", "raw");
  expect(unpublished.ok).toBe(false);
  if (!unpublished.ok) expect(unpublished.status).toBe(422);

  stubDb({ id: "skill-1", slug: "brief", publishedVersionId: "v1" }, undefined);
  const missing = await applySkillForKey(client, KEY, "brief", "raw");
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.status).toBe(422);
});
