import { NextResponse } from "next/server";
import { z } from "zod";
import { actorOf, getUser } from "@/lib/auth/session";
import {
  MCP_OAUTH_COOKIE,
  MCP_VENDORS,
  MCP_VENDOR_NAMES,
  beginMcpOAuth,
  mcpCimdUrl,
  mcpOAuthRedirectUri,
  mcpVendorClient,
} from "@/lib/mcp/service";

const startInput = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(1).max(2000),
  scope: z.string().trim().max(500).optional(),
  vendor: z.string().trim().optional(),
  method: z.enum(["auto", "dynamic"]).optional(),
});

/** Starts OAuth for an MCP server: answers the sign-in page URL to visit. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const parsed = startInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Name the server and its address." }, { status: 400 });
  }
  const { name, url, scope, vendor, method } = parsed.data;
  const knownVendor = vendor ? MCP_VENDORS.find((v) => v === vendor) : undefined;
  if (vendor && !knownVendor) {
    return NextResponse.json({ error: "Unknown vendor." }, { status: 400 });
  }
  const origin = new URL(request.url).origin;
  const redirectUri = mcpOAuthRedirectUri(origin);
  try {
    const staticClient = knownVendor ? mcpVendorClient(knownVendor) : null;
    if (knownVendor && !staticClient) {
      return NextResponse.json(
        { error: `${MCP_VENDOR_NAMES[knownVendor]} isn't set up on this server yet.` },
        { status: 400 },
      );
    }
    const begun = await beginMcpOAuth(
      user.id,
      {
        name,
        url,
        ...(scope && { scope }),
        redirectUri,
        client:
          staticClient ?? (method === "dynamic" ? undefined : { cimdUrl: mcpCimdUrl(origin) }),
      },
      actorOf(user),
    );
    const res = NextResponse.json({ url: begun.url });
    res.cookies.set(MCP_OAUTH_COOKIE, begun.secret, {
      httpOnly: true,
      secure: request.url.startsWith("https:"),
      sameSite: "lax",
      path: "/api/mcp",
      maxAge: 600,
    });
    return res;
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
