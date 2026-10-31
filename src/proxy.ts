import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/** Pages anyone may open. Everything else needs a signed-in account. */
const PUBLIC = [
  /^\/download(\/(mac-arm64|mac-x64|win-x64|win-arm64))?$/,
  /^\/welcome$/,
  /^\/privacy$/,
  /^\/$/,
  /^\/sign-(in|up)$/,
  /^\/approvals\//,
  /^\/persunas\//,
  // The marketplace and the projects board are open to browse. Renting,
  // posting and proposing need an account (the pages and actions check).
  /^\/market$/,
  /^\/market\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\/projects$/,
  /^\/projects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\/api\/auth\//,
  // Persuna Desktop's setup window, which starts signed out, and its sign-in hand-off.
  /^\/desktop\/setup$/,
  /^\/api\/desktop\/sign-in$/,
  // The LiveKit trial agent has no session: the route checks its shared secret.
  /^\/api\/persuna\/livekit-tool$/,
  // The learning-pass scheduler likewise.
  /^\/api\/persuna\/learn-pass$/,
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC.some((re) => re.test(pathname));
}

/**
 * A fast first gate: no session cookie, no studio. This only checks that a
 * cookie exists; every page and action verifies the session and ownership
 * on the server before doing anything.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname) || getSessionCookie(request)) return NextResponse.next();

  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(signIn);
}

export const config = {
  // Skips the healthcheck, the Paystack webhook (signature-checked), the voice
  // agent's brain (checked by shared secret and signed session), the agent
  // import API (checked by agent key) and static assets.
  matcher: [
    "/((?!api/health|api/webhooks/paystack|api/persuna/llm|api/persona/llm|api/agents/|_next/static|_next/image|favicon.ico).*)",
  ],
};
