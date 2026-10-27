import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Basic-auth gate for the whole app when APP_PASSWORD is set. The deployed
 * demo spends model credits on every button, so it must not be open to the web.
 */
export function proxy(request: NextRequest) {
  // The landing page is public; everything behind it is the studio.
  if (request.nextUrl.pathname === "/") return NextResponse.next();
  const password = process.env.APP_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("APP_PASSWORD is not configured", { status: 503 });
    }
    return NextResponse.next();
  }

  if (isAuthorized(request.headers.get("authorization"), password)) return NextResponse.next();

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="PERSUNA", charset="UTF-8"' },
  });
}

export function isAuthorized(header: string | null, password: string): boolean {
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const supplied = decoded.slice(decoded.indexOf(":") + 1);
  const a = Buffer.from(supplied);
  const b = Buffer.from(password);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const config = {
  // Everything except the healthcheck, the Paystack webhook (signature-checked),
  // employer approval links (secret token in the URL) and static assets.
  matcher: [
    "/((?!api/health|api/webhooks/paystack|approvals/|_next/static|_next/image|favicon.ico).*)",
  ],
};
