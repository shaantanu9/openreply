// Alias of /api/v1/licence/validate — the desktop app calls the `/v1/...`
// namespace (see app-tauri commands.rs license endpoints). Keep the handler
// in one place and re-export it here so behaviour can never drift.
export const runtime = "nodejs";
export { POST } from "@/app/api/v1/licence/validate/route";
