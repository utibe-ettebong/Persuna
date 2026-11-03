import { env } from "@/env";

/**
 * Which browser origins may call the plugin API. Google Docs add-ons call us
 * server-side and the Word task pane is served from our own origin, so neither
 * needs CORS; this exists for the Canva app (origin app-<id>.canva-apps.com),
 * the Chrome extension, and Figma — whose plugins run with an opaque origin
 * and so always send `Origin: null`.
 */
export function allowedPluginOrigin(origin: string | null): string | null {
  if (origin === "null") return "null";
  if (!origin) return null;
  const listed = (env().PLUGIN_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return listed.includes(origin) ? origin : null;
}

export function pluginCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = allowedPluginOrigin(origin);
  if (!allowed) return {};
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
