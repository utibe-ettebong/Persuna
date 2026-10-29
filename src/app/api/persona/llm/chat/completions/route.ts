// Backwards compatibility: ElevenLabs agents configured with the pre-rename
// base URL call this full address. Remove once every agent points at
// /api/persuna/llm.
export { POST } from "../../../../persuna/llm/chat/completions/route";
