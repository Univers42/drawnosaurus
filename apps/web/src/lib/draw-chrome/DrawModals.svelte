<script lang="ts">
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import type { DrawElementDto } from "@drawnosaurus/contract";
  import type { ConnectionStatus, PeerCursor } from "../realtime/realtimeClient.ts";
  import type { MenuElementInfo } from "./menu.ts";
  import type { Command } from "./commandPalette.ts";
  import DrawExportModal from "./DrawExportModal.svelte";
  import DrawMermaidModal from "./DrawMermaidModal.svelte";
  import DrawTemplatesModal from "./DrawTemplatesModal.svelte";
  import DrawShareModal from "./DrawShareModal.svelte";
  import DrawShortcutsDialog from "./DrawShortcutsDialog.svelte";
  import DrawCommandPalette from "./DrawCommandPalette.svelte";
  import DrawContextMenu from "./DrawContextMenu.svelte";
  import VectorizeDialog from "./VectorizeDialog.svelte";

  let {
    engine,
    slug = "",
    peers = [],
    connectionStatus = "disconnected",
    menu = $bindable(null),
    showMainMenu = $bindable(false),
    showExport = $bindable(false),
    showMermaid = $bindable(false),
    showTemplates = $bindable(false),
    showShare = $bindable(false),
    showShortcuts = $bindable(false),
    showPalette = $bindable(false),
    paletteCommands = [],
    onInsertMermaid,
    onInsertTemplate,
    onEditEmbedLink,
    onCopyStyles,
  }: {
    engine: DrawEngine | null;
    slug?: string;
    peers?: PeerCursor[];
    connectionStatus?: ConnectionStatus;
    menu: { x: number; y: number; element: MenuElementInfo | null; unlockAll: boolean } | null;
    showMainMenu: boolean;
    showExport: boolean;
    showMermaid: boolean;
    showTemplates: boolean;
    showShare: boolean;
    showShortcuts: boolean;
    showPalette: boolean;
    paletteCommands?: Command[];
    onInsertMermaid: (elements: DrawElementDto[]) => void;
    onInsertTemplate: (json: string) => void;
    onEditEmbedLink: (id: string) => void;
    onCopyStyles: () => void;
  } = $props();

  /** The image the Vectorize dialog is open for — opened from the context menu only. */
  let vectorizeId = $state<string | null>(null);

  /**
   * One Escape handler for every layer instead of one inside each dialog. These stack
   * — export and mermaid are opened *from* the main menu — so the key has to dismiss
   * the topmost one, and a rule that lives in five places drifts. Innermost first;
   * with nothing open the event is left alone for the canvas.
   */
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;

    if (menu) menu = null;
    else if (vectorizeId) vectorizeId = null;
    else if (showPalette) showPalette = false;
    else if (showExport) showExport = false;
    else if (showMermaid) showMermaid = false;
    else if (showTemplates) showTemplates = false;
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

{#if showTemplates}
  <DrawTemplatesModal onInsert={onInsertTemplate} onClose={() => (showTemplates = false)} />
{/if}

{#if showShare}
  <DrawShareModal {slug} {peers} {connectionStatus} onClose={() => (showShare = false)} />
{/if}

{#if showShortcuts}
  <DrawShortcutsDialog onClose={() => (showShortcuts = false)} />
{/if}

{#if showPalette}
  <DrawCommandPalette commands={paletteCommands} onClose={() => (showPalette = false)} />
{/if}

{#if vectorizeId}
  <VectorizeDialog {engine} imageId={vectorizeId} onClose={() => (vectorizeId = null)} />
{/if}

{#if menu}
  <DrawContextMenu
    x={menu.x}
    y={menu.y}
    element={menu.element}
    unlockAll={menu.unlockAll}
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
    onVectorize={(id) => {
      menu = null;
      vectorizeId = id;
    }}
    onClose={() => {
      menu = null;
    }}
  />
{/if}
