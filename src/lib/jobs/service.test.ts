import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRole } from "@/env";
import { db } from "@/db/client";
import {
  appConnections,
  jobApprovals,
  jobConnections,
  jobRounds,
  jobs,
  mcpServers,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { accessTokenFor } from "@/lib/connections/service";
import { listMcpServers, mcpServerClient } from "@/lib/mcp/service";
import type { ChatMessage, ModelClient } from "@/lib/models/gateway";
import { trainingPairs } from "@/lib/skill/service";
import {
  decideJobApproval,
  openJob,
  openTrial,
  reviewJob,
  runJobTools,
  trustRecord,
} from "@/lib/jobs/service";
import { linkJobConnection as linkConnection, setJobToolPolicy as setPolicy } from "./tools";

process.env.DATABASE_URL ??= "postgres://localhost:5432/persuna_test";
process.env.CONNECTIONS_KEY ??= "test-connections-key-0123456789abcdef";

vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  db: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/connections/service", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  accessTokenFor: vi.fn(),
}));
vi.mock("@/lib/mcp/service", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  listMcpServers: vi.fn(),
  mcpServerClient: vi.fn(),
}));
vi.mock("@/lib/skill/service", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  trainingPairs: vi.fn(),
}));

/** Scripted model replies per role. */
function fakeClient(replies: Partial<Record<ModelRole, string[]>>) {
  const calls: { role: ModelRole; messages: ChatMessage[] }[] = [];
  const client: ModelClient = {
    async complete(role, messages) {
      calls.push({ role, messages });
      const next = replies[role]?.shift();
      if (next === undefined) throw new Error(`No scripted reply for ${role}`);
      return { text: next, model: `fake-${role}`, promptTokens: 10, completionTokens: 5 };
    },
  };
  return { client, calls };
}

const callStep = (tool: string, server: string | null, args: Record<string, unknown> = {}) =>
  JSON.stringify({ action: "call", tool, server, args });
const doneStep = (findings: string) => JSON.stringify({ action: "done", findings });

type Row = Record<string, unknown>;

interface StubState {
  job: Row;
  skill: Row;
  version: Row;
  links: Row[];
  approvals: Row[];
  rounds: Row[];
  appConns: Row[];
  mcpRows: Row[];
  trustRows: Row[];
  jobInserts: Row[];
}

const tableKey = (table: unknown): keyof StubState | null => {
  if (table === jobApprovals) return "approvals";
  if (table === jobConnections) return "links";
  if (table === jobRounds) return "rounds";
  if (table === appConnections) return "appConns";
  if (table === mcpServers) return "mcpRows";
  return null;
};

/** In-memory drizzle: live rows per table, writes applied. */
function stubDb(state: StubState) {
  const mocked = vi.mocked(db);
  mocked.mockReturnValue({
    query: {
      jobs: { findFirst: async () => state.job },
      skills: { findFirst: async () => state.skill },
      skillVersions: { findFirst: async () => state.version },
      appConnections: { findFirst: async () => ({ account: "test-account" }) },
    },
    select: () => ({
      from: (table: unknown) => {
        if (table === jobs) {
          return {
            innerJoin: () => ({
              innerJoin: () => ({
                where: async () => [{ job: state.job, skill: state.skill, version: state.version }],
              }),
            }),
            where: async () => state.trustRows,
          };
        }
        const key = tableKey(table);
        const rows = () => (key ? (state[key] as Row[]) : []);
        return {
          where: () => ({
            orderBy: () => ({ limit: async (n = 1) => rows().slice(0, n) }),
            limit: async (n = 1) => rows().slice(0, n),
            then: (resolve: (v: unknown) => void) => resolve(rows()),
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: Row) => {
        const key = tableKey(table);
        const row = { id: `${key}-${Date.now()}-${Math.random()}`, ...vals };
        if (key === "approvals" || key === "links") {
          (state[key] as Row[]).push(row);
        }
        if (table === jobs) state.jobInserts.push(vals);
        return {
          returning: async () => [{ id: row.id }],
          onConflictDoNothing: async () => [],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (vals: Row) => {
        if (table === jobs) Object.assign(state.job, vals);
        if (table === jobApprovals) {
          const target =
            state.approvals.find((a: Row) => a.status === "pending") ?? state.approvals[0];
          if (target) Object.assign(target, vals);
        }
        return {
          where: () => ({
            returning: async () => [state.job],
            then: (resolve: (v: unknown) => void) => resolve([]),
          }),
        };
      },
    }),
  } as never);
}

function baseState(overrides: Partial<StubState> = {}): StubState {
  return {
    job: {
      id: "job-1",
      skillId: "skill-1",
      skillVersionId: "v-1",
      origin: "renter",
      requesterUserId: "renter-1",
      requesterName: "Ren",
      input: "File the standup notes in Notion and open a Linear issue.",
      draft: "",
      finalOutput: null,
      status: "review",
      editSize: null,
      approvedBy: null,
      trustLevel: 0,
      flags: [],
      grounding: null,
      ownerReviewRequired: false,
      toolPolicy: { mode: "approve_each", tools: [] },
      toolCalls: [],
      toolFindings: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
    skill: { id: "skill-1", ownerId: "owner-1", trustLevel: 0 },
    version: {
      id: "v-1",
      sheet: {
        summary: "Files notes.",
        rules: [{ id: "R1", category: "structure", text: "Keep it short." }],
        template: "# Notes",
      },
    },
    links: [],
    approvals: [],
    rounds: [],
    appConns: [],
    mcpRows: [],
    trustRows: [],
    jobInserts: [],
    ...overrides,
  };
}

/** Notion behind a fetch: creates pages, finds them again by title. */
function notionFetch() {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? "GET"} ${u}`);
    if (u.endsWith("/v1/pages")) {
      return Response.json({ id: "page-1", url: "https://notion.so/page-1" });
    }
    if (u.endsWith("/v1/search")) {
      return Response.json({
        results: [
          {
            id: "page-1",
            url: "https://notion.so/page-1",
            properties: {
              title: { type: "title", title: [{ plain_text: "Standup notes" }] },
            },
          },
        ],
      });
    }
    return new Response("nope", { status: 404 });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

const LINEAR_VIEW = {
  id: "srv-1",
  name: "Linear",
  url: "https://mcp.example.com/mcp",
  authType: "oauth",
  tools: [
    { name: "create_issue", description: "Create an issue" },
    { name: "list_issues", description: "List issues" },
  ],
};

function mockLinear() {
  vi.mocked(listMcpServers).mockResolvedValue([LINEAR_VIEW] as never);
  vi.mocked(mcpServerClient).mockImplementation(
    async () =>
      ({
        client: {
          callTool: async (name: string) =>
            name === "create_issue"
              ? { text: "Created ENG-42: https://linear.app/acme/issue/ENG-42", isError: false }
              : { text: "ENG-42 https://linear.app/acme/issue/ENG-42", isError: false },
        },
        server: LINEAR_VIEW,
      }) as never,
  );
}

const CREATE_ARGS = { parent_id: "parent-123", title: "Standup notes", body: "Decided: ship it." };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accessTokenFor).mockResolvedValue("tok-renter");
  vi.mocked(trainingPairs).mockResolvedValue([]);
  vi.mocked(listMcpServers).mockResolvedValue([]);
});

describe("trustRecord", () => {
  const clean = {
    origin: "renter",
    status: "approved",
    editSize: "none",
    approvedBy: "owner",
    trustLevel: 0,
    complainedAt: null,
  };
  it("ignores trial runs, even reviewed ones on the published version", async () => {
    const state = baseState({
      skill: { id: "skill-1", publishedVersionId: "v-1" },
      trustRows: [
        clean,
        { ...clean, origin: "trial" },
        { ...clean, origin: "trial" },
        { ...clean, status: "rejected", editSize: "rejected" },
      ],
    });
    stubDb(state);
    const record = await trustRecord("skill-1");
    expect(record.reviewed).toBe(2);
    expect(record.clean).toBe(1);
    expect(record.rejected).toBe(1);
  });

  it("is empty without a published version", async () => {
    stubDb(baseState({ skill: { id: "skill-1", publishedVersionId: null }, trustRows: [{}] }));
    expect(await trustRecord("skill-1")).toMatchObject({ reviewed: 0 });
  });
});

describe("openJob", () => {
  it("opens a trial on a chosen version", async () => {
    const state = baseState({
      skill: { id: "skill-1", name: "Minutes", publishedVersionId: "v-9" },
      version: { id: "v-2" },
    });
    stubDb(state);
    await openJob({
      skillId: "skill-1",
      origin: "trial",
      requesterName: "Owner",
      requesterUserId: "owner-1",
      input: "Try the draft version.",
      versionId: "v-2",
    });
    expect(state.jobInserts).toHaveLength(1);
    expect(state.jobInserts[0]).toMatchObject({
      skillId: "skill-1",
      skillVersionId: "v-2",
      origin: "trial",
    });
  });

  it("refuses a version from another skill", async () => {
    stubDb(baseState({ skill: { id: "skill-1", name: "Minutes" }, version: undefined }));
    await expect(
      openJob({
        skillId: "skill-1",
        origin: "trial",
        requesterName: "Owner",
        input: "Try it.",
        versionId: "v-x",
      }),
    ).rejects.toThrow("isn't part of this skill");
  });
});

describe("openTrial", () => {
  it("opens a dry trial of a chosen version", async () => {
    const state = baseState({
      skill: { id: "skill-1", name: "Minutes", publishedVersionId: "v-9" },
      version: { id: "v-2" },
      job: { id: "job-1", requesterUserId: "owner-1", draft: "" },
    });
    stubDb(state);
    await openTrial(
      { id: "owner-1", name: "Owner" },
      { skillId: "skill-1", versionId: "v-2", input: "Try the draft.", dryRun: true },
      "user:owner@example.com",
    );
    expect(state.jobInserts[0]).toMatchObject({ origin: "trial", skillVersionId: "v-2" });
    expect(state.job.toolPolicy).toEqual({ mode: "approve_each", tools: [], dryRun: true });
  });

  it("locks trials out of review", async () => {
    stubDb(baseState({ job: { id: "job-1", origin: "trial", status: "review" } }));
    await expect(reviewJob("job-1", "approve")).rejects.toThrow("aren't reviewed");
  });
});

describe("runJobTools", () => {
  it("pauses on an unapproved write without running it", async () => {
    const state = baseState({ links: [{ kind: "app", ref: "notion" }] });
    stubDb(state);
    const { fetchFn } = notionFetch();
    const { client } = fakeClient({ draft: [callStep("notion_create_page", null, CREATE_ARGS)] });
    const outcome = await runJobTools(client, "job-1", fetchFn);
    expect(outcome).toEqual({ paused: true, findings: "" });
    expect(state.job.status).toBe("awaiting_approval");
    expect(state.job.toolCalls as Row[]).toHaveLength(1);
    expect((state.job.toolCalls as Row[])[0]).toMatchObject({
      tool: "notion_create_page",
      status: "pending",
    });
    expect(state.approvals as Row[]).toHaveLength(1);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "job.tool_pending",
        details: { tool: "notion_create_page" },
      }),
    );
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "job.tools_paused" }));
  });

  it("runs preapproved writes without asking", async () => {
    const state = baseState({
      links: [{ kind: "app", ref: "notion" }],
      job: baseState().job,
    });
    state.job.toolPolicy = { mode: "preapproved", tools: ["notion_create_page"] };
    stubDb(state);
    const { fetchFn } = notionFetch();
    const { client } = fakeClient({
      draft: [callStep("notion_create_page", null, CREATE_ARGS), doneStep("Filed in Notion.")],
    });
    const outcome = await runJobTools(client, "job-1", fetchFn);
    expect(outcome).toEqual({ paused: false, findings: "Filed in Notion." });
    expect(state.approvals as Row[]).toHaveLength(0);
    expect((state.job.toolCalls as Row[])[0]).toMatchObject({
      status: "done",
      targetId: "https://notion.so/page-1",
      verified: true,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "job.tool_call",
        details: {
          tool: "notion_create_page",
          targetId: "https://notion.so/page-1",
          status: "done",
        },
      }),
    );
  });

  it("runs reads freely and reports unknown tools and bad args", async () => {
    const state = baseState({ links: [{ kind: "app", ref: "notion" }] });
    stubDb(state);
    const { fetchFn } = notionFetch();
    const { client } = fakeClient({
      draft: [
        callStep("notion_search", null, { query: "standup" }),
        callStep("bogus_tool", null, {}),
        callStep("notion_search", null, {}),
        doneStep("Looked around."),
      ],
    });
    const outcome = await runJobTools(client, "job-1", fetchFn);
    expect(outcome.paused).toBe(false);
    expect((state.job.toolCalls as Row[]).map((c: Row) => c.status)).toEqual([
      "done",
      "error",
      "error",
    ]);
    expect(state.approvals as Row[]).toHaveLength(0);
  });

  it("only offers tools the skill declares", async () => {
    const state = baseState({ links: [{ kind: "app", ref: "notion" }] });
    (state.version.sheet as { tools?: string[] }).tools = ["notion_search"];
    stubDb(state);
    const { fetchFn } = notionFetch();
    const { client } = fakeClient({
      draft: [callStep("notion_create_page", null, CREATE_ARGS), doneStep("Can't file it.")],
    });
    await runJobTools(client, "job-1", fetchFn);
    expect((state.job.toolCalls as Row[])[0]).toMatchObject({ status: "error" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("asks for MCP writes even when they look like reads", async () => {
    mockLinear();
    const state = baseState({ links: [{ kind: "mcp", ref: "srv-1" }] });
    stubDb(state);
    const { client } = fakeClient({
      draft: [callStep("list_issues", "Linear", {})],
    });
    const outcome = await runJobTools(client, "job-1");
    expect(outcome.paused).toBe(true);
    expect(mcpServerClient).not.toHaveBeenCalled();
  });

  it("verifies MCP writes against a later read in the transcript", async () => {
    mockLinear();
    const state = baseState({ links: [{ kind: "mcp", ref: "srv-1" }] });
    state.job.toolPolicy = { mode: "preapproved", tools: ["create_issue", "list_issues"] };
    stubDb(state);
    const { client } = fakeClient({
      draft: [
        callStep("create_issue", "Linear", { title: "Standup" }),
        callStep("list_issues", "Linear", {}),
        doneStep("Opened ENG-42."),
      ],
    });
    const outcome = await runJobTools(client, "job-1");
    expect(outcome.paused).toBe(false);
    expect((state.job.toolCalls as Row[])[0]).toMatchObject({
      status: "done",
      targetId: "https://linear.app/acme/issue/ENG-42",
      verified: true,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "job.tool_call",
        details: {
          tool: "create_issue",
          server: "Linear",
          targetId: "https://linear.app/acme/issue/ENG-42",
          status: "done",
        },
      }),
    );
  });
});

describe("decideJobApproval", () => {
  const pendingState = () => {
    const state = baseState({ links: [{ kind: "app", ref: "notion" }] });
    state.job.status = "awaiting_approval";
    state.job.toolCalls = [
      {
        tool: "notion_create_page",
        server: null,
        args: CREATE_ARGS,
        status: "pending",
        result: null,
        targetId: null,
        approvalId: "appr-1",
        verified: null,
      },
    ];
    state.approvals = [
      {
        id: "appr-1",
        jobId: "job-1",
        tool: "notion_create_page",
        server: null,
        args: CREATE_ARGS,
        preview: "Add a page",
        status: "pending",
      },
    ];
    return state;
  };

  it("approves, resumes, verifies, and drafts", async () => {
    const state = pendingState();
    stubDb(state);
    const { fetchFn } = notionFetch();
    const { client, calls } = fakeClient({
      draft: [doneStep("Filed in Notion."), "Filed minutes: shipped it."],
      evaluate: [JSON.stringify({ claims: [] }), JSON.stringify({ flags: [] })],
    });
    const job = await decideJobApproval(
      client,
      "job-1",
      { approvalId: "appr-1", approve: true, userId: "renter-1", actor: "user:ren@example.com" },
      fetchFn,
    );
    expect((state.approvals[0] as Row).status).toBe("approved");
    expect((state.job.toolCalls as Row[])[0]).toMatchObject({ status: "done", verified: true });
    expect(state.job.toolFindings).toBe("Filed in Notion.");
    expect(job.status).toBe("review");
    expect(job.draft).toBe("Filed minutes: shipped it.");
    // The draft saw the findings.
    expect(calls.some((c) => JSON.stringify(c.messages).includes("Tool findings:"))).toBe(true);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "job.tool_approved" }));
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "job.tools_verified",
        details: { checked: 1, missing: 0 },
      }),
    );
  });

  it("denies and still drafts around it", async () => {
    const state = pendingState();
    stubDb(state);
    const { fetchFn } = notionFetch();
    const { client } = fakeClient({
      draft: [doneStep("Skipped filing."), "Minutes without filing."],
      evaluate: [JSON.stringify({ claims: [] }), JSON.stringify({ flags: [] })],
    });
    const job = await decideJobApproval(
      client,
      "job-1",
      { approvalId: "appr-1", approve: false, userId: "renter-1", actor: "user:ren@example.com" },
      fetchFn,
    );
    expect((state.approvals[0] as Row).status).toBe("denied");
    expect(((state.job.toolCalls as Row[])[0] as Row).status).toBe("denied");
    expect(job.draft).toBe("Minutes without filing.");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("only the requester decides, and only once", async () => {
    const state = pendingState();
    stubDb(state);
    const { client } = fakeClient({ draft: [], evaluate: [] });
    await expect(
      decideJobApproval(client, "job-1", {
        approvalId: "appr-1",
        approve: true,
        userId: "stranger",
        actor: "user:s@example.com",
      }),
    ).rejects.toThrow(/Only the person who asked/);
    state.approvals[0].status = "approved";
    await expect(
      decideJobApproval(client, "job-1", {
        approvalId: "appr-1",
        approve: true,
        userId: "renter-1",
        actor: "user:ren@example.com",
      }),
    ).rejects.toThrow(/already decided/);
  });
});

describe("links and policy", () => {
  it("links owned connections and sets the policy", async () => {
    const state = baseState({ appConns: [{ id: "conn-1" }], mcpRows: [{ id: "srv-1" }] });
    stubDb(state);
    await linkConnection(
      "job-1",
      "renter-1",
      { kind: "app", ref: "notion" },
      "user:ren@example.com",
    );
    await linkConnection(
      "job-1",
      "renter-1",
      { kind: "mcp", ref: "srv-1" },
      "user:ren@example.com",
    );
    expect(state.links).toHaveLength(2);
    await setPolicy(
      "job-1",
      "renter-1",
      { mode: "preapproved", tools: ["notion_create_page"] },
      "user:ren@example.com",
    );
    expect(state.job.toolPolicy).toEqual({ mode: "preapproved", tools: ["notion_create_page"] });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "job.connection_linked" }),
    );
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "job.tool_policy" }));
  });

  it("keeps dry runs dry when the policy is edited", async () => {
    const state = baseState();
    state.job.toolPolicy = { mode: "approve_each", tools: [], dryRun: true };
    stubDb(state);
    await setPolicy(
      "job-1",
      "renter-1",
      { mode: "preapproved", tools: ["notion_create_page"] },
      "user:ren@example.com",
    );
    expect(state.job.toolPolicy).toEqual({
      mode: "preapproved",
      tools: ["notion_create_page"],
      dryRun: true,
    });
  });

  it("refuses unowned connections, strangers, and started jobs", async () => {
    const state = baseState();
    stubDb(state);
    await expect(
      linkConnection("job-1", "renter-1", { kind: "app", ref: "notion" }, "user:ren@example.com"),
    ).rejects.toThrow(/Connect Notion first/);
    await expect(
      linkConnection("job-1", "stranger", { kind: "app", ref: "notion" }, "user:s@example.com"),
    ).rejects.toThrow(/Only the person who asked/);
    state.job.draft = "already drafting";
    await expect(
      setPolicy("job-1", "renter-1", { mode: "approve_each", tools: [] }, "user:ren@example.com"),
    ).rejects.toThrow(/already started/);
  });
});
