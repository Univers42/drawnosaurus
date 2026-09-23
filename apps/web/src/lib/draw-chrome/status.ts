import type { AutosaveStatus } from "$lib/autosave/autosaver.ts";

export function autosaveLabel(status: AutosaveStatus): string {
  if (status === "saving") return "Saving…";
  if (status === "pending") return "Unsaved changes";
  if (status === "error") return "Save failed — retrying";
  if (status === "too-large") return "Not saved — board over 16 MB";
  if (status === "refused") return "Not saved — refused by the server";
  return "Saved";
}
