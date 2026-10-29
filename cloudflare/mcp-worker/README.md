# Persuna MCP worker

Persuna as an MCP server: trained, published skills become tools that
Claude, ChatGPT, Cursor and other MCP hosts can call. Code follows
Cloudflare's code-mode pattern: alongside fine-grained tools, an `execute`
tool runs one agent-written snippet against a typed `persuna` API inside a
sandbox whose only capability is that API.

## Tools

| Tool                   | What it does                                                                  |
| ---------------------- | ----------------------------------------------------------------------------- |
| `list_skills`          | The key owner's published skills                                              |
| `skill_<slug>`         | One tool per published skill: raw input in, finished output out               |
| `run_skill`, `get_run` | Same by slug, plus polling while a run waits for owner approval               |
| `import_skill`         | Send a learned skill (`persuna.skill-import/v1`) to be trained and tested     |
| `execute`              | Code mode: one snippet using `persuna.listSkills/runSkill/getRun/importSkill` |

A run returns its output only when the owner's trust level approves it —
the same rule as every other run. Otherwise the caller gets a `jobId` to
poll while the owner reviews it under Jobs.

## Deploy

```sh
cd cloudflare/mcp-worker
npx wrangler deploy
```

Auth is the caller's own Persuna agent key (Skills → Import in Persuna),
sent as `Authorization: Bearer [REDACTED] The worker forwards it to the
Persuna agent API (`PERSUNA_API_URL`in`wrangler.toml`), which stays the
single source of truth for keys and trust.

To enable `execute`, turn on Dynamic Worker Loader for the account and
uncomment the `CODE_LOADER` binding in `wrangler.toml`. Without it the
other tools still work and `execute` answers that it is not enabled.

## Develop

```sh
node --test test/mcp.test.js   # protocol + code-mode core, no Cloudflare account needed
npx wrangler dev    # local worker (set ALLOW_UNSAFE_EXECUTE=1 in .dev.vars
                    # to try execute locally — that fallback is NOT sandboxed)
```
