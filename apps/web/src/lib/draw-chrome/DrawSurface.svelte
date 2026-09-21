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
  import { cursorForTool, styleOf } from "./style.ts";
  import { zoomPercent } from "./camera.ts";
  import {
    persistCanvasBackground,
    persistThemePreference,
    readCanvasBackground,
    readThemePreference,
    resolveThemeMode,
    themeFromCss,
    type ThemeMode,
    type ThemePreference,
  } from "./theme.ts";
  import { menuElementFromSelection, type MenuElementInfo } from "./menu.ts";
  import { type ExtendedTool } from "./tools.ts";
  import { createStickyNote } from "../notes/stickyNotes.ts";
  import { RealtimeChannel, type PeerCursor } from "../realtime/realtimeClient.ts";
  import type { StampedElement } from "../autosave/sceneDiff.ts";
  import DrawHeader from "./DrawHeader.svelte";
  import DrawMainMenu from "./DrawMainMenu.svelte";
  import { downloadBlob } from "./download.ts";
  import DrawToolbar from "./DrawToolbar.svelte";
  import DrawInspector from "./DrawInspector.svelte";
  import DrawZoomBar from "./DrawZoomBar.svelte";
  import DrawTextEditor from "./DrawTextEditor.svelte";
  import DrawModals from "./DrawModals.svelte";
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
  let themeMode = $state<ThemeMode>("light");
  let themePreference = $state<ThemePreference>("light");
  let canvasBackground = $state<string | null>(null);
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
  let realtime: RealtimeChannel<StampedElement> | null = null;
  let raf = 0;
  let pending: Camera | null = null;
  // The tool's cursor is the floor; the engine's hover answer wins when it has one, and
  // it only ever has one while the pointer is actually over the canvas.
  const toolCursor = $derived(cursorForTool(tool === "sticky" ? "rectangle" : tool));

  function syncStyle(source: DrawEngine | null): void {
    if (!source) return;
    const first = source.getSelectedElements()[0];
    activeStyle = first ? styleOf(first) : source.getNextStyle();
  }

  /** Whether the OS is currently asking for a dark UI. */
  function systemPrefersDark(): boolean {
    return (
      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }

  /**
   * Repaints for the current preference.
   *
   * Split from the click handler because "system" has to be re-applied whenever the OS
   * changes its mind, not only when the user picks something.
   */
  function applyTheme(): void {
    themeMode = resolveThemeMode(themePreference, systemPrefersDark());
    const base = themeMode === "dark" ? DARK_THEME : LIGHT_THEME;
    theme = { ...base, background: canvasBackground ?? base.background };
    ink = themeMode === "dark" ? "#f8f9fa" : "#1e1e1e";
    engine?.setTheme(theme);
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", themeMode === "dark");
    }
    const cur = engine?.getNextStyle();
    if (cur && (cur.strokeColor === "#1e1e1e" || cur.strokeColor === "#f8f9fa")) {
      engine?.setNextStyle({ strokeColor: ink });
      syncStyle(engine);
    }
  }

  function pickTheme(preference: ThemePreference): void {
    themePreference = preference;
    persistThemePreference(
      typeof localStorage === "undefined" ? undefined : localStorage,
      preference,
    );
    applyTheme();
  }

  function pickCanvasBackground(color: string): void {
    canvasBackground = color;
    persistCanvasBackground(typeof localStorage === "undefined" ? undefined : localStorage, color);
    applyTheme();
  }

  function handleToolSelect(next: ExtendedTool): void {
    if (next === "sticky") {
      if (engine && typeof window !== "undefined") {
        const c = engine.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        const [note, text] = createStickyNote(c.x - 90, c.y - 90, "", "yellow");
        engine.pasteJson(JSON.stringify({ type: "osidraw", version: 1, elements: [note, text] }));
      }
      tool = "select";
      engine?.setTool("select");
    } else {
      tool = next;
      engine?.setTool(next);
      // Deliberately NOT calling setArrowheads here. It mutates the *current
      // selection*, and after drawing a shape that selection is the shape you just
      // drew — so picking the line tool silently stripped the head off the arrow
      // before it. Picking a tool must never edit an existing element. The engine
      // already defaults an arrow's head from its type (render::default_arrowhead),
      // so this was redundant as well as harmful.
      syncStyle(engine);
    }
  }

  function handleSceneChange(json: string): void {
    onSceneChange?.(json);
    if (!realtime) return;
    try {
      const data = JSON.parse(json);
      // The engine reports a delta for the common path and the full scene only for the
      // structural changes a delta cannot describe. Broadcast whichever arrived —
      // reading only `elements` would have silently stopped collaborating the moment
      // deltas landed, and reading only `updated` would break z-order changes.
      const elements: StampedElement[] = Array.isArray(data.updated)
        ? data.updated
        : Array.isArray(data.elements)
          ? data.elements
          : [];
      if (elements.length > 0) {
        realtime.sendPatch({ elements });
      }
    } catch {
      // A malformed payload is not worth tearing the session down for.
    }
  }

  onMount(() => {
    // Apply the stored choice *before* reading the tokens: themeFromCss resolves the
    // canvas colours off the host CSS variables, and the `dark` class is what swaps
    // them. Reading first would hand the engine a white canvas under dark chrome.
    themePreference = readThemePreference(localStorage);
    canvasBackground = readCanvasBackground(localStorage);
    themeMode = resolveThemeMode(themePreference, systemPrefersDark());
    document.documentElement.classList.toggle("dark", themeMode === "dark");

    const resolved = themeFromCss(
      getComputedStyle(document.documentElement),
      undefined,
      canvasBackground,
    );
    theme = resolved.theme;
    ink = resolved.ink;

    // "System" is a standing instruction, so it has to keep following the OS while the
    // board is open — not only at the moment it was chosen.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemThemeChange = (): void => {
      if (themePreference === "system") applyTheme();
    };
    media.addEventListener("change", onSystemThemeChange);

    let unsub: (() => void) | undefined;
    if (slug) {
      realtime = new RealtimeChannel(slug);
      realtime.connect();
      unsub = realtime.onPeers((list) => {
        peers = list;
      });
      realtime.onRemotePatch((patch) => {
        if (!engine || !patch.elements?.length) return;
        // Merge by id, never paste. `pasteJson` mints fresh ids, so feeding remote
        // edits through it duplicated every one of them — and because the result was
        // then broadcast back, two clients grew the board without bound. A four-element
        // board reached 8,273 elements and three frames a second that way.
        //
        // `applyRemotePatch` also emits no scene event, so nothing echoes back to the
        // peer that sent it.
        engine.applyRemotePatch(
          JSON.stringify({ type: "osidraw", version: 1, elements: patch.elements }),
        );
      });
    }

    return () => {
      media.removeEventListener("change", onSystemThemeChange);
      unsub?.();
      realtime?.disconnect();
    };
  });

  onDestroy(() => {
    if (raf) cancelAnimationFrame(raf);
    if (cursorRaf) cancelAnimationFrame(cursorRaf);
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

  // Peer-cursor broadcast, rAF-coalesced.
  //
  // This used to run on every raw mousemove — ~120/s on a high-polling mouse — and each
  // one did `engine.screenToWorld`, which is a WASM call that serialises the camera to
  // JSON in Rust and parses it back in JS, followed by an unthrottled WebSocket frame.
  // It also fired while the pointer was merely over the toolbar, because the handler sat
  // on the outermost chrome div.
  //
  // Now: bound to the canvas, at most one computation per frame, skipped entirely when
  // the pointer has not moved a whole pixel, and the camera comes from the `currentCamera`
  // the engine already pushes to us — so there is no WASM hop at all.
  let cursorRaf = 0;
  let cursorPending: { x: number; y: number } | null = null;
  let lastSent = { x: Number.NaN, y: Number.NaN };

  // What the pointer is over, asked of the engine rather than guessed from the tool.
  //
  // The canvas is a single element, so the cursor is the only way to say that this pixel
  // resizes and that one moves. Without it the difference is discovered by dragging,
  // which is how a resize that was meant to be a move happens.
  let hoverCursor = $state<string | null>(null);
  let hoverPending: { x: number; y: number } | null = null;

  function onCanvasPointerMove(e: MouseEvent): void {
    const target = e.currentTarget as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    hoverPending = { x: sx, y: sy };

    if (realtime && currentCamera) {
      // Inverse of the engine's world_to_screen (`wx * scale + camera.x`).
      cursorPending = {
        x: (sx - currentCamera.x) / currentCamera.scale,
        y: (sy - currentCamera.y) / currentCamera.scale,
      };
    }

    if (cursorRaf) return;
    cursorRaf = requestAnimationFrame(() => {
      cursorRaf = 0;

      // One hover query per frame, not per raw mousemove — a high-polling mouse emits
      // several times more events than there are frames to show them in.
      const at = hoverPending;
      hoverPending = null;
      if (at && engine) hoverCursor = engine.hoverCursor(at.x, at.y);

      const next = cursorPending;
      cursorPending = null;
      if (!next || !realtime) return;
      if (Math.abs(next.x - lastSent.x) < 1 && Math.abs(next.y - lastSent.y) < 1) return;
      lastSent = next;
      realtime.sendCursor(next.x, next.y);
    });
  }

  function onCanvasPointerLeave(): void {
    hoverCursor = null;
  }

  let mainMenu = $state.raw<DrawMainMenu | null>(null);

  /**
   * The shortcuts the main menu advertises.
   *
   * They live here rather than in the engine's key handler because they are application
   * actions — open a file, save one, open a dialog — not canvas edits. A menu that
   * prints "Ctrl+O" next to an item and then ignores the key is worse than one that
   * prints nothing.
   *
   * Skipped while a text field has focus, so typing in the title or the text editor is
   * never intercepted.
   */
  function onAppShortcut(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (mod && event.shiftKey && key === "e") {
      event.preventDefault();
      showExport = true;
    } else if (mod && key === "o") {
      event.preventDefault();
      // The file picker lives inside the menu, so the menu has to exist to open it.
      showMainMenu = true;
      queueMicrotask(() => mainMenu?.openFile());
    } else if (mod && key === "s") {
      event.preventDefault();
      if (engine) {
        downloadBlob(
          "drawing.osidraw",
          new Blob([engine.exportJson()], { type: "application/json" }),
        );
      }
    } else if (!mod && event.key === "?") {
      event.preventDefault();
      showShortcuts = true;
    }
  }
</script>

<svelte:window onkeydown={onAppShortcut} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="draw-chrome" style:cursor={hoverCursor ?? toolCursor}>
  <DrawHeader
    {title}
    {status}
    onToggleMenu={() => (showMainMenu = !showMainMenu)}
    onOpenShare={() => (showShare = true)}
    onOpenShortcuts={() => (showShortcuts = true)}
  >
    {#snippet menu()}
      {#if showMainMenu}
        <DrawMainMenu
          bind:this={mainMenu}
          {engine}
          {themePreference}
          {canvasBackground}
          onPickTheme={pickTheme}
          onPickCanvasBackground={pickCanvasBackground}
          onOpenExport={() => (showExport = true)}
          onOpenMermaid={() => (showMermaid = true)}
          onOpenShare={() => (showShare = true)}
          onOpenShortcuts={() => (showShortcuts = true)}
          onClose={() => (showMainMenu = false)}
        />
      {/if}
    {/snippet}
  </DrawHeader>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="canvas-host" onmousemove={onCanvasPointerMove} onmouseleave={onCanvasPointerLeave}>
    <DrawCanvas
      {scene}
      {theme}
      defaultStroke={ink}
      {ariaLabel}
      onSceneChange={handleSceneChange}
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
  </div>

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

  <DrawInspector
    style={activeStyle}
    {selectedCount}
    {engine}
    {themeMode}
    onApply={(patch) => {
      if (selectedCount > 0) {
        engine?.applyStyle(patch);
      } else {
        engine?.setNextStyle(patch);
      }
      syncStyle(engine);
    }}
  />

  <DrawZoomBar {engine} {zoom} {contentVisible} />

  {#if textEdit && engine}
    <DrawTextEditor
      {engine}
      request={textEdit}
      fontSizePx={(textEdit.fontSize * zoom) / 100}
      onDone={() => (textEdit = null)}
    />
  {/if}

  <DrawModals
    {engine}
    {slug}
    {peers}
    bind:menu
    bind:showMainMenu
    bind:showExport
    bind:showMermaid
    bind:showShare
    bind:showShortcuts
    onInsertMermaid={(elements) => {
      if (engine) engine.pasteJson(JSON.stringify({ type: "osidraw", version: 1, elements }));
    }}
  />
</div>
