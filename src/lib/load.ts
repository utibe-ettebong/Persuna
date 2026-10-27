import { notFound } from "next/navigation";
import { NotFoundError } from "@/lib/skill/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Awaits a lookup, turning a missing record (or a malformed id) into a 404 page. */
export async function orNotFound<T>(load: () => Promise<T>, id?: string): Promise<T> {
  if (id !== undefined && !UUID.test(id)) notFound();
  try {
    return await load();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
