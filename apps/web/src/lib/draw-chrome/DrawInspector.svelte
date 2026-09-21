<script lang="ts">
  import type { Arrowhead, DrawElement, DrawElementStyle } from "@osionos/draw-engine/types";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import InspectorRow from "./InspectorRow.svelte";
  import InspectorSwatches from "./InspectorSwatches.svelte";
  import InspectorSegmented from "./InspectorSegmented.svelte";
  import InspectorIconRow from "./InspectorIconRow.svelte";
  import {
    EDGES,
    FILL_STYLES,
    FONT_SIZES,
    SLOPPINESS,
    STROKE_STYLES,
    getFillSwatches,
    getStrokeSwatches,
    type ThemeMode,
    WIDTHS,
  } from "./inspector.ts";
  import { getShapeActions } from "./shapeActions.ts";
  import { ARROWHEAD_KINDS, ARROWHEAD_GLYPH, ARROWHEAD_LABEL } from "./menu.ts";
  import type { ExtendedTool } from "./tools.ts";

  let {
    style,
    themeMode = "light",
    selectedCount,
    selection = [],
    tool = "select",
    engine,
    onApply,
  }: {
    style: DrawElementStyle;
    selectedCount: number;
    /** The selected elements, for deciding which controls apply. */
    selection?: readonly DrawElement[];
    tool?: ExtendedTool;
    engine: DrawEngine | null;
    themeMode?: ThemeMode;
    onApply: (patch: Partial<DrawElementStyle>) => void;
  } = $props();

  const strokePresets = $derived(getStrokeSwatches(themeMode));
  const fillPresets = $derived(getFillSwatches(themeMode));

  /**
   * Which controls apply, given the tool and what is selected.
   *
   * Every section below is gated on one of these rather than on an ad-hoc condition, so
   * the answers cannot drift apart. The panel used to render every control for every
   * selection: an arrow offered a fill style it cannot have, a line offered corner
   * rounding it has no corners for, and a text element offered a dash pattern.
   */
  const can = $derived(getShapeActions(tool, selection, style.backgroundColor));

  /** The arrowheads of the selected arrow, if the selection is one. */
  const arrowheads = $derived.by(() => {
    const arrows = selection.filter((element) => element.type === "arrow");
    const first = arrows[0];
    if (!first) return { start: "none" as Arrowhead, end: "arrow" as Arrowhead };
    return {
      start: first.startArrowhead ?? ("none" as Arrowhead),
      end: first.endArrowhead ?? ("arrow" as Arrowhead),
    };
  });

  /** The element type reads as a heading, so it is capitalised rather than raw. */
  const title = $derived.by(() => {
    if (selectedCount > 1) return `${selectedCount} selected`;
    const kind = selection[0]?.type;
    if (!kind) return "Style";
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  });
</script>

<aside class="draw-panel panel" aria-label="Style inspector">
  <div class="title">{title}</div>

  {#if can.strokeColor}
    <InspectorRow label="Stroke">
      <InspectorSwatches
        value={style.strokeColor}
        presets={strokePresets}
        onPick={(color) => onApply({ strokeColor: color })}
      />
    </InspectorRow>
  {/if}
  {#if can.backgroundColor}
    <InspectorRow label="Background">
      <InspectorSwatches
        value={style.backgroundColor}
        presets={fillPresets}
        allowTransparent
        onPick={(color) => onApply({ backgroundColor: color })}
      />
    </InspectorRow>
  {/if}
  {#if can.strokeWidth}
    <InspectorRow label="Width">
      <InspectorSegmented
        ariaLabel="Stroke width"
        options={WIDTHS}
        value={style.strokeWidth}
        onPick={(v) => onApply({ strokeWidth: Number(v) })}
      />
    </InspectorRow>
  {/if}
  {#if can.strokeStyle}
    <InspectorRow label="Stroke style">
      <InspectorSegmented
        ariaLabel="Stroke style"
        options={STROKE_STYLES}
        value={style.strokeStyle}
        onPick={(v) => onApply({ strokeStyle: v as DrawElementStyle["strokeStyle"] })}
      />
    </InspectorRow>
  {/if}
  {#if can.sloppiness}
    <InspectorRow label="Sloppiness">
      <InspectorSegmented
        ariaLabel="Sloppiness"
        options={SLOPPINESS}
        value={style.roughness}
        onPick={(v) => onApply({ roughness: Number(v) })}
      />
    </InspectorRow>
  {/if}
  {#if can.fill}
    <InspectorRow label="Fill style">
      <InspectorSegmented
        ariaLabel="Fill style"
        options={FILL_STYLES}
        value={style.fillStyle}
        onPick={(v) => onApply({ fillStyle: v as DrawElementStyle["fillStyle"] })}
      />
    </InspectorRow>
  {/if}
  {#if can.text}
    <InspectorRow label="Font size">
      <InspectorSegmented
        ariaLabel="Font size"
        options={FONT_SIZES}
        value={engine?.getFontSize() ?? 20}
        onPick={(v) => engine?.setFontSize(Number(v))}
      />
    </InspectorRow>
  {/if}
  <!--
    Arrowheads existed in the engine and in the right-click menu, but not in the panel —
    so the one control an arrow most obviously needs was the one place it could not be
    reached. Shown only for arrows, which are the only elements that can have them.
  -->
  {#if can.arrowheads && engine}
    <InspectorRow label="Arrowheads">
      <div class="arrowheads">
        {#each [{ end: "start" as const, value: arrowheads.start }, { end: "end" as const, value: arrowheads.end }] as side (side.end)}
          <div
            class="heads"
            role="radiogroup"
            aria-label={`${side.end === "start" ? "Start" : "End"} arrowhead`}
          >
            {#each ARROWHEAD_KINDS as kind (kind)}
              <button
                type="button"
                role="radio"
                class:on={side.value === kind}
                aria-checked={side.value === kind}
                aria-label={`${side.end === "start" ? "Start" : "End"} ${ARROWHEAD_LABEL[kind]}`}
                title={ARROWHEAD_LABEL[kind]}
                onclick={() => engine.setArrowheads({ [side.end]: kind })}
              >
                <span class:flip={side.end === "start"}>{ARROWHEAD_GLYPH[kind]}</span>
              </button>
            {/each}
          </div>
        {/each}
      </div>
    </InspectorRow>
  {/if}
  {#if can.opacity}
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
  {/if}
  {#if can.roundness}
    <InspectorRow label="Edges">
      <InspectorSegmented
        ariaLabel="Edges"
        options={EDGES}
        value={style.roundness === null || style.roundness === undefined ? null : 8}
        onPick={(v) => onApply({ roundness: v === null ? null : Number(v) })}
      />
    </InspectorRow>
  {/if}
  {#if can.layers && engine}
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
  {#if can.mirror && engine}
    <InspectorRow label="Mirror">
      <InspectorIconRow
        buttons={[
          {
            label: "Flip horizontally",
            icon: "flipHorizontal",
            onPick: () => engine.flipSelection("horizontal"),
          },
          {
            label: "Flip vertically",
            icon: "flipVertical",
            onPick: () => engine.flipSelection("vertical"),
          },
        ]}
      />
    </InspectorRow>
  {/if}
  <!--
    Group and ungroup existed in the engine and in the right-click menu, but there was
    no way to reach them from the panel — so selecting several elements and grouping
    them looked impossible. Shown from two elements up, and also for a single selection
    that is already a group, which is the only way to ungroup one.
  -->
  {#if engine && (selectedCount >= 2 || (selectedCount > 0 && engine.selectionIsGroup()))}
    <InspectorRow label="Group">
      <InspectorIconRow
        buttons={[
          {
            label: "Group selection",
            icon: "group",
            onPick: () => engine.groupSelection(),
          },
          {
            label: "Ungroup selection",
            icon: "ungroup",
            onPick: () => engine.ungroupSelection(),
          },
        ]}
      />
    </InspectorRow>
  {/if}
  {#if can.align && engine}
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
  {#if can.distribute && engine}
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

  .arrowheads {
    display: grid;
    gap: 4px;
  }

  .heads {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--bg);
    border-radius: 8px;
  }

  .heads button {
    flex: 1;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-strong);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }

  .heads button:hover {
    background: var(--surface);
  }

  .heads button.on {
    background: var(--accent);
    color: #ffffff;
  }

  /* The start head points the other way, so the same glyph is mirrored rather than
     carried as a second set of icons. */
  .flip {
    display: inline-block;
    transform: scaleX(-1);
  }
</style>
