<script lang="ts">
  /**
   * Extra the oracle lacks (task brief, "Better than Excalidraw"): while Ctrl/Cmd is held
   * to grow a flowchart cluster, this sits beside the node being created and offers the
   * same 1/2/3 shape choice `keys.ts` reads from the keyboard, so the choice is
   * discoverable and clickable, not just a hidden chord.
   */
  import Icon from "./Icon.svelte";
  import type { FlowchartShape } from "@osionos/draw-engine/types";

  let { x, y, onChoose }: { x: number; y: number; onChoose: (shape: FlowchartShape) => void } =
    $props();

  const SHAPES: { shape: FlowchartShape; label: string; key: string }[] = [
    { shape: "rectangle", label: "Rectangle", key: "1" },
    { shape: "diamond", label: "Diamond", key: "2" },
    { shape: "ellipse", label: "Ellipse", key: "3" },
  ];
</script>

<div
  class="draw-panel strip"
  role="toolbar"
  aria-label="Flowchart node shape"
  style:left="{x}px"
  style:top="{y}px"
>
  {#each SHAPES as { shape, label, key } (shape)}
    <button type="button" aria-label={`${label} (${key})`} onclick={() => onChoose(shape)}>
      <Icon name={shape} size={16} />
    </button>
  {/each}
</div>

<style>
  .strip {
    position: absolute;
    display: flex;
    gap: 3px;
    padding: 4px;
    border-radius: 10px;
    z-index: 25;
    /* Sits above the point it is given, centred on it, and never intercepts the drag
       that is still growing the cluster underneath. */
    transform: translate(-50%, calc(-100% - 8px));
    pointer-events: auto;
  }

  button {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--ink);
    transition:
      background var(--transition),
      color var(--transition);
  }

  button:hover {
    background: var(--bg-hover);
  }

  button:active {
    transform: scale(0.92);
  }
</style>
