<script lang="ts">
  import { toHex } from "./style.ts";

  let {
    value,
    presets,
    allowTransparent = false,
    onPick,
  }: {
    value: string;
    presets: readonly string[];
    allowTransparent?: boolean;
    onPick: (color: string) => void;
  } = $props();

  function holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }
</script>

<div class="swatches">
  {#if allowTransparent}
    <button
      type="button"
      class="dot transparent"
      class:on={value === "transparent"}
      aria-label="Transparent"
      aria-pressed={value === "transparent"}
      onmousedown={holdFocus}
      onclick={() => onPick("transparent")}
    ></button>
  {/if}
  {#each presets as color (color)}
    <button
      type="button"
      class="dot"
      class:on={value === color}
      aria-label={color}
      aria-pressed={value === color}
      style:background={color}
      onmousedown={holdFocus}
      onclick={() => onPick(color)}
    ></button>
  {/each}
  <input
    type="color"
    aria-label="Custom color"
    value={toHex(value)}
    oninput={(e) => onPick(e.currentTarget.value)}
  />
</div>

<style>
  .swatches {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }

  .dot {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 1px solid var(--line);
  }

  .dot.on {
    border: 2px solid var(--accent);
  }

  .transparent {
    background: repeating-conic-gradient(#c0c0c0 0% 25%, #fff 0% 50%) 50% / 8px 8px;
  }

  input[type="color"] {
    width: 26px;
    height: 24px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
  }
</style>
