import type { NavigationType } from "@sveltejs/kit";
import type { AutosaveStatus } from "../autosave/autosaver.ts";
import { autosaveIsTrouble } from "../draw-chrome/status.ts";

/**
 * Leaving a drawing in the public build only once what was drawn is saved.
 *
 * The Docker build keeps a draft behind its saver, so an edit whose last save fails on the
 * way out is still in this browser. The public build has none — its store is the local
 * copy — and a board page left in the app is torn down at once: a save still waiting, sent
 * by a flush nobody waited for, could fail where no one would ever see it, and the edit was
 * lost without the person being told. So the navigation waits for the save, and does not
 * happen when it failed: the person stays on the drawing, the save line saying why.
 */

/** The part of SvelteKit's `BeforeNavigate` this reads. */
export interface Departure {
  type: NavigationType;
  willUnload: boolean;
  to: { url: URL } | null;
  delta?: number | undefined;
  cancel(): void;
}

export interface HoldOptions {
  /** The public build. Passed in: only the routes read `BROWSER_MODE`. */
  browser: boolean;
  /** What the saver last reported; `idle` is everything saved. */
  status: () => AutosaveStatus;
  /** Sends what is waiting, after any request already in flight. */
  flush: () => Promise<void>;
  /** Back or Forward again (`history.go`). */
  go: (delta: number) => void;
  /** Any other navigation again (SvelteKit's `goto`). */
  goto: (url: URL) => Promise<void>;
}

/**
 * For `beforeNavigate`. Cancels a navigation away from a drawing with something unsaved,
 * saves, and makes it again once saved; the repeat comes back here with nothing waiting,
 * so it goes through. Null when it let the navigation through at once, otherwise what
 * settles when the hold is over.
 *
 * A page about to unload — a tab closing (`leave`), a link off the app — cannot be held for
 * a write: it is saved on hide, as before, as far as the browser lets that write finish.
 */
export function holdForSave(navigation: Departure, options: HoldOptions): Promise<void> | null {
  if (!options.browser || navigation.willUnload || options.status() === "idle") return null;
  navigation.cancel();
  return (async () => {
    try {
      await options.flush();
    } catch {
      return;
    }
    // Failed: the saver says so on the save line, and arms its retry. Edits made while
    // the save was out leave it `pending`, and the repeat is held again for them.
    if (autosaveIsTrouble(options.status())) return;
    if (navigation.type === "popstate") options.go(navigation.delta ?? 0);
    else if (navigation.to) await options.goto(navigation.to.url);
  })();
}
