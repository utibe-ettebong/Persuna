import { NextResponse } from "next/server";
import { env } from "@/env";

/**
 * Persuna's Client ID Metadata Document: MCP sign-in providers that accept
 * it use this URL as our client id, with no registration step.
 */
export async function GET(request: Request) {
  const origin = (env().APP_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
  return NextResponse.json({
    redirect_uris: [`${origin}/api/mcp/oauth/callback`],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "Persuna",
    client_uri: origin,
    application_type: "web",
  });
}
