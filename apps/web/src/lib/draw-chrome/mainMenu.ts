/**
 * The main menu's plan.
 *
 * What a row shows, and who sees it.
 *
 * The oracle's rule about the shortcuts is one line
 * (`packages/excalidraw/components/dropdownMenu/DropdownMenuItemContent.tsx@1118751f:28-29`):
 * the shortcut renders only when the form factor is not `"phone"`. A phone has no
 * keyboard, so a chord on a phone's screen is noise where the row's name should be.
 *
 * The rule about where the menu sits is the oracle's too
 * (`packages/excalidraw/components/MobileMenu.tsx@1118751f:150-153`): "welcome screen,
 * bottom bar, and top bar all have the same z-index; ordered in this reverse order so
 * that top bar is on top". The menu opens from the top bar, so it paints over the
 * bottom bar rather than under it — which is `draw-chrome.css`'s rule, and the reason
 * every row of the menu can be reached on a phone.
 */
import type { FormFactor } from "./formFactor.ts";

/** The shortcut each of the menu's rows carries. */
export const MENU_SHORTCUTS = {
  open: "Ctrl+O",
  save: "Ctrl+S",
  export: "Ctrl+Shift+E",
  present: "Ctrl+Alt+P",
  help: "?",
  snap: "Alt+S",
} as const;

/** Which row a shortcut belongs to. */
export type MenuShortcut = keyof typeof MENU_SHORTCUTS;

/**
 * The shortcuts the menu shows, for this form factor.
 *
 * A phone gets none of them. A tablet and a desktop get all of them: the chords are
 * real there, and the menu is where a person looks for them.
 */
export function menuShortcuts(formFactor: FormFactor): Partial<Record<MenuShortcut, string>> {
  if (formFactor === "phone") return {};
  return MENU_SHORTCUTS;
}
