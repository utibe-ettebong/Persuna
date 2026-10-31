import { getUser } from "@/lib/auth/session";
import { exportUserData } from "@/lib/account/service";

/**
 * Everything Persuna keeps about the signed-in user, as one JSON download:
 * profile and memory, messages and notes, skills and episodes, jobs and
 * listings. Connection tokens and key hashes are never included.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  try {
    const data = await exportUserData(user.id);
    return Response.json(data, {
      headers: {
        "content-disposition": `attachment; filename="persuna-export-${user.id.slice(0, 8)}.json"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return new Response("The export failed", { status: 500 });
  }
}
