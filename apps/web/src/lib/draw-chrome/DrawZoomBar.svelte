<script lang="ts">
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import Icon from "./Icon.svelte";

  let {
    engine,
    zoom,
    contentVisible,
  }: {
    engine: DrawEngine | null;
    zoom: number;
    contentVisible: boolean;
  } = $props();

  function holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }
</script>

<div class="draw-panel bar" role="group" aria-label="Zoom and history controls">
  <button
    type="button"
    onmousedown={holdFocus}
    aria-label="Zoom out (⌘−)"
    title="Zoom out — ⌘−"
    onclick={() => engine?.zoomOut()}
  >
    <Icon name="zoomOut" size={15} />
  </button>
  <button
    type="button"
    class="pct"
    onmousedown={holdFocus}
    aria-label={`Zoom ${zoom} percent — reset to 100 percent (⌘0)`}
    title="Reset zoom — ⌘0"
    onclick={() => engine?.zoomReset()}
  >
    {zoom}%
  </button>
  <button
    type="button"
    onmousedown={holdFocus}
    aria-label="Zoom in (⌘+)"
    title="Zoom in — ⌘+"
    onclick={() => engine?.zoomIn()}
  >
    <Icon name="zoomIn" size={15} />
  </button>
  <button
    type="button"
    onmousedown={holdFocus}
    aria-label="Zoom to fit (⇧1)"
    title="Zoom to fit — ⇧1"
    onclick={() => engine?.fit()}
  >
    <Icon name="fit" size={15} />
  </button>

  <div class="rule" aria-hidden="true"></div>

  <button
    type="button"
    onmousedown={holdFocus}
    aria-label="Undo (⌘Z)"
    title="Undo — ⌘Z"
    onclick={() => engine?.undo()}
  >
    <Icon name="undo" size={15} />
  </button>

  <button
    type="button"
    onmousedown={holdFocus}
    aria-label="Redo (⌘⇧Z)"
    title="Redo — ⌘⇧Z"
    onclick={() => engine?.redo()}
  >
    <Icon name="redo" size={15} />
  </button>

  {#if !contentVisible}
    <div class="rule" aria-hidden="true"></div>
    <button
      type="button"
      class="back"
      onmousedown={holdFocus}
      aria-label="Scroll back to content"
      onclick={() => engine?.fit()}
    >
      <Icon name="focus" size={15} />
      <span>Fit</span>
    </button>
  {/if}
</div>

<style>
  .bar {
    position: absolute;
    bottom: 14px;
    left: 14px;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 6px;
    border-radius: var(--radius);
    z-index: 20;
    box-shadow: var(--shadow-sm);
    backdrop-filter: blur(8px);
  }

  button {
    height: 30px;
    min-width: 30px;
    display: grid;
    place-items: center;
    padding: 0 4px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink);
    transition:
      background var(--transition),
      transform 0.1s ease;
  }

  button:hover {
    background: var(--bg-hover);
  }

  button:active {
    transform: scale(0.94);
  }

  .pct {
    min-width: 44px;
    color: var(--fg-strong);
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 11px;
  }

  .rule {
    width: 1px;
    height: 18px;
    margin: 0 3px;
    background: var(--line);
  }

  .back {
    display: flex;
    gap: 4px;
    padding: 0 8px;
    color: var(--accent);
    font-weight: 700;
  }
</style>
