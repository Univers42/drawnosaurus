import { describe, expect, it } from "vitest";
import { MENU_SHORTCUTS, menuShortcuts } from "./mainMenu.ts";

/**
 * The main menu's keyboard shortcuts.
 *
 * Oracle: `DropdownMenuItemContent.tsx@1118751f:28-29` — "the shortcut renders only when
 * the form factor is not `phone`". A phone has no keyboard, so a chord on a phone's
 * screen is noise where the row's name should be.
 */
describe("menuShortcuts", () => {
  it("shows none of them on a phone", () => {
    expect(menuShortcuts("phone")).toEqual({});
  });

  it("shows all of them on a tablet and on a desktop", () => {
    expect(menuShortcuts("tablet")).toEqual(MENU_SHORTCUTS);
    expect(menuShortcuts("desktop")).toEqual(MENU_SHORTCUTS);
  });

  it("names the chords the menu's rows carry", () => {
    expect(MENU_SHORTCUTS.open).toBe("Ctrl+O");
    expect(MENU_SHORTCUTS.save).toBe("Ctrl+S");
    expect(MENU_SHORTCUTS.export).toBe("Ctrl+Shift+E");
    expect(MENU_SHORTCUTS.present).toBe("Ctrl+Alt+P");
    expect(MENU_SHORTCUTS.help).toBe("?");
    expect(MENU_SHORTCUTS.snap).toBe("Alt+S");
  });
});
