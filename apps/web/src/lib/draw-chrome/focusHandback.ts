/**
 * Taking the focus when an overlay opens, and giving it back when it closes.
 *
 * The pair is the oracle's, and both halves matter. An open overlay takes the focus so
 * that the board's keys stay on the board — both the engine's listener and the chrome's
 * ride on a focused element, so a key only reaches them while nothing inside an overlay
 * holds it (`Dialog.tsx@1118751f:63-68`, `Popover.tsx@1118751f:44-50`) — and it hands it
 * back on close, from `onClose` and against the element captured on mount
 * (`Dialog.tsx@1118751f:52`, `:99-104`). Taking it and dropping it on the way out is the
 * worse half of the bug: the overlay is gone and the focus is on `<body>`, so the board
 * underneath is unreachable from the keyboard until it is clicked, and the next key draws
 * nothing.
 *
 * `into` is what the overlay focuses. The oracle focuses the first focusable *control*;
 * this app focuses the card, as `VectorizeDialog.svelte` does here, or a named control
 * where there is one worth landing on (`DrawMermaidModal.svelte`'s textarea,
 * `DrawPathPanel.svelte`'s first stop).
 *
 * One divergence from the oracle, and it is this app's own rule rather than a new one:
 * when there is nowhere to go back to — the focus was on `<body>`, or on a control that
 * went away with the overlay that opened this one, as the palette's input does when a
 * palette command opens a dialog — the hand-back falls to "the next key is a board key"
 * (`giveKeysBack`). The oracle calls `.focus()` on a `lastActiveElement` it never checks
 * is still in the document, which in a browser is a call on a detached node and no focus
 * at all.
 */
import { giveKeysBack } from "./textEditor.ts";

/**
 * Focuses `into` and returns the hand-back, to be run when the overlay closes.
 *
 * `takeFocus(card)` is the whole of an `onMount` that does nothing else, and
 * `onDestroy(() => handBack())` is the other half of a picker that is mounted and
 * unmounted by its own `{#if}`.
 */
export function takeFocus(into?: HTMLElement | null): () => void {
  const returnTo = document.activeElement as HTMLElement | null;
  into?.focus();
  return () => {
    if (returnTo && returnTo !== document.body && returnTo.isConnected) returnTo.focus();
    else giveKeysBack(document);
  };
}
