import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/** Pages anyone may open. Everything else needs a signed-in account. */
const PUBLIC = [
  /^\/download$/,
  /^\/welcome$/,
  /^\/$/,
  /^\/sign-(in|up)$/,
  /^\/approvals\//,
  /^\/personas\//,
  /^\/api\/auth\//,
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
  // Skips the healthcheck, the Paystack webhook (signature-checked) and static assets.
  matcher: ["/((?!api/health|api/webhooks/paystack|_next/static|_next/image|favicon.ico).*)"],
};
