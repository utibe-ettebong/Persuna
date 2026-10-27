import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Better Auth's endpoints: sign-up, sign-in, sign-out, session. */
export async function GET(request: Request) {
  return auth().handler(request);
}

export async function POST(request: Request) {
  return auth().handler(request);
}
