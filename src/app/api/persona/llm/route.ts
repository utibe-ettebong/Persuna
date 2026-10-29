// Backwards compatibility: ElevenLabs agents still call the pre-rename
// address for Persuna's brain. Remove once every agent points at
// /api/persuna/llm.
export { POST } from "../../persuna/llm/route";
