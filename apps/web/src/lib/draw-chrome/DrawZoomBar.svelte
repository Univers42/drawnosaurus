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

<div class="draw-panel bar" role="group" aria-label="Zoom controls">
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
  {#if !contentVisible}
    <button
      type="button"
      class="back"
      onmousedown={holdFocus}
      aria-label="Scroll back to content"
      onclick={() => engine?.fit()}
    >
      <Icon name="focus" size={15} />
      Back to content
    </button>
  {/if}
</div>

<style>
  .bar {
    position: absolute;
    bottom: 16px;
    left: 16px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: 10px;
    z-index: 2;
  }

  button {
    height: 28px;
    min-width: 28px;
    display: grid;
    place-items: center;
    padding: 0 4px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink);
  }

  .pct {
    min-width: 48px;
    color: var(--fg-strong);
  }

  .back {
    display: flex;
    gap: 6px;
    padding: 0 10px;
    color: var(--accent);
  }
</style>
