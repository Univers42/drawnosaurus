import type { AutosaveStatus } from "$lib/autosave/autosaver.ts";

export function autosaveLabel(status: AutosaveStatus): string {
  if (status === "saving") return "Saving…";
  if (status === "pending") return "Unsaved changes";
  if (status === "error") return "Save failed — retrying";
  return "Saved";
}
