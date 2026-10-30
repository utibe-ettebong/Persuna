import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { buildId } from "@/lib/build-id";

export const dynamic = "force-dynamic";

/** Railway's healthcheck, and how an open app notices a new version. Fails without Postgres. */
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ status: "ok", build: buildId() });
  } catch (error) {
    console.error("Healthcheck failed:", error);
    return Response.json({ status: "error" }, { status: 503 });
  }
}
