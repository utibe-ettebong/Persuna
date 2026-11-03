# Persuna for Google Docs (private add-on)

Applies one of your published Persuna skills to the open document: select text
(or nothing, to use the whole document), pick a skill, and press Apply. Every
run is recorded in Persuna's audit log; Persuna keeps none of the document
text. Undo anytime with Ctrl/Cmd+Z.

## Install (private, no review)

1. Open [script.google.com](https://script.google.com), create a project, and
   paste in `Code.gs`, `Sidebar.html`, and `appsscript.json` (enable "Show
   manifest file" in project settings for the last one).
2. Replace every `PERSUNA_URL` with your Persuna origin
   (`https://persuna.example.com`, no trailing slash) in both `Code.gs` and
   `appsscript.json`.
3. Deploy → New deployment → Add-on, then install it privately (Google
   Workspace Admin SDK: private per-domain install skips Marketplace review).
4. In Persuna, create an agent key (Skills → Import) and paste it into the
   add-on sidebar. The key stays in your own Google user properties.

## How it works

- Skills come from `GET /api/agents/skills` (your published skills only).
- Applying calls `POST /api/plugins/apply` with the selection and returns
  structured edits (`replace_selection`, `insert_after`, `append`) which the
  add-on places with `DocumentApp`.
- Auth is your agent key as a Bearer [REDACTED] Full OAuth account-linking
  replaces this before public listing.
