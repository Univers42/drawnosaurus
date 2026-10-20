<script lang="ts">
  /**
   * The phone's bottom bar: the tools a thumb can reach.
   *
   * Port of the oracle's measured row (`packages/excalidraw/components/MobileToolbar.tsx
   * @1118751f:102-154`): the fixed slots — pan, select, draw, erase, the two popovers and
   * More — and text, image and frame joining the row as the width allows (`mobileToolbar.ts`
   * holds the plan and its thresholds; this file draws it).
   *
   * The two popovers remember the last shape and the last line they were used for and
   * wear its icon, as the oracle's do (`MobileToolbar.tsx@1118751f:52-57`): a row of
   * identical squares is a scanning problem, and a trigger that keeps its face is the
   * difference between reaching for the right one and reaching for the wrong one.
   *
   * The bar is measured, not guessed: the space it has decides which tools are promoted
   * onto it, so a narrow phone shows fewer buttons rather than a bar that runs off the
   * screen.
   */
  import type { DrawTool } from "@osionos/draw-engine/types";
  import Icon from "./Icon.svelte";
  import { ALL_TOOL_DEFS, toolDef } from "./tools.ts";
  import type { IconName } from "./icons.ts";
  import {
    LINEAR_FAMILY,
    SHAPE_FAMILY,
    mobileToolbarPlan,
    type BaseSlot,
    type PromotedTool,
  } from "./mobileToolbar.ts";

  let {
    active,
    onSelect,
  }: {
    active: DrawTool;
    onSelect: (tool: DrawTool) => void;
  } = $props();

  /** Which popover is open; one at a time, as the oracle's row. */
  let open = $state<"shapes" | "lines" | "more" | null>(null);
  /** The last shape and the last line the popovers were used for. */
  let lastShape = $state<DrawTool>(SHAPE_FAMILY[0]);
  let lastLine = $state<DrawTool>(LINEAR_FAMILY[0]);

  /**
   * The width the row is drawn at, in CSS pixels.
   *
   * The row's own width cannot be measured — it is what the plan decides — so the
   * measurement is of the space it has: the dock's content box, which already carries
   * the safe-area insets. Read on mount and again whenever the dock is resized.
   */
  let rowWidth = $state(0);
  let row: HTMLDivElement | undefined = $state();

  function measure(): void {
    const host = row?.parentElement ?? null;
    if (!host) {
      rowWidth = typeof window === "undefined" ? 0 : window.innerWidth;
      return;
    }
    const style = getComputedStyle(host);
    rowWidth =
      host.clientWidth -
      parseFloat(style.paddingLeft || "0") -
      parseFloat(style.paddingRight || "0");
  }

  $effect(() => {
    if (!row) return;
    measure();
    const host = row.parentElement;
    if (!host) return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  });

  const plan = $derived(
    mobileToolbarPlan(rowWidth, { shape: lastShape, linear: lastLine, active }),
  );

  /** The icon a slot wears: the tool's own, or the family's last-used one. */
  function iconFor(slot: BaseSlot | PromotedTool): IconName {
    if (slot === "shapes") return toolDef(plan.wears.shapes)?.icon ?? "rectangle";
    if (slot === "lines") return toolDef(plan.wears.lines)?.icon ?? "arrow";
    if (slot === "more") {
      return plan.wears.more ? (toolDef(plan.wears.more)?.icon ?? "more") : "more";
    }
    return toolDef(slot)?.icon ?? "more";
  }

  /** The label a slot wears, for the screen reader and the tooltip. */
  function labelFor(slot: BaseSlot | PromotedTool): string {
    if (slot === "shapes") return "Shapes";
    if (slot === "lines") return "Lines";
    if (slot === "more") return "More tools";
    return toolDef(slot)?.label ?? slot;
  }

  const familyTools: Record<"shapes" | "lines", readonly DrawTool[]> = {
    shapes: SHAPE_FAMILY,
    lines: LINEAR_FAMILY,
  };

  /** Picks a tool, and remembers the family it belongs to on the two popovers. */
  function choose(tool: DrawTool): void {
    if ((SHAPE_FAMILY as readonly string[]).includes(tool)) lastShape = tool;
    if ((LINEAR_FAMILY as readonly string[]).includes(tool)) lastLine = tool;
    open = null;
    onSelect(tool);
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!open) return;
    const target = event.target as Node | null;
    if (target && row?.contains(target)) return;
    open = null;
  }

  function onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      open = null;
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="mobile-bar-row" role="toolbar" aria-label="Drawing tools" bind:this={row}>
  {#each plan.shown as slot (slot)}
    {#if slot === "shapes" || slot === "lines"}
      {@const family = slot === "shapes" ? "shapes" : "lines"}
      {@const worn = family === "shapes" ? plan.wears.shapes : plan.wears.lines}
      <div class="slot pop">
        <button
          type="button"
          class="tool"
          class:active={active === worn}
          aria-label={family === "shapes"
            ? `Shapes (${SHAPE_FAMILY.length})`
            : `Lines (${LINEAR_FAMILY.length})`}
          aria-haspopup="menu"
          aria-expanded={open === family}
          title={labelFor(slot)}
          onclick={() => (open = open === family ? null : family)}
        >
          <Icon name={iconFor(slot)} size={20} />
        </button>

        {#if open === family}
          <div
            class="menu draw-panel"
            role="menu"
            tabindex="-1"
            aria-label={labelFor(slot)}
            onkeydown={onMenuKeydown}
          >
            {#each familyTools[family] as tool (tool)}
              {@const entry = ALL_TOOL_DEFS.find((item) => item.tool === tool)}
              <button
                type="button"
                class="menu-item"
                role="menuitemradio"
                aria-checked={active === tool}
                class:on={active === tool}
                aria-label={entry?.label ?? tool}
                onclick={() => choose(tool)}
              >
                <Icon name={entry?.icon ?? "more"} size={16} />
                <span class="name">{entry?.label ?? tool}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else if slot === "more"}
      <div class="slot pop">
        <button
          type="button"
          class="tool"
          class:active={!!plan.wears.more}
          aria-label="More tools"
          aria-haspopup="menu"
          aria-expanded={open === "more"}
          title="More tools"
          onclick={() => (open = open === "more" ? null : "more")}
        >
          <Icon name={iconFor("more")} size={20} />
        </button>

        {#if open === "more"}
          <div
            class="menu draw-panel"
            role="menu"
            tabindex="-1"
            aria-label="More tools"
            onkeydown={onMenuKeydown}
          >
            {#each plan.overflow as tool (tool)}
              {@const entry = ALL_TOOL_DEFS.find((item) => item.tool === tool)}
              <button
                type="button"
                class="menu-item"
                role="menuitemradio"
                aria-checked={active === tool}
                class:on={active === tool}
                aria-label={entry?.label ?? tool}
                onclick={() => choose(tool)}
              >
                <Icon name={entry?.icon ?? "more"} size={16} />
                <span class="name">{entry?.label ?? tool}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      {@const entry = toolDef(slot as DrawTool)}
      {#if entry}
        <button
          type="button"
          class="tool"
          class:active={active === entry.tool}
          aria-label={entry.label}
          title={entry.label}
          onclick={() => choose(entry.tool)}
        >
          <Icon name={entry.icon} size={20} />
        </button>
      {/if}
    {/if}
  {/each}
</div>

<style>
  .mobile-bar-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    max-width: 100%;
    padding: 4px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-md);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    /* No scrolling here: the row's own menus open above it, and a scroll container
       would clip them. The plan keeps the row inside the screen instead — the tools
       that do not fit are the ones behind More. */
  }

  .tool {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--ink);
    flex: 0 0 auto;
  }

  .tool.active {
    color: var(--accent);
    background: var(--accent-subtle);
  }

  .pop {
    position: relative;
    display: flex;
  }

  .menu {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    min-width: 9.5rem;
    max-width: min(15rem, calc(100vw - 1.5rem));
    max-height: min(60vh, 22rem);
    overflow-y: auto;
    padding: 4px;
    border-radius: 10px;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  /* The last trigger's menu hangs off the right edge otherwise. */
  .pop:last-child .menu {
    left: auto;
    right: 0;
    transform: none;
  }

  .menu-item {
    width: 100%;
    min-height: 2rem;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0 0.5rem;
    border-radius: 6px;
    font-size: 0.875rem;
    color: var(--ink);
    text-align: left;
  }

  .menu-item.on {
    color: var(--accent);
    background: var(--accent-subtle);
  }

  .name {
    flex: 1 1 auto;
  }
</style>
