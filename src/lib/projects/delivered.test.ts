import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { listCompletedProjects } from "./service";

vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  db: vi.fn(),
}));

/** The WHERE clause listCompletedProjects sends, as SQL text and parameters. */
async function filterAt(now: Date) {
  let where: SQL | undefined;
  const limit = vi.fn(async () => []);
  const query = {
    from: () => query,
    where: (condition: SQL) => ((where = condition), query),
    orderBy: () => ({ limit }),
  };
  vi.mocked(db).mockReturnValue({ select: () => query } as never);
  await listCompletedProjects(6, now);
  return { ...new PgDialect().sqlToQuery(where!), limit };
}

describe("listCompletedProjects", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only lists completed projects, up to the limit", async () => {
    const { sql, params, limit } = await filterAt(new Date("2026-11-01T12:00:00Z"));
    expect(sql).toContain(`"projects"."status" = $1`);
    expect(params).toContain("completed");
    expect(limit).toHaveBeenCalledWith(6);
  });

  it("leaves out a purged project: purging keeps its title and budget", async () => {
    const { sql } = await filterAt(new Date("2026-11-01T12:00:00Z"));
    expect(sql).toContain(`"projects"."purged_at" is null`);
  });

  it("leaves out a project past retention before the purge has run", async () => {
    const now = new Date("2026-11-01T12:00:00Z");
    const { sql, params } = await filterAt(now);
    expect(sql).toMatch(/"projects"\."expires_at" is null or "projects"\."expires_at" > \$\d/);
    expect(params).toContain(now.toISOString());
  });
});
