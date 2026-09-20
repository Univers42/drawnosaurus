<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { DrawCanvas } from "@osionos/draw-engine/svelte";
  import { DARK_THEME, DEFAULT_ELEMENT_STYLE, LIGHT_THEME } from "@osionos/draw-engine/types";
  import type {
    Camera,
    DrawElementStyle,
    DrawTheme,
    DrawTool,
    Scene,
    TextEditRequest,
  } from "@osionos/draw-engine/types";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import type { DrawElementDto } from "@drawnosaurus/contract";
  import { cursorForTool, styleOf } from "./style.ts";
  import { zoomPercent } from "./camera.ts";
  import { themeFromCss } from "./theme.ts";
  import { menuElementFromSelection, type MenuElementInfo } from "./menu.ts";
  import { type ExtendedTool } from "./tools.ts";
  import { createStickyNote } from "../notes/stickyNotes.ts";
  import { RealtimeChannel, type PeerCursor } from "../realtime/realtimeClient.ts";
  import DrawHeader from "./DrawHeader.svelte";
  import DrawMainMenu from "./DrawMainMenu.svelte";
  import DrawToolbar from "./DrawToolbar.svelte";
  import DrawInspector from "./DrawInspector.svelte";
  import DrawZoomBar from "./DrawZoomBar.svelte";
  import DrawTextEditor from "./DrawTextEditor.svelte";
  import DrawContextMenu from "./DrawContextMenu.svelte";
  import DrawMermaidModal from "./DrawMermaidModal.svelte";
  import DrawExportModal from "./DrawExportModal.svelte";
  import DrawShareModal from "./DrawShareModal.svelte";
  import DrawShortcutsDialog from "./DrawShortcutsDialog.svelte";
  import PeerCursors from "./PeerCursors.svelte";
  import "./draw-chrome.css";

  let {
    scene,
    title = "Untitled",
    slug = "",
    status = "idle",
    ariaLabel = "Drawing canvas",
    onSceneChange,
    onReady,
  }: {
    scene: Scene;
    title?: string;
    slug?: string;
    status?: string;
    ariaLabel?: string;
    onSceneChange?: (json: string) => void;
    onReady?: (engine: DrawEngine) => void;
  } = $props();

  let engine = $state.raw<DrawEngine | null>(null);
  let theme = $state<DrawTheme>(LIGHT_THEME);
  let themeMode = $state<"light" | "dark">("light");
  let ink = $state("#1e1e1e");
  let tool = $state<ExtendedTool>("select");
  let toolLocked = $state(false);
  let selectedCount = $state(0);
  let activeStyle = $state<DrawElementStyle>(DEFAULT_ELEMENT_STYLE);
  let textEdit = $state<TextEditRequest | null>(null);
  let zoom = $state(100);
  let contentVisible = $state(true);
  let currentCamera = $state<Camera | undefined>(undefined);
  let menu = $state<{ x: number; y: number; element: MenuElementInfo | null } | null>(null);

  // Modals state
  let showMainMenu = $state(false);
  let showExport = $state(false);
  let showMermaid = $state(false);
  let showShare = $state(false);
  let showShortcuts = $state(false);

  // Realtime
  let peers = $state<PeerCursor[]>([]);
  let realtime: RealtimeChannel<never> | null = null;

  let raf = 0;
  let pending: Camera | null = null;
  const cursor = $derived(cursorForTool(tool === "sticky" ? "rectangle" : tool));

  function syncStyle(source: DrawEngine | null): void {
    if (!source) return;
    const first = source.getSelectedElements()[0];
    activeStyle = first ? styleOf(first) : source.getNextStyle();
  }

  function toggleTheme(): void {
    themeMode = themeMode === "dark" ? "light" : "dark";
    theme = themeMode === "dark" ? DARK_THEME : LIGHT_THEME;
    ink = themeMode === "dark" ? "#f8f9fa" : "#1e1e1e";
    engine?.setTheme(theme);
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", themeMode === "dark");
    }
  }

  function handleToolSelect(next: ExtendedTool): void {
    if (next === "sticky") {
      if (engine && typeof window !== "undefined") {
        const center = engine.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        const [note, text] = createStickyNote(center.x - 90, center.y - 90, "", "yellow");
        engine.pasteJson(JSON.stringify({ type: "osidraw", version: 1, elements: [note, text] }));
      }
      tool = "select";
      engine?.setTool("select");
    } else {
      tool = next;
      engine?.setTool(next);
    }
  }

  function handleInsertMermaid(elements: DrawElementDto[]): void {
    if (!engine) return;
    const payload = JSON.stringify({ type: "osidraw", version: 1, elements });
    engine.pasteJson(payload);
  }

  onMount(() => {
    const resolved = themeFromCss(getComputedStyle(document.documentElement));
    theme = resolved.theme;
    ink = resolved.ink;

    let unsub: (() => void) | undefined;
    if (slug) {
      realtime = new RealtimeChannel(slug);
      realtime.connect();
      unsub = realtime.onPeers((list) => {
        peers = list;
      });
    }

    return () => {
      unsub?.();
      realtime?.disconnect();
    };
  });

  onDestroy(() => {
    if (raf) cancelAnimationFrame(raf);
    realtime?.disconnect();
  });

  function onCameraChange(camera: Camera): void {
    pending = camera;
    currentCamera = camera;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const latest = pending;
      pending = null;
      if (!latest) return;
      zoom = zoomPercent(latest.scale);
      contentVisible = engine?.contentInView() ?? true;
    });
  }

  function onCanvasPointerMove(e: MouseEvent): void {
    if (!realtime || !engine) return;
    const world = engine.screenToWorld(e.clientX, e.clientY);
    realtime.sendCursor(world.x, world.y);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="draw-chrome" style:cursor onmousemove={onCanvasPointerMove}>
  <DrawHeader
    {title}
    {status}
    onToggleMenu={() => (showMainMenu = !showMainMenu)}
    onOpenShare={() => (showShare = true)}
    onOpenShortcuts={() => (showShortcuts = true)}
  />

  <DrawCanvas
    {scene}
    {theme}
    defaultStroke={ink}
    {ariaLabel}
    {onSceneChange}
    {onCameraChange}
    onReady={(next) => {
      engine = next;
      syncStyle(next);
      onReady?.(next);
    }}
    onToolChange={(next: DrawTool) => {
      tool = next;
    }}
    onSelectionChange={(ids) => {
      selectedCount = ids.length;
      syncStyle(engine);
    }}
    onRequestTextEdit={(request) => {
      textEdit = request;
    }}
    onContextMenu={(point) => {
      if (!engine) return;
      menu = {
        x: point.x,
        y: point.y,
        element: menuElementFromSelection(
          engine.getSelectedElements(),
          engine.selectionLocked(),
          engine.selectionIsGroup(),
        ),
      };
    }}
    onToolLockChange={(locked) => {
      toolLocked = locked;
    }}
  />

  <PeerCursors {peers} camera={currentCamera} />

  <DrawToolbar
    active={tool}
    {toolLocked}
    onSelect={handleToolSelect}
    onToggleToolLock={() => {
      if (!engine) return;
      engine.setToolLocked(!engine.getToolLocked());
      toolLocked = engine.getToolLocked();
    }}
  />

  {#if selectedCount > 0}
    <DrawInspector
      style={activeStyle}
      {selectedCount}
      {engine}
      onApply={(patch) => {
        engine?.applyStyle(patch);
        syncStyle(engine);
      }}
    />
  {/if}

  <DrawZoomBar {engine} {zoom} {contentVisible} />

  {#if textEdit && engine}
    <DrawTextEditor
      {engine}
      request={textEdit}
      fontSizePx={(textEdit.fontSize * zoom) / 100}
      onDone={() => (textEdit = null)}
    />
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

  {#if showMainMenu}
    <DrawMainMenu
      {engine}
      {themeMode}
      onToggleTheme={toggleTheme}
      onOpenExport={() => (showExport = true)}
      onOpenMermaid={() => (showMermaid = true)}
      onClose={() => (showMainMenu = false)}
    />
  {/if}

  {#if showExport}
    <DrawExportModal {engine} onClose={() => (showExport = false)} />
  {/if}

  {#if showMermaid}
    <DrawMermaidModal onInsert={handleInsertMermaid} onClose={() => (showMermaid = false)} />
  {/if}

  {#if showShare}
    <DrawShareModal {slug} {peers} onClose={() => (showShare = false)} />
  {/if}

  {#if showShortcuts}
    <DrawShortcutsDialog onClose={() => (showShortcuts = false)} />
  {/if}
</div>
