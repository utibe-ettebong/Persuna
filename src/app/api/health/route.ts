import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/** Railway's healthcheck. Fails if the app can't reach Postgres. */
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch (error) {
    console.error("Healthcheck failed:", error);
    return Response.json({ status: "error" }, { status: 503 });
  }
}
