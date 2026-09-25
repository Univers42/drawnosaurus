<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { slideCounterText } from "./presentation.ts";

  /**
   * Prev / Next / counter / Exit, while presenting.
   *
   * Focused on mount, the way `DrawMainMenu` focuses itself: the presentation's own
   * keys are caught on `.draw-chrome`'s capture phase, which only sees a keydown whose
   * target is *inside* it, so something in here has to hold focus for the arrow keys to
   * reach that handler at all rather than the window a click never touched.
   *
   * Fades after two seconds with no pointer movement, and comes back on the next move —
   * `pointer-events: none` while faded, so a hidden bar never swallows a click meant for
   * the canvas under it. That is cosmetic only: every control stays a real, focusable
   * element the whole time, so Tab reaches all of them whether or not the mouse has
   * moved recently.
   */
  let {
    index,
    count,
    onPrev,
    onNext,
    onExit,
  }: {
    index: number;
    count: number;
    onPrev: () => void;
    onNext: () => void;
    onExit: () => void;
  } = $props();

  const FADE_AFTER_MS = 2000;

  let root: HTMLDivElement | undefined;
  let visible = $state(true);
  let focused = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleHide(): void {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!focused) visible = false;
    }, FADE_AFTER_MS);
  }

  function wake(): void {
    visible = true;
    scheduleHide();
  }

  onMount(() => {
    root?.focus();
    scheduleHide();
  });

  onDestroy(() => clearTimeout(hideTimer));
</script>

<svelte:window onpointermove={wake} />

<div
  class="present-bar"
  class:faded={!visible}
  role="group"
  aria-label="Presentation controls"
  tabindex="-1"
  bind:this={root}
  onfocusin={() => {
    focused = true;
    visible = true;
  }}
  onfocusout={() => {
    focused = false;
    scheduleHide();
  }}
>
  <button type="button" aria-label="Previous slide" title="Previous — ←" onclick={onPrev}>‹</button>
  <span class="counter" aria-live="polite">{slideCounterText(index, count)}</span>
  <button type="button" aria-label="Next slide" title="Next — →" onclick={onNext}>›</button>
  <span class="rule" aria-hidden="true"></span>
  <button
    type="button"
    class="exit"
    aria-label="Exit presentation"
    title="Exit — Esc"
    onclick={onExit}
  >
    Exit
  </button>
</div>

<style>
  .present-bar {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    z-index: 90;
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-md);
    border-radius: var(--radius);
    backdrop-filter: blur(12px);
    transition: opacity 0.25s ease;
  }

  .present-bar.faded {
    opacity: 0;
    pointer-events: none;
  }

  .present-bar button {
    height: 30px;
    min-width: 30px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
  }

  .present-bar button:hover {
    background: var(--bg-hover);
  }

  .counter {
    min-width: 52px;
    text-align: center;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 12px;
    color: var(--fg-strong);
  }

  .rule {
    width: 1px;
    height: 18px;
    background: var(--line);
  }

  .exit {
    color: var(--danger, #e03131);
  }
</style>
