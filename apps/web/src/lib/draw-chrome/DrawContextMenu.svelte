<script lang="ts">
  import { tick } from "svelte";
  import type { Arrowhead } from "@osionos/draw-engine/types";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import { clampMenuPosition, type MenuElementInfo } from "./menu.ts";
  import { shortcutLabel, zOrderShortcut } from "./shortcuts.ts";
  import DrawMenuExtremity from "./DrawMenuExtremity.svelte";

  let {
    x,
    y,
    element,
    onPickArrowhead,
    onRun,
    onEditLink,
    onClose,
  }: {
    x: number;
    y: number;
    element: MenuElementInfo | null;
    onPickArrowhead: (patch: { start?: Arrowhead; end?: Arrowhead }) => void;
    onRun: (action: (engine: DrawEngine, at: { x: number; y: number }) => void) => void;
    onEditLink: (id: string) => void;
    onClose: () => void;
  } = $props();

  let menuEl: HTMLDivElement | undefined;
  let pos = $state({ left: 0, top: 0 });

  $effect(() => {
    void x;
    void y;
    void tick().then(() => {
      const menu = menuEl;
      const host = menu?.offsetParent as HTMLElement | null;
      if (!menu || !host) return;
      pos = clampMenuPosition(
        x,
        y,
        { width: menu.offsetWidth, height: menu.offsetHeight },
        { width: host.clientWidth, height: host.clientHeight },
      );
    });
  });
</script>

<button
  type="button"
  class="away"
  aria-label="Close menu"
  onclick={onClose}
  oncontextmenu={(event) => {
    event.preventDefault();
    onClose();
  }}
></button>

<div
  bind:this={menuEl}
  class="draw-panel menu"
  role="menu"
  tabindex="-1"
  aria-label="Canvas menu"
  style:left={`${pos.left}px`}
  style:top={`${pos.top}px`}
  onkeydown={(event) => {
    if (event.key === "Escape") onClose();
  }}
>
  {#if element?.linear}
    <DrawMenuExtremity
      title="Start"
      active={element.linear.start}
      onSelect={(kind) => onPickArrowhead({ start: kind })}
    />
    <DrawMenuExtremity
      title="End"
      active={element.linear.end}
      onSelect={(kind) => onPickArrowhead({ end: kind })}
    />
    <div class="rule" aria-hidden="true"></div>
  {/if}

  {#if element?.embedId}
    {@const id = element.embedId}
    <button type="button" role="menuitem" onclick={() => onEditLink(id)}>
      <span>Edit link…</span>
    </button>
    <div class="rule" aria-hidden="true"></div>
  {/if}

  {#if element}
    <button
      type="button"
      role="menuitem"
      onclick={() => onRun((engine) => engine.duplicateSelection())}
    >
      <span>Duplicate</span><span class="hint">{shortcutLabel("CtrlOrCmd+D")}</span>
    </button>
    <button type="button" role="menuitem" onclick={() => onRun((engine) => engine.copySelection())}>
      <span>Copy</span><span class="hint">{shortcutLabel("CtrlOrCmd+C")}</span>
    </button>
    <div class="rule" aria-hidden="true"></div>
    <!-- Excalidraw's copy/paste styles (`actions/actionStyles.ts@1118751f:51-236`). -->
    <button type="button" role="menuitem" onclick={() => onRun((engine) => engine.copyStyles())}>
      <span>Copy styles</span><span class="hint">{shortcutLabel("CtrlOrCmd+Alt+C")}</span>
    </button>
    <button type="button" role="menuitem" onclick={() => onRun((engine) => engine.pasteStyles())}>
      <span>Paste styles</span><span class="hint">{shortcutLabel("CtrlOrCmd+Alt+V")}</span>
    </button>
    <div class="rule" aria-hidden="true"></div>
    <button
      type="button"
      role="menuitem"
      onclick={() => onRun((engine) => engine.reorderSelection("front"))}
    >
      <span>Bring to front</span><span class="hint">{zOrderShortcut("front")}</span>
    </button>
    <button
      type="button"
      role="menuitem"
      onclick={() => onRun((engine) => engine.reorderSelection("forward"))}
    >
      <span>Bring forward</span><span class="hint">{zOrderShortcut("forward")}</span>
    </button>
    <button
      type="button"
      role="menuitem"
      onclick={() => onRun((engine) => engine.reorderSelection("backward"))}
    >
      <span>Send backward</span><span class="hint">{zOrderShortcut("backward")}</span>
    </button>
    <button
      type="button"
      role="menuitem"
      onclick={() => onRun((engine) => engine.reorderSelection("back"))}
    >
      <span>Send to back</span><span class="hint">{zOrderShortcut("back")}</span>
    </button>
    <div class="rule" aria-hidden="true"></div>
    <button
      type="button"
      role="menuitem"
      onclick={() => onRun((engine) => engine.flipSelection("horizontal"))}
    >
      <span>Flip horizontal</span><span class="hint">⇧H</span>
    </button>
    <button
      type="button"
      role="menuitem"
      onclick={() => onRun((engine) => engine.flipSelection("vertical"))}
    >
      <span>Flip vertical</span><span class="hint">⇧V</span>
    </button>
    {#if element.multi && !element.grouped}
      <button
        type="button"
        role="menuitem"
        onclick={() => onRun((engine) => engine.groupSelection())}
      >
        <span>Group</span><span class="hint">{shortcutLabel("CtrlOrCmd+G")}</span>
      </button>
    {/if}
    {#if element.grouped}
      <button
        type="button"
        role="menuitem"
        onclick={() => onRun((engine) => engine.ungroupSelection())}
      >
        <span>Ungroup</span><span class="hint">{shortcutLabel("CtrlOrCmd+Shift+G")}</span>
      </button>
    {/if}
    <button
      type="button"
      role="menuitem"
      onclick={() => onRun((engine) => engine.toggleLockSelection())}
    >
      <span>{element.locked ? "Unlock" : "Lock"}</span>
    </button>
    <div class="rule" aria-hidden="true"></div>
    <button
      type="button"
      class="danger"
      role="menuitem"
      onclick={() => onRun((engine) => engine.deleteSelection())}
    >
      <span>Delete</span><span class="hint">⌫</span>
    </button>
  {:else}
    <button
      type="button"
      role="menuitem"
      onclick={() => onRun((engine, at) => engine.pasteJson(null, at))}
    >
      <span>Paste</span><span class="hint">{shortcutLabel("CtrlOrCmd+V")}</span>
    </button>
    <button type="button" role="menuitem" onclick={() => onRun((engine) => engine.selectAll())}>
      <span>Select all</span><span class="hint">{shortcutLabel("CtrlOrCmd+A")}</span>
    </button>
    <button type="button" role="menuitem" onclick={() => onRun((engine) => engine.fit())}>
      <span>Zoom to fit</span><span class="hint">⇧1</span>
    </button>
  {/if}
</div>

<style>
  .away {
    position: absolute;
    inset: 0;
    z-index: 4;
    cursor: default;
    background: transparent;
    border-radius: 0;
  }

  .menu {
    position: absolute;
    z-index: 5;
    width: 14rem;
    border-radius: 8px;
    padding: 4px 0;
  }

  .menu > button {
    display: flex;
    height: 32px;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 0 12px;
    font-size: 13px;
    text-align: left;
    border-radius: 0;
  }

  .menu > button:hover {
    background: var(--bg-hover);
  }

  .danger {
    color: var(--danger);
  }

  .hint {
    font-size: 11px;
    color: var(--muted);
  }

  .rule {
    height: 1px;
    margin: 4px 0;
    background: var(--line);
  }
</style>
