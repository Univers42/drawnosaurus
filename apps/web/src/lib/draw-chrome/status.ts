import type { AutosaveStatus } from "$lib/autosave/autosaver.ts";
import type { ConnectionStatus } from "$lib/realtime/realtimeClient.ts";

export function autosaveLabel(status: AutosaveStatus): string {
  if (status === "saving") return "Saving…";
  if (status === "pending") return "Unsaved changes";
  if (status === "error") return "Save failed — retrying";
  if (status === "too-large") return "Not saved — board over 16 MB";
  if (status === "refused") return "Not saved — refused by the server";
  return "Saved";
}

/** Whether the save state is one the header should show as a problem. */
export function autosaveIsTrouble(status: AutosaveStatus): boolean {
  return status === "error" || status === "too-large" || status === "refused";
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
