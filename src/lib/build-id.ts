import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null | undefined;

/**
 * This deployment's build, the same across every route of the running app. An
 * open page compares it with the server's to notice a newer version. Null when
 * it can't be read, and nothing refreshes.
 */
export function buildId(): string | null {
  if (cached === undefined) {
    try {
      cached = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim() || null;
    } catch {
      cached = null;
    }
  }
  return cached;
}
