import type { AutosaveStatus } from "$lib/autosave/autosaver.ts";
import type { ConnectionStatus } from "$lib/realtime/realtimeClient.ts";

/**
 * What the header's save line reports: the saver's state, or `unread` — a drawing this
 * browser holds but could not read, opened empty so drawing can go on (the public build;
 * `boards/openBoard.ts`).
 */
export type SaveLine = AutosaveStatus | "unread";

export function autosaveLabel(status: SaveLine): string {
  if (status === "saving") return "Saving…";
  if (status === "pending") return "Unsaved changes";
  if (status === "error") return "Save failed — retrying";
  if (status === "too-large") return "Not saved — board over 16 MB";
  if (status === "refused") return "Not saved — refused by the server";
  if (status === "unread") return "Not loaded — this browser could not read it";
  return "Saved";
}

/** Whether the save state is one the header should show as a problem. */
export function autosaveIsTrouble(status: SaveLine): boolean {
  return (
    status === "error" || status === "too-large" || status === "refused" || status === "unread"
  );
}

/**
 * The save line over a drawing that could not be read. Its saves still land, merged into
 * what is stored, but "Saved" would say the drawing is what the page shows: so the failure
 * stays on the line whenever the saver has nothing more pressing to say.
 */
export function saveLine(status: AutosaveStatus, unread: boolean): SaveLine {
  return unread && status === "idle" ? "unread" : status;
}

/**
 * What the header says about live collaboration — or nothing, when there is nothing to
 * say.
 *
 * Silent while connected, and during the first connection: a board that opens with a
 * warning that clears a moment later is noise. Once a connection has been made and
 * lost, or the first attempt has failed outright, it says so. The socket reconnects on
 * its own; this is so that a dropped link is not also an invisible one — peers' edits
 * stop arriving and yours stop reaching them until it is back.
 */
export function liveLabel(
  status: ConnectionStatus,
  history: { everConnected: boolean; everFailed: boolean },
): string | null {
  if (status === "connected") return null;
  if (history.everConnected) return "Connection lost — reconnecting…";
  // Remembered across the retries, which pass through `connecting` each time: keyed on
  // the status alone, the warning flickered off at every attempt.
  if (history.everFailed || status === "disconnected") {
    return "Live collaboration offline — retrying";
  }
  return null;
}
