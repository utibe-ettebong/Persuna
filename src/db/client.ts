import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

// Reuse one pool across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { persunaDb?: Database };

export function db(): Database {
  globalForDb.persunaDb ??= drizzle(postgres(env().DATABASE_URL, { max: 10 }), { schema });
  return globalForDb.persunaDb;
}

export { schema };
