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
  import DrawPublicShareModal from "./DrawPublicShareModal.svelte";
  import DrawShortcutsDialog from "./DrawShortcutsDialog.svelte";
  import DrawCommandPalette from "./DrawCommandPalette.svelte";
  import DrawContextMenu from "./DrawContextMenu.svelte";
  import type { ClipboardFormatName } from "@osionos/draw-engine/types";
  import { BROWSER_MODE } from "../mode.ts";
  import VectorizeDialog from "./VectorizeDialog.svelte";

  let {
    engine,
    slug = "",
    peers = [],
    connectionStatus = "disconnected",
    secret = null,
    onShareLive,
    menu = $bindable(null),
    showMainMenu = $bindable(false),
    showExport = $bindable(false),
    showMermaid = $bindable(false),
    showTemplates = $bindable(false),
    showShare = $bindable(false),
    showShortcuts = $bindable(false),
    showPalette = $bindable(false),
    paletteCommands = [],
    paletteRecentId = null,
    vectorizeId = $bindable(null),
    onInsertMermaid,
    onInsertTemplate,
    onEditEmbedLink,
    onCopyStyles,
    onCopyToClipboard,
    onFit,
    onPaletteRun,
  }: {
    engine: DrawEngine | null;
    slug?: string;
    peers?: PeerCursor[];
    connectionStatus?: ConnectionStatus;
    /** The public build's: the drawing's secret, when it is shared. */
    secret?: Uint8Array | null;
    /** The public build's: "Share live", which mints the secret and writes the first copy. */
    onShareLive?: () => Promise<string>;
    menu: { x: number; y: number; element: MenuElementInfo | null; unlockAll: boolean } | null;
    showMainMenu: boolean;
    showExport: boolean;
    showMermaid: boolean;
    showTemplates: boolean;
    showShare: boolean;
    showShortcuts: boolean;
    showPalette: boolean;
    paletteCommands?: Command[];
    /** The one command the palette remembers, owned by the surface so it survives this
     *  dialog closing (`CommandPalette.tsx@1118751f:85` keeps it outside the dialog too). */
    paletteRecentId?: string | null;
    /** The image the Vectorize dialog is open for. Bound, like every other modal flag
     *  here, so the palette's command can open it as well as the context menu's row. */
    vectorizeId?: string | null;
    onInsertMermaid: (elements: DrawElementDto[]) => void;
    onInsertTemplate: (json: string) => void;
    onEditEmbedLink: (id: string) => void;
    onCopyStyles: () => void;
    /** Copy as a picture to the clipboard; the engine decides what, this reports how. */
    onCopyToClipboard: (format: ClipboardFormatName) => void;
    /** Shift+1, measured against the chrome where it is now. */
    onFit: () => void;
    onPaletteRun: (id: string) => void;
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
  <!-- Two Share dialogs, one per build: the server's offers the links it can serve, and
       the public build's the one link the online copy and the relay make. The mode is
       read here, so each build carries only its own dialog. -->
  {#if BROWSER_MODE}
    <DrawPublicShareModal
      {slug}
      {secret}
      onShare={onShareLive}
      onClose={() => (showShare = false)}
    />
  {:else}
    <DrawShareModal {slug} {peers} {connectionStatus} onClose={() => (showShare = false)} />
  {/if}
{/if}

{#if showShortcuts}
  <DrawShortcutsDialog onClose={() => (showShortcuts = false)} />
{/if}

{#if showPalette}
  <DrawCommandPalette
    commands={paletteCommands}
    recentId={paletteRecentId}
    onRun={onPaletteRun}
    onClose={() => (showPalette = false)}
  />
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
    onCopyToClipboard={(format) => {
      // The menu closes first, exactly as every other row does: a copy is asynchronous, and
      // a menu that stayed up over the canvas would hide the notice the copy reports.
      menu = null;
      onCopyToClipboard(format);
    }}
    onFit={() => {
      menu = null;
      onFit();
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
