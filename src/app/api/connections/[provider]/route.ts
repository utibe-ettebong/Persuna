import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/session";
import { isProvider } from "@/lib/connections/providers";
import { NONCE_COOKIE, startConnecting } from "@/lib/connections/service";

/** Starts connecting an app: off to the provider's sign-in page. */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in?next=/persona%23apps", request.url));
  if (!isProvider(provider)) return new Response("Unknown app", { status: 404 });
  try {
    const { url, nonce } = startConnecting(user.id, provider, new URL(request.url).origin);
    const res = NextResponse.redirect(url);
    res.cookies.set(NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: request.url.startsWith("https:"),
      sameSite: "lax",
      path: "/api/connections",
      maxAge: 600,
    });
    return res;
  } catch (error) {
    return NextResponse.redirect(
      new URL(`/persona?apps=${encodeURIComponent((error as Error).message)}#apps`, request.url),
    );
  }
}
