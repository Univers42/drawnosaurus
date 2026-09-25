<script lang="ts">
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import type { DrawElementDto } from "@drawnosaurus/contract";
  import type { ConnectionStatus, PeerCursor } from "../realtime/realtimeClient.ts";
  import type { MenuElementInfo } from "./menu.ts";
  import DrawExportModal from "./DrawExportModal.svelte";
  import DrawMermaidModal from "./DrawMermaidModal.svelte";
  import DrawShareModal from "./DrawShareModal.svelte";
  import DrawShortcutsDialog from "./DrawShortcutsDialog.svelte";
  import DrawContextMenu from "./DrawContextMenu.svelte";

  let {
    engine,
    slug = "",
    peers = [],
    connectionStatus = "disconnected",
    menu = $bindable(null),
    showMainMenu = $bindable(false),
    showExport = $bindable(false),
    showMermaid = $bindable(false),
    showShare = $bindable(false),
    showShortcuts = $bindable(false),
    onInsertMermaid,
    onEditEmbedLink,
    onCopyStyles,
  }: {
    engine: DrawEngine | null;
    slug?: string;
    peers?: PeerCursor[];
    connectionStatus?: ConnectionStatus;
    menu: { x: number; y: number; element: MenuElementInfo | null } | null;
    showMainMenu: boolean;
    showExport: boolean;
    showMermaid: boolean;
    showShare: boolean;
    showShortcuts: boolean;
    onInsertMermaid: (elements: DrawElementDto[]) => void;
    onEditEmbedLink: (id: string) => void;
    onCopyStyles: () => void;
  } = $props();

  /**
   * One Escape handler for every layer instead of one inside each dialog. These stack
   * — export and mermaid are opened *from* the main menu — so the key has to dismiss
   * the topmost one, and a rule that lives in five places drifts. Innermost first;
   * with nothing open the event is left alone for the canvas.
   */
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;

    if (menu) menu = null;
    else if (showExport) showExport = false;
    else if (showMermaid) showMermaid = false;
    else if (showShare) showShare = false;
    else if (showShortcuts) showShortcuts = false;
    else if (showMainMenu) showMainMenu = false;
    else return;

    event.preventDefault();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if showExport}
  <DrawExportModal {engine} onClose={() => (showExport = false)} />
{/if}

{#if showMermaid}
  <DrawMermaidModal onInsert={onInsertMermaid} onClose={() => (showMermaid = false)} />
{/if}

{#if showShare}
  <DrawShareModal {slug} {peers} {connectionStatus} onClose={() => (showShare = false)} />
{/if}

{#if showShortcuts}
  <DrawShortcutsDialog onClose={() => (showShortcuts = false)} />
{/if}

{#if menu}
  <DrawContextMenu
    x={menu.x}
    y={menu.y}
    element={menu.element}
    onPickArrowhead={(patch) => {
      engine?.setArrowheads(patch);
      menu = menu?.element?.linear
        ? { ...menu, element: { ...menu.element, linear: { ...menu.element.linear, ...patch } } }
        : menu;
    }}
    onRun={(action) => {
      if (engine && menu) action(engine, engine.screenToWorld(menu.x, menu.y));
      menu = null;
    }}
    onCopyStyles={() => {
      menu = null;
      onCopyStyles();
    }}
    onEditLink={(id) => {
      menu = null;
      onEditEmbedLink(id);
    }}
    onClose={() => {
      menu = null;
    }}
  />
{/if}
