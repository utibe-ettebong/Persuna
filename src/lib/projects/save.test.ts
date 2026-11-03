import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { audit } from "@/lib/audit";
import { accessTokenFor } from "@/lib/connections/service";
import { saveMilestoneFile } from "./service";

process.env.DATABASE_URL ??= "postgres://localhost:5432/persuna_test";

vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  db: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/connections/service", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  accessTokenFor: vi.fn(),
}));

const USER = { id: "poster-1", name: "Pam", email: "pam@example.com", isAdmin: false };

function stubDb(milestone: Record<string, unknown>, project: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  vi.mocked(db).mockReturnValue({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({ where: async () => [{ milestone, project }] }),
          where: async () => [{ milestone, project }],
        }),
        where: async () => [{ milestone, project }],
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        updates.push(vals);
        return { where: async () => [] };
      },
    }),
  } as never);
  return { updates };
}

const milestone = (overrides: Record<string, unknown> = {}) => ({
  id: "ms-1",
  projectId: "pr-1",
  position: 1,
  title: "Draft",
  delivery: "# Report\n\nShipped.",
  savedFiles: [],
  ...overrides,
});
const project = (overrides: Record<string, unknown> = {}) => ({
  id: "pr-1",
  posterId: "poster-1",
  title: "Website",
  status: "in_progress",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accessTokenFor).mockResolvedValue("tok-poster");
});

describe("saveMilestoneFile", () => {
  it("renders the delivery and saves it to the poster's Drive", async () => {
    const { updates } = stubDb(milestone(), project());
    const seen: string[] = [];
    const fetchFn = (async (url: string) => {
      seen.push(String(url));
      return Response.json({
        id: "f1",
        name: "Website - Draft.docx",
        webViewLink: "https://drive/x",
      });
    }) as unknown as typeof fetch;
    const saved = await saveMilestoneFile(
      USER,
      "ms-1",
      { provider: "drive", format: "docx" },
      fetchFn,
    );
    expect(saved).toEqual({ id: "f1", name: "Website - Draft.docx", link: "https://drive/x" });
    expect(seen[0]).toContain("upload/drive/v3/files");
    expect(accessTokenFor).toHaveBeenCalledWith("poster-1", "google");
    expect(updates[0].savedFiles).toEqual([
      {
        provider: "drive",
        name: "Website - Draft.docx",
        link: "https://drive/x",
        savedAt: expect.any(String),
      },
    ]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "milestone.file_saved",
        details: { provider: "drive", name: "Website - Draft.docx" },
      }),
    );
  });

  it("saves to OneDrive with the poster's Microsoft token", async () => {
    stubDb(milestone(), project());
    const fetchFn = (async (url: string) => {
      expect(String(url)).toContain("graph.microsoft.com");
      return Response.json({ id: "o1", name: "Website - Draft.pdf", webUrl: "https://one/x" });
    }) as unknown as typeof fetch;
    const saved = await saveMilestoneFile(
      USER,
      "ms-1",
      { provider: "onedrive", format: "pdf" },
      fetchFn,
    );
    expect(saved.link).toBe("https://one/x");
    expect(accessTokenFor).toHaveBeenCalledWith("poster-1", "microsoft");
  });

  it("refuses non-posters and empty deliveries", async () => {
    stubDb(milestone(), project());
    const fetchFn = (async () => Response.json({})) as unknown as typeof fetch;
    await expect(
      saveMilestoneFile(
        { ...USER, id: "stranger" },
        "ms-1",
        { provider: "drive", format: "docx" },
        fetchFn,
      ),
    ).rejects.toThrow(/No such project/);
    stubDb(milestone({ delivery: null }), project());
    await expect(
      saveMilestoneFile(USER, "ms-1", { provider: "drive", format: "docx" }, fetchFn),
    ).rejects.toThrow(/Nothing delivered/);
  });
});
