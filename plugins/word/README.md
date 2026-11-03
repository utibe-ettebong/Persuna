# Persuna for Word (sideloaded task pane)

Applies one of your published Persuna skills to the open document: select text
(or nothing, to use the whole document), pick a skill, and press Apply. Every
run is recorded in Persuna's audit log; Persuna keeps none of the document
text. Undo anytime with Ctrl/Cmd+Z.

The task pane is served from the Persuna app itself
(`public/word-addin/taskpane.html`), so it calls the API same-origin.

## Install (sideload, no review)

1. Deploy Persuna somewhere Word can reach over HTTPS.
2. In `manifest.xml`, replace every `PERSUNA_URL` with your Persuna origin
   (no scheme, no trailing slash) and generate a fresh `<Id>` UUID.
3. Sideload the manifest: Word on the web → Add-ins → Upload My Add-in; on
   desktop use the shared-folder catalog or admin deployment.
4. In Persuna, create an agent key (Skills → Import) and paste it into the
   task pane. The key stays in that browser's local storage.

## How it works

- Skills come from `GET /api/agents/skills` (your published skills only).
- Applying calls `POST /api/plugins/apply` with the selection and returns
  structured edits (`replace_selection`, `insert_after`, `append`) which the
  pane places with `Word.run`.
- Auth is your agent key as a Bearer [REDACTED] Full OAuth account-linking
  replaces this before AppSource listing.
