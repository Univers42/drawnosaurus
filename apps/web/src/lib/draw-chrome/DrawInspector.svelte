<script lang="ts">
  import type { DrawElementStyle } from "@osionos/draw-engine/types";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import InspectorRow from "./InspectorRow.svelte";
  import InspectorSwatches from "./InspectorSwatches.svelte";
  import InspectorSegmented from "./InspectorSegmented.svelte";
  import InspectorIconRow from "./InspectorIconRow.svelte";
  import {
    FILL_STYLES,
    FILL_SWATCHES,
    FONT_SIZES,
    SLOPPINESS,
    STROKE_STYLES,
    STROKE_SWATCHES,
    WIDTHS,
  } from "./inspector.ts";

  let {
    style,
    selectedCount,
    engine,
    onApply,
  }: {
    style: DrawElementStyle;
    selectedCount: number;
    engine: DrawEngine | null;
    onApply: (patch: Partial<DrawElementStyle>) => void;
  } = $props();

  const hasText = $derived(
    selectedCount > 0 && !!engine?.getSelectedElements().some((element) => element.type === "text"),
  );
</script>

<aside class="draw-panel panel" aria-label="Style inspector">
  <div class="title">{selectedCount > 0 ? `${selectedCount} selected` : "Style"}</div>

  <InspectorRow label="Stroke">
    <InspectorSwatches
      value={style.strokeColor}
      presets={STROKE_SWATCHES}
      onPick={(color) => onApply({ strokeColor: color })}
    />
  </InspectorRow>
  <InspectorRow label="Background">
    <InspectorSwatches
      value={style.backgroundColor}
      presets={FILL_SWATCHES}
      allowTransparent
      onPick={(color) => onApply({ backgroundColor: color })}
    />
  </InspectorRow>
  <InspectorRow label="Width">
    <InspectorSegmented
      ariaLabel="Stroke width"
      options={WIDTHS}
      value={style.strokeWidth}
      onPick={(v) => onApply({ strokeWidth: Number(v) })}
    />
  </InspectorRow>
  <InspectorRow label="Stroke style">
    <InspectorSegmented
      ariaLabel="Stroke style"
      options={STROKE_STYLES}
      value={style.strokeStyle}
      onPick={(v) => onApply({ strokeStyle: v as DrawElementStyle["strokeStyle"] })}
    />
  </InspectorRow>
  <InspectorRow label="Sloppiness">
    <InspectorSegmented
      ariaLabel="Sloppiness"
      options={SLOPPINESS}
      value={style.roughness}
      onPick={(v) => onApply({ roughness: Number(v) })}
    />
  </InspectorRow>
  <InspectorRow label="Fill style">
    <InspectorSegmented
      ariaLabel="Fill style"
      options={FILL_STYLES}
      value={style.fillStyle}
      onPick={(v) => onApply({ fillStyle: v as DrawElementStyle["fillStyle"] })}
    />
  </InspectorRow>
  {#if hasText}
    <InspectorRow label="Font size">
      <InspectorSegmented
        ariaLabel="Font size"
        options={FONT_SIZES}
        value={engine?.getFontSize() ?? 20}
        onPick={(v) => engine?.setFontSize(Number(v))}
      />
    </InspectorRow>
  {/if}
  <InspectorRow label={`Opacity — ${style.opacity}%`}>
    <input
      type="range"
      min={10}
      max={100}
      step={10}
      value={style.opacity}
      aria-label="Opacity"
      oninput={(e) => onApply({ opacity: Number(e.currentTarget.value) })}
    />
  </InspectorRow>
  <InspectorRow label={`Corners — ${style.roundness ?? 0}px`}>
    <input
      type="range"
      min={0}
      max={40}
      step={2}
      value={style.roundness ?? 0}
      aria-label="Corner rounding"
      oninput={(e) => onApply({ roundness: Number(e.currentTarget.value) || null })}
    />
  </InspectorRow>
  {#if selectedCount > 0 && engine}
    <InspectorRow label="Layers">
      <InspectorIconRow
        buttons={[
          {
            label: "Send to back (⌘⌥[)",
            icon: "sendToBack",
            onPick: () => engine.reorderSelection("back"),
          },
          {
            label: "Send backward (⌘[)",
            icon: "backward",
            onPick: () => engine.reorderSelection("backward"),
          },
          {
            label: "Bring forward (⌘])",
            icon: "forward",
            onPick: () => engine.reorderSelection("forward"),
          },
          {
            label: "Bring to front (⌘⌥])",
            icon: "bringToFront",
            onPick: () => engine.reorderSelection("front"),
          },
        ]}
      />
    </InspectorRow>
  {/if}
  {#if selectedCount >= 2 && engine}
    <InspectorRow label="Align">
      <InspectorIconRow
        buttons={[
          { label: "Align left", icon: "alignLeft", onPick: () => engine.alignSelection("left") },
          {
            label: "Align horizontal centres",
            icon: "alignCenterX",
            onPick: () => engine.alignSelection("centerX"),
          },
          {
            label: "Align right",
            icon: "alignRight",
            onPick: () => engine.alignSelection("right"),
          },
          { label: "Align top", icon: "alignTop", onPick: () => engine.alignSelection("top") },
          {
            label: "Align vertical centres",
            icon: "alignCenterY",
            onPick: () => engine.alignSelection("centerY"),
          },
          {
            label: "Align bottom",
            icon: "alignBottom",
            onPick: () => engine.alignSelection("bottom"),
          },
        ]}
      />
    </InspectorRow>
  {/if}
  {#if selectedCount >= 3 && engine}
    <InspectorRow label="Distribute">
      <InspectorIconRow
        buttons={[
          {
            label: "Distribute horizontally",
            icon: "distributeX",
            onPick: () => engine.distributeSelection("x"),
          },
          {
            label: "Distribute vertically",
            icon: "distributeY",
            onPick: () => engine.distributeSelection("y"),
          },
        ]}
      />
    </InspectorRow>
  {/if}
</aside>

<style>
  .panel {
    position: absolute;
    top: 66px;
    left: 14px;
    width: 216px;
    padding: 14px;
    border-radius: 12px;
    max-height: calc(100% - 120px);
    overflow-y: auto;
    z-index: 15;
    box-shadow: var(--shadow-md);
    transition: opacity 0.15s ease;
  }

  .title {
    font-size: 12px;
    font-weight: 700;
    margin-bottom: 14px;
    color: var(--fg-strong);
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--accent);
  }
</style>
