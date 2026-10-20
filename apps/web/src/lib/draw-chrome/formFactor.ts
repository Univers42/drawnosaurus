/**
 * Phone, tablet or desktop, from the editor's own box.
 *
 * Ported numbers from the oracle's breakpoints and its form-factor pick, both commented
 * with the lines of `packages/common/src/editorInterface.ts@1118751f` they come from. The
 * rule is deliberately *not* a media query on the window: Excalidraw measures the editor
 * (`App.tsx@1118751f:2420-2424` measures `excalidrawWrapper` before asking), and in this
 * chrome the whole page is the editor, so the window's inner box is the editor's box. The
 * caller passes the two numbers, which keeps this module pure and testable — and lets the
 * resize/rotation wiring live in the one component that owns the chrome.
 *
 * Why form factor rather than `@media`: Excalidraw hangs its phone chrome off a
 * `.excalidraw--mobile` root class it computes on every render
 * (`App.tsx@1118751f:2422`). A class survives overlays, popovers and dialogs threaded
 * with the same condition, and it cannot disagree with the toolbar's about the width —
 * every bar reads the one decision.
 */

export type FormFactor = "phone" | "tablet" | "desktop";

/** `MQ_MAX_MOBILE` (`editorInterface.ts@1118751f:81`): nothing wider than this is a phone. */
export const MQ_MAX_MOBILE = 599;
/** `MQ_MAX_WIDTH_LANDSCAPE` (`editorInterface.ts@1118751f:83`). */
export const MQ_MAX_WIDTH_LANDSCAPE = 1000;
/** `MQ_MAX_HEIGHT_LANDSCAPE` (`editorInterface.ts@1118751f:84`). */
export const MQ_MAX_HEIGHT_LANDSCAPE = 500;
/** `isTabletBreakpoint`'s bounds (`editorInterface.ts@1118751f:88-89`). */
export const MQ_MAX_TABLET = 1180;

/** `isMobileBreakpoint` (`editorInterface.ts@1118751f:117-125`). */
export function isMobileBreakpoint(width: number, height: number): boolean {
  return (
    width <= MQ_MAX_MOBILE || (height < MQ_MAX_HEIGHT_LANDSCAPE && width < MQ_MAX_WIDTH_LANDSCAPE)
  );
}

/** `isTabletBreakpoint` (`editorInterface.ts@1118751f:127-133`). */
export function isTabletBreakpoint(width: number, height: number): boolean {
  const minSide = Math.min(width, height);
  const maxSide = Math.max(width, height);
  return minSide > MQ_MAX_MOBILE && maxSide <= MQ_MAX_TABLET;
}

/** `getFormFactor` (`editorInterface.ts@1118751f:167-184`). */
export function formFactorFor(width: number, height: number): FormFactor {
  if (isMobileBreakpoint(width, height)) return "phone";
  if (isTabletBreakpoint(width, height)) return "tablet";
  return "desktop";
}
