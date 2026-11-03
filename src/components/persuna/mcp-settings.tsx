"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  connectMcpServerAction,
  disconnectMcpServerAction,
  refreshMcpServerAction,
} from "@/app/actions/persuna";
import type { McpServerView } from "@/lib/mcp/service";
import { MCP_VENDORS, MCP_VENDOR_NAMES } from "@/lib/mcp/auth";
import { buttonClass, inputClass } from "@/components/ui";

/**
 * Remote MCP servers Persuna may use (Slack, Linear, GitHub, Figma…).
 * Connecting discovers the server's tools; every tool call is shown to the
 * user for approval before it runs. Servers with "Sign in with…" connect
 * through OAuth; the rest take a fixed access token.
 */
export function McpServers({ servers }: { servers: McpServerView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [oauthName, setOauthName] = useState("");
  const [oauthUrl, setOauthUrl] = useState("");
  const [oauthVendor, setOauthVendor] = useState("");

  const run = (work: () => Promise<{ ok: boolean; error?: string }>, clear = false) =>
    start(async () => {
      const res = await work();
      setError(res.ok ? null : (res.error ?? "Something went wrong."));
      if (res.ok) {
        if (clear) {
          setName("");
          setUrl("");
          setToken("");
        }
        router.refresh();
      }
    });

  const startOAuth = (values: { name: string; url: string; vendor?: string }) =>
    start(async () => {
      try {
        const res = await fetch("/api/mcp/oauth/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(values),
        });
        const data = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !data.url) {
          setError(data.error ?? "Something went wrong.");
          return;
        }
        window.location.href = data.url;
      } catch {
        setError("Couldn't reach the server. Try again?");
      }
    });

  return (
    <div>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {servers.length > 0 && (
        <ul className="mb-4 divide-y divide-line">
          {servers.map((server) => (
            <li key={server.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="flex-1">
                <strong>{server.name}</strong>{" "}
                <span className="label-mono text-faint">
                  {server.authType === "oauth" ? "OAuth" : "Token"}
                </span>
                <span className="block text-muted">
                  {server.url} · {server.tools.length} tool{server.tools.length === 1 ? "" : "s"}
                  {server.tools.length > 0 &&
                    `: ${server.tools
                      .slice(0, 4)
                      .map((t) => t.name)
                      .join(", ")}${server.tools.length > 4 ? "…" : ""}`}
                </span>
              </span>
              {server.authType === "oauth" && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startOAuth({ name: server.name, url: server.url })}
                  className="label-mono text-muted underline hover:text-foreground disabled:opacity-50"
                >
                  Reconnect
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => refreshMcpServerAction(server.id))}
                className="label-mono text-muted underline hover:text-foreground disabled:opacity-50"
              >
                Refresh tools
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Disconnect ${server.name}? Persuna won't be able to use it.`))
                    return;
                  run(() => disconnectMcpServerAction(server.id));
                }}
                className="label-mono text-muted underline hover:text-danger disabled:opacity-50"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mb-4 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          startOAuth({
            name: oauthName,
            url: oauthUrl,
            ...(oauthVendor && { vendor: oauthVendor }),
          });
        }}
      >
        <p className="label-mono text-muted">Sign in with OAuth</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={oauthName}
            onChange={(e) => setOauthName(e.target.value)}
            placeholder="Name (e.g. Linear)"
            required
            className={`${inputClass} w-40`}
          />
          <input
            value={oauthUrl}
            onChange={(e) => setOauthUrl(e.target.value)}
            placeholder="https://mcp.example.com/mcp"
            required
            type="url"
            className={`${inputClass} min-w-56 flex-1`}
          />
          <select
            value={oauthVendor}
            onChange={(e) => setOauthVendor(e.target.value)}
            className={`${inputClass} w-40`}
            aria-label="Vendor"
          >
            <option value="">Automatic</option>
            {MCP_VENDORS.map((vendor) => (
              <option key={vendor} value={vendor}>
                {MCP_VENDOR_NAMES[vendor]}
              </option>
            ))}
          </select>
          <button type="submit" disabled={pending} className={buttonClass()}>
            {pending ? "Starting…" : "Sign in & connect"}
          </button>
        </div>
        <p className="text-xs text-faint">
          For servers with &ldquo;Sign in with&hellip;&rdquo; — Persuna opens their sign-in page,
          then stores the tokens and reads the tool list.
        </p>
      </form>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => connectMcpServerAction({ name, url, token: token || undefined }), true);
        }}
      >
        <p className="label-mono text-muted">Connect with a token</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Linear)"
            required
            className={`${inputClass} w-40`}
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.example.com/mcp"
            required
            type="url"
            className={`${inputClass} min-w-56 flex-1`}
          />
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Access token (if it needs one)"
            type="password"
            autoComplete="off"
            className={`${inputClass} min-w-48 flex-1`}
          />
          <button type="submit" disabled={pending} className={buttonClass()}>
            {pending ? "Connecting…" : "Connect"}
          </button>
        </div>
        <p className="text-xs text-faint">
          Persuna connects, reads the tool list, and asks you before every call it makes.
        </p>
      </form>
    </div>
  );
}
