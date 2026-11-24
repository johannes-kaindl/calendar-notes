// vendored from code-kit@0.87.0, src/ts/pure/error-message.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// New in code-kit (2026-11-03), lifted out of protocol-droid (`message`): the same one-liner stood privately in secret-value, obsidian-kit
// model-bar, chat-window, endpoint-plumbing, llm-connection, lab-client and tool-provider.

/** The text of a caught value: an `Error`'s `message`, anything else `String(e)`. For a log line or a status text, not for branching. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
