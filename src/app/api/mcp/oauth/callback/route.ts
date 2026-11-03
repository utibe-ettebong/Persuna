import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { actorOf, getUser } from "@/lib/auth/session";
import { MCP_OAUTH_COOKIE, completeMcpOAuth, mcpOAuthRedirectUri } from "@/lib/mcp/service";

/** The provider sends the browser back here with a code: store the server. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (message: string) =>
    NextResponse.redirect(
      new URL(`/persuna?apps=${encodeURIComponent(message)}#apps`, request.url),
    );
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in?next=/persuna%23apps", request.url));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("That server wasn't connected.");
  const jar = await cookies();
  try {
    const view = await completeMcpOAuth(
      user.id,
      {
        code,
        state,
        secret: jar.get(MCP_OAUTH_COOKIE)?.value ?? "",
        redirectUri: mcpOAuthRedirectUri(url.origin),
      },
      actorOf(user),
    );
    const res = back(`Connected ${view.name} (${view.tools.length} tools).`);
    res.cookies.delete({ name: MCP_OAUTH_COOKIE, path: "/api/mcp" });
    return res;
  } catch (error) {
    console.error(error);
    return back((error as Error).message);
  }
}
