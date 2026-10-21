<script lang="ts">
  /**
   * The style panel's rows, one group at a time.
   *
   * The phone's style strip opens them in a sheet under its row
   * (`DrawMobileActions.svelte`) and the tablet's compact column opens them in a popover
   * beside the column (`DrawTabletActions.svelte`). The rows themselves are the same
   * properties either way, so they live here: a property that behaves one way on a phone
   * and another on a tablet is a bug waiting for a tablet.
   *
   * The groups are the oracle's: the shape rows that travel together
   * (`CombinedShapeProperties`), the arrow's own, the typing's, and the selection's
   * actions (`CombinedExtraActions`) — `Actions.tsx@1118751f:226-588`.
   */
  import type { DrawElementStyle, SelectionStyle, StylePatch } from "@osionos/draw-engine/types";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import InspectorRow from "./InspectorRow.svelte";
  import InspectorSegmented from "./InspectorSegmented.svelte";
  import InspectorIconChoice from "./InspectorIconChoice.svelte";
  import InspectorIconRow from "./InspectorIconRow.svelte";
  import {
    ARROW_TYPES,
    EDGES,
    FIGURE_KIND_OPTIONS,
    FIGURE_RATIO_RANGE,
    FIGURE_SIDES_RANGE,
    FILL_STYLES,
    FONT_SIZES,
    SLOPPINESS,
    STROKE_STYLES,
    TEXT_ALIGNS,
    TEXT_WRAPS,
    VERTICAL_ALIGNS,
    WIDTHS,
    roundnessFor,
    textWrap,
  } from "./inspector.ts";
  import { readFontSize } from "./fonts.ts";
  import type { ShapeActions } from "./shapeActions.ts";
  import { zOrderShortcut } from "./shortcuts.ts";
  import { ARROWHEAD_KINDS, ARROWHEAD_GLYPH, ARROWHEAD_LABEL } from "./menu.ts";

  /** The group of rows to draw. */
  type ActionSection = "shape" | "arrow" | "text" | "figure" | "opacity" | "actions";

  let {
    section,
    summary,
    can,
    engine,
    onApply,
    onPreview,
    run,
  }: {
    section: ActionSection;
    summary: SelectionStyle;
    /** Which properties apply, as the panel reads them. */
    can: ShapeActions;
    engine: DrawEngine | null;
    /** Applies a style to the selection, or to the next element with nothing selected. */
    onApply: (patch: StylePatch) => void;
    /** Shows a style without committing it — a slider in motion. */
    onPreview: (patch: StylePatch) => void;
    /** Runs an engine action and reads the panel back. */
    run: (action: (engine: DrawEngine) => void) => void;
  } = $props();

  const wrap = $derived(textWrap(summary));

  const arrowheadSides = $derived([
    { end: "start" as const, value: summary.startArrowhead },
    { end: "end" as const, value: summary.endArrowhead },
  ]);

  function setArrowhead(end: "start" | "end", kind: (typeof ARROWHEAD_KINDS)[number]): void {
    run((e) => e.setArrowheads({ [end]: kind }));
  }

  /** What the slider shows for a mixed selection: the next element's, as the oracle's does. */
  const opacity = $derived(summary.opacity ?? engine?.getNextStyle().opacity ?? 100);
  const opacityText = $derived(summary.opacity === null ? "mixed" : `${summary.opacity}%`);

  /** The drag of a slider previews and commits once, as the panel's own do. */
  let previewing = false;
  function commitOpacity(value: string): void {
    if (!previewing) return;
    previewing = false;
    onApply({ opacity: Number(value) });
  }

  const figureRatio = $derived(
    summary.figureRatio ?? (FIGURE_RATIO_RANGE.min + FIGURE_RATIO_RANGE.max) / 2,
  );
  const figureRatioText = $derived(
    summary.figureRatio === null ? "mixed" : summary.figureRatio.toFixed(2),
  );

  /** Same preview-then-commit-once shape as the opacity slider, for the ratio slider. */
  let previewingFigureRatio = false;
  function commitFigureRatio(value: string): void {
    if (!previewingFigureRatio) return;
    previewingFigureRatio = false;
    onApply({ figureRatio: Number(value) });
  }
</script>

{#if section === "shape"}
  {#if can.fill}
    <InspectorRow label="Fill style">
      <InspectorSegmented
        ariaLabel="Fill style"
        options={FILL_STYLES}
        value={summary.fillStyle}
        onPick={(v) => onApply({ fillStyle: v as DrawElementStyle["fillStyle"] })}
      />
    </InspectorRow>
  {/if}
  {#if can.strokeWidth}
    <InspectorRow label="Width">
      <InspectorSegmented
        ariaLabel="Stroke width"
        options={WIDTHS}
        value={summary.strokeWidth}
        onPick={(v) => onApply({ strokeWidth: Number(v) })}
      />
    </InspectorRow>
  {/if}
  {#if can.strokeStyle}
    <InspectorRow label="Stroke style">
      <InspectorSegmented
        ariaLabel="Stroke style"
        options={STROKE_STYLES}
        value={summary.strokeStyle}
        onPick={(v) => onApply({ strokeStyle: v as DrawElementStyle["strokeStyle"] })}
      />
    </InspectorRow>
  {/if}
  {#if can.sloppiness}
    <InspectorRow label="Sloppiness">
      <InspectorSegmented
        ariaLabel="Sloppiness"
        options={SLOPPINESS}
        value={summary.roughness}
        onPick={(v) => onApply({ roughness: Number(v) })}
      />
    </InspectorRow>
  {/if}
  {#if can.roundness}
    <InspectorRow label="Edges">
      <InspectorSegmented
        ariaLabel="Edges"
        options={EDGES}
        value={summary.edges}
        onPick={(v) => onApply({ roundness: roundnessFor(v === "round" ? "round" : "sharp") })}
      />
    </InspectorRow>
  {/if}
{:else if section === "arrow"}
  {#if can.arrowType}
    <InspectorRow label="Arrow type">
      <InspectorIconChoice
        ariaLabel="Arrow type"
        options={ARROW_TYPES}
        value={summary.arrowType}
        onPick={(v) => run((e) => e.setArrowType(v))}
      />
    </InspectorRow>
  {/if}
  {#if can.arrowheads}
    <InspectorRow label="Arrowheads">
      <div class="arrowheads">
        {#each arrowheadSides as side (side.end)}
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
                onclick={() => setArrowhead(side.end, kind)}
              >
                <span class:flip={side.end === "start"}>{ARROWHEAD_GLYPH[kind]}</span>
              </button>
            {/each}
          </div>
        {/each}
      </div>
    </InspectorRow>
  {/if}
{:else if section === "text"}
  {#if can.text}
    <InspectorRow label="Font size">
      <div class="font-size">
        <InspectorSegmented
          ariaLabel="Font size"
          options={FONT_SIZES}
          value={summary.fontSize}
          onPick={(v) => run((e) => e.setFontSize(Number(v)))}
        />
        <input
          type="number"
          min={1}
          max={1000}
          step={1}
          aria-label="Font size in pixels"
          placeholder="mixed"
          value={summary.fontSize ?? ""}
          onchange={(event) => {
            const size = readFontSize(event.currentTarget.value);
            if (size !== null) run((e) => e.setFontSize(size));
          }}
        />
      </div>
    </InspectorRow>
  {/if}
  {#if can.textAlign}
    <InspectorRow label="Text align">
      <InspectorIconChoice
        ariaLabel="Text alignment"
        options={TEXT_ALIGNS}
        value={summary.textAlign}
        onPick={(v) => run((e) => e.setTextAlign(v))}
      />
    </InspectorRow>
  {/if}
  {#if can.verticalAlign}
    <InspectorRow label="Vertical align">
      <InspectorIconChoice
        ariaLabel="Vertical text alignment"
        options={VERTICAL_ALIGNS}
        value={summary.verticalAlign}
        onPick={(v) => run((e) => e.setVerticalAlign(v))}
      />
    </InspectorRow>
  {/if}
  {#if can.wrap}
    <InspectorRow label="Text wrap">
      <InspectorSegmented
        ariaLabel="Text wrap"
        options={TEXT_WRAPS}
        value={wrap}
        onPick={(v) => run((e) => e.setTextWrap(v === "wrap"))}
      />
    </InspectorRow>
  {/if}
{:else if section === "figure"}
  {#if can.figureKind}
    <InspectorRow label="Shape">
      <InspectorIconChoice
        ariaLabel="Shape"
        options={FIGURE_KIND_OPTIONS}
        value={summary.figureKind}
        onPick={(v) => onApply({ figureKind: v })}
      />
    </InspectorRow>
  {/if}
  {#if can.figureSides}
    <InspectorRow label="Sides">
      <input
        type="number"
        min={FIGURE_SIDES_RANGE.min}
        max={FIGURE_SIDES_RANGE.max}
        step={1}
        aria-label="Sides"
        placeholder="mixed"
        value={summary.figureSides ?? ""}
        onchange={(event) => {
          const sides = Number(event.currentTarget.value);
          if (Number.isFinite(sides)) onApply({ figureSides: sides });
        }}
      />
    </InspectorRow>
  {/if}
  {#if can.figureRatio}
    <InspectorRow label={`Ratio — ${figureRatioText}`}>
      <input
        type="range"
        min={FIGURE_RATIO_RANGE.min}
        max={FIGURE_RATIO_RANGE.max}
        step={FIGURE_RATIO_RANGE.step}
        value={figureRatio}
        aria-label="Ratio"
        aria-valuetext={figureRatioText}
        oninput={(event) => {
          previewingFigureRatio = true;
          onPreview({ figureRatio: Number(event.currentTarget.value) });
        }}
        onchange={(event) => commitFigureRatio(event.currentTarget.value)}
        onpointerup={(event) => commitFigureRatio(event.currentTarget.value)}
      />
    </InspectorRow>
  {/if}
{:else if section === "opacity"}
  <InspectorRow label={`Opacity — ${opacityText}`}>
    <input
      type="range"
      min={0}
      max={100}
      step={10}
      value={opacity}
      aria-label="Opacity"
      aria-valuetext={opacityText}
      oninput={(event) => {
        previewing = true;
        onPreview({ opacity: Number(event.currentTarget.value) });
      }}
      onchange={(event) => commitOpacity(event.currentTarget.value)}
      onpointerup={(event) => commitOpacity(event.currentTarget.value)}
    />
  </InspectorRow>
{:else if section === "actions"}
  {#if can.layers}
    <InspectorRow label="Layers">
      <InspectorIconRow
        buttons={[
          {
            label: `Send to back (${zOrderShortcut("back")})`,
            icon: "sendToBack",
            onPick: () => run((e) => e.reorderSelection("back")),
          },
          {
            label: `Send backward (${zOrderShortcut("backward")})`,
            icon: "backward",
            onPick: () => run((e) => e.reorderSelection("backward")),
          },
          {
            label: `Bring forward (${zOrderShortcut("forward")})`,
            icon: "forward",
            onPick: () => run((e) => e.reorderSelection("forward")),
          },
          {
            label: `Bring to front (${zOrderShortcut("front")})`,
            icon: "bringToFront",
            onPick: () => run((e) => e.reorderSelection("front")),
          },
        ]}
      />
    </InspectorRow>
  {/if}
  {#if can.mirror}
    <InspectorRow label="Mirror">
      <InspectorIconRow
        buttons={[
          {
            label: "Flip horizontally",
            icon: "flipHorizontal",
            onPick: () => run((e) => e.flipSelection("horizontal")),
          },
          {
            label: "Flip vertically",
            icon: "flipVertical",
            onPick: () => run((e) => e.flipSelection("vertical")),
          },
        ]}
      />
    </InspectorRow>
  {/if}
  {#if can.group}
    <InspectorRow label="Group">
      <InspectorIconRow
        buttons={[
          {
            label: "Group selection",
            icon: "group",
            onPick: () => run((e) => e.groupSelection()),
          },
          {
            label: "Ungroup selection",
            icon: "ungroup",
            onPick: () => run((e) => e.ungroupSelection()),
          },
        ]}
      />
    </InspectorRow>
  {/if}
  {#if can.align}
    <InspectorRow label="Align">
      <InspectorIconRow
        buttons={[
          {
            label: "Align left",
            icon: "alignLeft",
            onPick: () => run((e) => e.alignSelection("left")),
          },
          {
            label: "Align horizontal centres",
            icon: "alignCenterX",
            onPick: () => run((e) => e.alignSelection("centerX")),
          },
          {
            label: "Align right",
            icon: "alignRight",
            onPick: () => run((e) => e.alignSelection("right")),
          },
          {
            label: "Align top",
            icon: "alignTop",
            onPick: () => run((e) => e.alignSelection("top")),
          },
          {
            label: "Align vertical centres",
            icon: "alignCenterY",
            onPick: () => run((e) => e.alignSelection("centerY")),
          },
          {
            label: "Align bottom",
            icon: "alignBottom",
            onPick: () => run((e) => e.alignSelection("bottom")),
          },
        ]}
      />
    </InspectorRow>
  {/if}
  {#if can.distribute}
    <InspectorRow label="Distribute">
      <InspectorIconRow
        buttons={[
          {
            label: "Distribute horizontally",
            icon: "distributeX",
            onPick: () => run((e) => e.distributeSelection("x")),
          },
          {
            label: "Distribute vertically",
            icon: "distributeY",
            onPick: () => run((e) => e.distributeSelection("y")),
          },
        ]}
      />
    </InspectorRow>
  {/if}
{/if}

<style>
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
    flex: 1 1 22px;
    min-width: 22px;
    height: 26px;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-strong);
    font-size: 13px;
    line-height: 1;
  }

  .heads button.on {
    background: var(--accent);
    color: #ffffff;
  }

  .flip {
    display: inline-block;
    transform: scaleX(-1);
  }

  .font-size {
    display: grid;
    gap: 4px;
  }

  .font-size input {
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    color: var(--fg-strong);
    font: inherit;
    font-size: 12px;
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--accent);
  }
</style>
