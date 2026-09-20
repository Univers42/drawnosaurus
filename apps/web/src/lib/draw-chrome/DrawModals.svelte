<script lang="ts">
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import type { DrawElementDto } from "@drawnosaurus/contract";
  import type { PeerCursor } from "../realtime/realtimeClient.ts";
  import type { MenuElementInfo } from "./menu.ts";
  import DrawMainMenu from "./DrawMainMenu.svelte";
  import DrawExportModal from "./DrawExportModal.svelte";
  import DrawMermaidModal from "./DrawMermaidModal.svelte";
  import DrawShareModal from "./DrawShareModal.svelte";
  import DrawShortcutsDialog from "./DrawShortcutsDialog.svelte";
  import DrawContextMenu from "./DrawContextMenu.svelte";

  let {
    engine,
    themeMode,
    slug = "",
    peers = [],
    menu = $bindable(null),
    showMainMenu = $bindable(false),
    showExport = $bindable(false),
    showMermaid = $bindable(false),
    showShare = $bindable(false),
    showShortcuts = $bindable(false),
    onToggleTheme,
    onInsertMermaid,
  }: {
    engine: DrawEngine | null;
    themeMode: "light" | "dark";
    slug?: string;
    peers?: PeerCursor[];
    menu: { x: number; y: number; element: MenuElementInfo | null } | null;
    showMainMenu: boolean;
    showExport: boolean;
    showMermaid: boolean;
    showShare: boolean;
    showShortcuts: boolean;
    onToggleTheme: () => void;
    onInsertMermaid: (elements: DrawElementDto[]) => void;
  } = $props();
</script>

{#if showMainMenu}
  <DrawMainMenu
    {engine}
    {themeMode}
    {onToggleTheme}
    onOpenExport={() => (showExport = true)}
    onOpenMermaid={() => (showMermaid = true)}
    onClose={() => (showMainMenu = false)}
  />
{/if}

{#if showExport}
  <DrawExportModal {engine} onClose={() => (showExport = false)} />
{/if}

{#if showMermaid}
  <DrawMermaidModal onInsert={onInsertMermaid} onClose={() => (showMermaid = false)} />
{/if}

{#if showShare}
  <DrawShareModal {slug} {peers} onClose={() => (showShare = false)} />
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
    onClose={() => {
      menu = null;
    }}
  />
{/if}
