import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * Persuna Desktop signs in here with the one-time token the browser made
 * (see /desktop/connect). The token is checked and spent, the app's window
 * gets its own session cookie, and setup carries on.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const back = (query = "") => new URL(`/desktop/setup${query}`, request.url);
  if (!/^[\w-]{16,128}$/.test(token)) return NextResponse.redirect(back("?signin=expired"));
  try {
    const { headers } = await auth().api.verifyOneTimeToken({
      body: { token },
      headers: request.headers,
      returnHeaders: true,
    });
    const res = NextResponse.redirect(back());
    for (const cookie of headers.getSetCookie()) res.headers.append("set-cookie", cookie);
    return res;
  } catch {
    return NextResponse.redirect(back("?signin=expired"));
  }
}
