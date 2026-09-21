<script lang="ts">
  import { toHex } from "./style.ts";

  /**
   * A row of quick colour picks, a divider, and the current colour.
   *
   * Laid out as Excalidraw's `color-picker__top-picks` is: five swatches spread with
   * `space-between`, a 1px rule, then the active colour. It must not wrap — a second row
   * leaves the current colour orphaned under the presets, which is what ours did with
   * six picks plus a separate transparent button plus the input.
   *
   * Transparent is one of the five rather than an extra control, which is where
   * Excalidraw puts it.
   */
  let {
    value,
    presets,
    onPick,
  }: {
    value: string;
    presets: readonly string[];
    onPick: (color: string) => void;
  } = $props();

  /** Clicking a swatch must not pull focus off the canvas, or the selection is lost. */
  function holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }
</script>

<div class="swatches">
  <div class="picks">
    {#each presets as color (color)}
      <button
        type="button"
        class="dot"
        class:transparent={color === "transparent"}
        class:on={value === color}
        aria-label={color}
        aria-pressed={value === color}
        style:background={color === "transparent" ? undefined : color}
        onmousedown={holdFocus}
        onclick={() => onPick(color)}
      ></button>
    {/each}
  </div>

  <div class="divider"></div>

  <label class="current" title="Custom colour">
    <span class="sr-only">Custom colour</span>
    <input
      type="color"
      aria-label="Custom colour"
      value={toHex(value)}
      oninput={(e) => onPick(e.currentTarget.value)}
    />
  </label>
</div>

<style>
  .swatches {
    display: flex;
    align-items: center;
    gap: 8px;
    /* Never wraps: the divider and the current colour belong on the same line. */
    flex-wrap: nowrap;
  }

  .picks {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: 1 1 auto;
    gap: 4px;
  }

  .dot {
    width: 1.375rem;
    height: 1.375rem;
    flex: 0 0 auto;
    padding: 0;
    border-radius: 4px;
    border: 1px solid var(--line);
    cursor: pointer;
  }

  .dot.on {
    box-shadow:
      0 0 0 1px var(--surface),
      0 0 0 3px var(--accent);
  }

  .transparent {
    background: repeating-conic-gradient(#c0c0c0 0% 25%, #fff 0% 50%) 50% / 8px 8px;
  }

  .divider {
    width: 1px;
    height: 1rem;
    flex: 0 0 auto;
    background: var(--line);
  }

  .current {
    display: block;
    width: 1.375rem;
    height: 1.375rem;
    flex: 0 0 auto;
    border-radius: 4px;
    border: 1px solid var(--line);
    overflow: hidden;
    cursor: pointer;
  }

  /* The native swatch has its own padding and border; clipping it to the label is what
     makes it the same size and shape as the picks beside it. */
  input[type="color"] {
    width: 200%;
    height: 200%;
    margin: -50%;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
