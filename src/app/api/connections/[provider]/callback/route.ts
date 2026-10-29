import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { actorOf, getUser } from "@/lib/auth/session";
import { PROVIDERS, isProvider } from "@/lib/connections/providers";
import { NONCE_COOKIE, finishConnecting } from "@/lib/connections/service";

/** The provider sends the browser back here with a code: store the connection. */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(request.url);
  const back = (message: string) =>
    NextResponse.redirect(
      new URL(`/persuna?apps=${encodeURIComponent(message)}#apps`, request.url),
    );
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in?next=/persuna%23apps", request.url));
  if (!isProvider(provider)) return new Response("Unknown app", { status: 404 });
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back(`${PROVIDERS[provider].name} wasn't connected.`);
  const jar = await cookies();
  try {
    const { account } = await finishConnecting(user.id, provider, {
      code,
      state,
      nonce: jar.get(NONCE_COOKIE)?.value,
      origin: url.origin,
      actor: actorOf(user),
    });
    const res = back(`Connected ${PROVIDERS[provider].name} (${account}).`);
    res.cookies.delete({ name: NONCE_COOKIE, path: "/api/connections" });
    return res;
  } catch (error) {
    console.error(error);
    return back((error as Error).message);
  }
}
