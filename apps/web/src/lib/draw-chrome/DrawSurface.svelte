<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { DrawCanvas } from "@osionos/draw-engine/svelte";
  import { DARK_THEME, EMPTY_SELECTION_STYLE, LIGHT_THEME } from "@osionos/draw-engine/types";
  import type {
    Camera,
    DrawElementStyle,
    DrawTheme,
    DrawTool,
    Scene,
    TextEditRequest,
  } from "@osionos/draw-engine/types";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import type { DrawPeer } from "@osionos/draw-engine/types";
  import { cursorForTool } from "./style.ts";
  import { zoomPercent } from "./camera.ts";
  import {
    persistCanvasBackground,
    persistThemePreference,
    persistGridPreference,
    persistObjectsSnapPreference,
    pickGridMode,
    readCanvasBackground,
    readGridPreference,
    readObjectsSnapPreference,
    readThemePreference,
    resolveThemeMode,
    themeFromCss,
    toggleObjectsSnap,
    type GridPreference,
    type SnapModes,
    type ThemeMode,
    type ThemePreference,
  } from "./theme.ts";
  import { menuElementFromSelection, type MenuElementInfo } from "./menu.ts";
  import { migrateLegacyStickyJson } from "../notes/stickyNotes.ts";
  import { EraserTrail } from "../eraser/eraserTrail.ts";
  import {
    EMBED_ALLOW,
    EMBED_REFERRER_POLICY,
    frameInnerStyle,
    frameSrc,
    frameStyle,
    isClick,
    isFrameCentre,
    framesToMount,
    parseEmbedFrames,
    playMessage,
    sandboxFor,
    type EmbedFrame,
  } from "./embed.ts";
  import DrawEmbedModal from "./DrawEmbedModal.svelte";
  import {
    IMAGE_ACCEPT,
    describeRejection,
    downscaleImageFile,
    imagesFrom,
    prepareImageFile,
    readImageFile,
  } from "./imageFile.ts";
  import {
    RealtimeChannel,
    type ConnectionStatus,
    type Peer,
    type PeerCursor,
  } from "../realtime/realtimeClient.ts";
  import {
    claimSelection,
    previewInterval,
    resolvePeers,
    type Claims,
  } from "../realtime/peerClaims.ts";
  import { syncPeerLasers } from "../realtime/peerLaser.ts";
  import { importRoomKey, resolveRoomKey } from "../realtime/roomCrypto.ts";
  import { LiveSceneBroadcaster, remotePatchToSceneEvent } from "../realtime/liveBroadcast.ts";
  import type { StampedElement, ScenePatch } from "../autosave/sceneDiff.ts";
  import type { AutosaveStatus } from "../autosave/autosaver.ts";
  import { liveLabel } from "./status.ts";
  import DrawHeader from "./DrawHeader.svelte";
  import DrawMainMenu from "./DrawMainMenu.svelte";
  import { downloadBlob } from "./download.ts";
  import DrawToolbar from "./DrawToolbar.svelte";
  import DrawInspector from "./DrawInspector.svelte";
  import { getShapeActions } from "./shapeActions.ts";
  import { isTextField, styleShortcut, type KeyTarget } from "./shortcuts.ts";
  import { heldNotice, NOTICE_TEXT } from "./notices.ts";
  import DrawZoomBar from "./DrawZoomBar.svelte";
  import DrawTextEditor from "./DrawTextEditor.svelte";
  import { watchFonts } from "./fonts.ts";
  import "./fonts.css";
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
    fetchLatest,
  }: {
    scene: Scene;
    title?: string;
    slug?: string;
    status?: AutosaveStatus;
    ariaLabel?: string;
    onSceneChange?: (json: string) => void;
    onReady?: (engine: DrawEngine) => void;
    /**
     * The board as the server has it now, deleted elements included — read after the
     * live connection comes back, to catch up on what peers did while it was down. The
     * page owns the API; this only knows when to ask.
     */
    fetchLatest?: () => Promise<StampedElement[]>;
  } = $props();

  let engine = $state.raw<DrawEngine | null>(null);
  let theme = $state<DrawTheme>(LIGHT_THEME);
  let themeMode = $state<ThemeMode>("light");
  let themePreference = $state<ThemePreference>("light");
  let canvasBackground = $state<string | null>(null);
  let grid = $state<GridPreference>({ enabled: false, size: 20, step: 5, snap: true });
  /** Snapping to other elements while moving. Off until turned on, as in Excalidraw. */
  let objectsSnap = $state(false);
  let ink = $state("#1e1e1e");
  let tool = $state<DrawTool>("select");
  let toolLocked = $state(false);
  let selectedCount = $state(0);
  /**
   * The engine's `styleRevision()` as last read. It moves on everything that can change
   * what the panel shows — a selection, a style, an undo, a peer's edit to what is
   * selected — so the panel reads the selection once per move and never otherwise.
   */
  let styleRevision = $state(0);
  /** Which picker is open; S, G and Shift+F open them from the keyboard. */
  let openPicker = $state<"stroke" | "background" | "font" | null>(null);

  /**
   * Whether a pointer gesture is in flight on the canvas.
   *
   * The panel's visibility is frozen while one is, which is what stops it appearing
   * mid-drag. Clicking an unselected element selects it *and* starts moving it in the
   * same gesture, so without this the panel pops in under the cursor the instant you
   * start to drag, and pops out again if you drag a marquee across empty space.
   *
   * Set on the **capture** phase. The canvas handles `pointerdown` and changes the
   * selection before the event bubbles this far, so a bubble-phase listener sets the
   * flag a beat too late and the panel has already appeared.
   */
  let dragging = $state(false);

  /**
   * Whether the style panel is on screen.
   *
   * Excalidraw's `showSelectedShapeActions`: a drawing tool is active, so defaults can
   * be set before drawing, or something is selected. Held still during a drag — a panel
   * already open stays open, and one that was closed does not appear until the gesture
   * finishes.
   */
  let panelVisible = $state(false);

  /**
   * Hands the live engine to the dev tools and to the browser tests, and only there.
   *
   * `import.meta.env.DEV` is folded away at build time, so the property does not exist in
   * a production bundle — this is a debugging affordance, not an API. It exists because
   * the alternative for an end-to-end test is to infer the camera from pixels, and a test
   * that reads pixels fails for reasons that have nothing to do with the camera.
   */
  function exposeForDevTools(instance: DrawEngine): void {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __drawEngine?: DrawEngine }).__drawEngine = instance;
  }

  /** What the panel shows: one engine call per `styleRevision`, not one per row. */
  const summary = $derived.by(() => {
    void styleRevision;
    return engine?.selectionStyle() ?? EMPTY_SELECTION_STYLE;
  });
  const shapeActions = $derived(
    getShapeActions(tool, summary, summary.backgroundColor ?? "transparent"),
  );

  $effect(() => {
    const want = shapeActions.visible;
    if (!dragging) panelVisible = want;
  });
  let textEdit = $state<TextEditRequest | null>(null);
  /**
   * Moves when the text being typed may have moved or changed look without a style
   * change — the camera, a face arriving, a peer — so its editor reads it again.
   */
  let editorRevision = $state(0);
  /**
   * A primary press on the board just ended an edit. A press of the text tool then only
   * ends it, rather than starting another text (`App.tsx@1118751f:9815-9824`).
   */
  let pressEndedEdit = false;

  // Text first laid out in a fallback's widths is re-laid once its face arrives.
  $effect(() => {
    const current = engine;
    if (!current) return;
    return watchFonts(document.fonts, () => {
      current.fontsLoaded();
      editorRevision += 1;
    });
  });
  let zoom = $state(100);
  let contentVisible = $state(true);
  let currentCamera = $state<Camera | undefined>(undefined);
  let menu = $state<{ x: number; y: number; element: MenuElementInfo | null } | null>(null);
  let eraserTrailSvgPath = $state("");
  const eraserTrail = new EraserTrail({
    decayTime: 220,
    size: 16,
    streamline: 0.25,
    onUpdate: (pathD) => {
      eraserTrailSvgPath = pathD;
    },
  });

  // Modals state
  let showMainMenu = $state(false);
  let showExport = $state(false);
  let showMermaid = $state(false);
  let showShare = $state(false);
  let showShortcuts = $state(false);

  // Realtime
  let peers = $state<PeerCursor[]>([]);
  let liveStatus = $state<ConnectionStatus>("disconnected");
  let realtime: RealtimeChannel<StampedElement> | null = null;
  /** Whether the live link has ever come up, and ever failed — see `liveLabel`. */
  let liveHistory = $state({ everConnected: false, everFailed: false });
  const liveText = $derived(slug ? liveLabel(liveStatus, liveHistory) : null);
  const liveBroadcast = new LiveSceneBroadcaster<StampedElement>();
  /** What peers hold and are doing, as the live link last said — see `syncPeers`. */
  let peerStates: Peer<StampedElement>[] = [];
  /** What the engine was last told, so a repeat is not a repaint. */
  let toldEngine = "";
  let raf = 0;
  let pending: Camera | null = null;
  // The tool's cursor is the floor; the engine's hover answer wins when it has one, and
  // it only ever has one while the pointer is actually over the canvas.
  const toolCursor = $derived(cursorForTool(tool));

  /**
   * Asks the engine whether the panel's view is stale, and makes it re-read if so. After a
   * write from the panel or a style key it is also what restyles a text being typed: the
   * engine writes into it and moves the revision, and its editor, keyed to the revision,
   * reads the new family, size, colour and box back (`DrawTextEditor`). The panel's
   * buttons and the quick picks keep the focus, so the editor is still open when they write.
   */
  function refreshStyle(): void {
    styleRevision = engine?.styleRevision() ?? 0;
  }

  /** Style patches from the panel: onto the selection, or the next element without one. */
  function applyStyle(patch: Partial<DrawElementStyle>): void {
    engine?.applyStyle(patch);
    refreshStyle();
  }

  function previewStyle(patch: Partial<DrawElementStyle>): void {
    if (selectedCount > 0) engine?.previewStyle(patch);
    else engine?.setNextStyle(patch);
    refreshStyle();
  }

  function copyStyles(): void {
    if (engine?.copyStyles()) notify("Copied styles.");
  }

  function pasteStyles(): void {
    engine?.pasteStyles();
    refreshStyle();
  }

  /**
   * Where a key was pressed. The text being edited on the board is told apart from every
   * other field by its editor's name, because it is the one field a style chord reaches.
   */
  function keyTarget(target: EventTarget | null): KeyTarget {
    const typing = textEdit !== null;
    if (typing && (target as Element | null)?.matches?.('textarea[aria-label="Text editor"]')) {
      return "textEditor";
    }
    return isTextField(target) ? "field" : "board";
  }

  /** One font size step, on the selection — the text being typed, while it is. */
  function stepFontSize(increase: boolean): void {
    engine?.stepFontSize(increase);
    refreshStyle();
  }

  /**
   * The chrome's style keys, ahead of the engine's: Ctrl/Cmd+Alt+C and +V copy and paste
   * styles, S, G and Shift+F open the pickers, Ctrl/Cmd+Shift+< and > step the font size
   * — see `styleShortcut`. On the capture phase, because the engine's listener sits on
   * the canvas below and would otherwise take Ctrl+Alt+C for an element copy and S for
   * the lasso, and the text editor stops every key it is given.
   */
  function onStyleShortcut(event: KeyboardEvent): void {
    // An open dialog keeps its keys too: the colour picker's own S and G pick blue and pink.
    if ((event.target as Element).closest?.('[role="dialog"]')) return;
    const action = styleShortcut(event, {
      selected: summary.count,
      tool,
      strokeRow: panelVisible && shapeActions.strokeColor,
      backgroundRow: panelVisible && shapeActions.backgroundColor,
      fontRow: panelVisible && shapeActions.text,
      target: keyTarget(event.target),
    });
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "copyStyles") copyStyles();
    else if (action === "pasteStyles") pasteStyles();
    else if (action === "fontSizeUp" || action === "fontSizeDown") {
      stepFontSize(action === "fontSizeUp");
    } else if (action === "fontPicker") openPicker = "font";
    else openPicker = action === "strokePicker" ? "stroke" : "background";
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
      refreshStyle();
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

  function pickGrid(patch: Partial<GridPreference>): void {
    applySnapModes(pickGridMode({ objectsSnap, grid }, patch));
  }

  /** `Alt+S` and the menu switch. */
  function flipObjectsSnap(): void {
    applySnapModes(toggleObjectsSnap({ objectsSnap, grid }));
  }

  /** The grid and object snapping change together, because turning one on turns the other off. */
  function applySnapModes(next: SnapModes): void {
    const storage = typeof localStorage === "undefined" ? undefined : localStorage;
    grid = next.grid;
    objectsSnap = next.objectsSnap;
    persistGridPreference(storage, grid);
    persistObjectsSnapPreference(storage, objectsSnap);
    engine?.setGrid(grid);
    engine?.setObjectsSnap(objectsSnap);
  }

  function pickCanvasBackground(color: string): void {
    canvasBackground = color;
    persistCanvasBackground(typeof localStorage === "undefined" ? undefined : localStorage, color);
    applyTheme();
  }

  let canvasHost: HTMLDivElement | undefined = $state();
  let imageInput: HTMLInputElement | undefined = $state();
  /**
   * Why the last image was refused, if it was.
   *
   * Shown rather than swallowed: a file that simply does not appear looks like the board
   * is broken, and the person who dropped it has no way to tell whether it was too big,
   * the wrong kind, or corrupt. Cleared on a timer so it does not become furniture.
   */
  let imageNotice = $state<string | null>(null);
  let imageNoticeTimer = 0;

  function notify(message: string): void {
    imageNotice = message;
    if (typeof window === "undefined") return;
    clearTimeout(imageNoticeTimer);
    imageNoticeTimer = window.setTimeout(() => (imageNotice = null), 5000);
  }
  /** Where a dropped image should land; a picked one lands in the middle of the view. */
  let imageDropAt: { x: number; y: number } | null = null;

  /**
   * Decode a file and hand it to the engine.
   *
   * Everything about *where* and *how big* on the board is the engine's — see
   * `insertImage` — so this does only what a browser must: check the file is one we can
   * read, shrink it to a size worth storing, decode it, and report the natural size.
   * Returns the new element's id, or null when the file was refused.
   */
  async function placeImageFile(file: File, at: { x: number; y: number }): Promise<string | null> {
    // Type, then shrink, then size: see `prepareImageFile` for why the order matters.
    const prepared = await prepareImageFile(file, downscaleImageFile);
    if ("rejection" in prepared) {
      notify(describeRejection(prepared.rejection));
      return null;
    }
    const decoded = await readImageFile(prepared.file);
    if (!decoded) {
      notify(describeRejection("decode"));
      return null;
    }
    return (
      engine?.insertImage(
        decoded.dataUrl,
        decoded.naturalWidth,
        decoded.naturalHeight,
        at.x,
        at.y,
      ) ?? null
    );
  }

  /**
   * Places image files and finishes the gesture the way Excalidraw's `insertImages` does
   * (it ends in `actionFinalize`, `App.tsx:13002-13005`): everything placed is selected,
   * and the tool goes back to Select unless it is locked.
   *
   * The return to Select is not cosmetic. The engine deliberately ignores presses while
   * the image tool is active — a picker may be open — so an image dropped or pasted
   * while the tool was still "image" could not be picked up afterwards, which is exactly
   * "the image cannot be dragged".
   */
  async function placeImages(files: readonly File[], at: { x: number; y: number }): Promise<void> {
    const placed: string[] = [];
    // Several files stack from the point rather than landing on top of one another,
    // because the engine centres each on the point it is given.
    for (const [index, file] of files.entries()) {
      const id = await placeImageFile(file, { x: at.x + index * 24, y: at.y + index * 24 });
      if (id) placed.push(id);
    }
    if (placed.length > 1) engine?.select(placed);
    if (!toolLocked) handleToolSelect("select");
  }

  function viewportCentre(): { x: number; y: number } {
    const rect = canvasHost?.getBoundingClientRect();
    return rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 };
  }

  async function onImageChosen(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared before any await: picking the same file twice in a row fires no `change`
    // event unless the value is reset, so the second attempt would silently do nothing.
    input.value = "";
    const at = imageDropAt ?? viewportCentre();
    imageDropAt = null;
    if (file) await placeImageFile(file, at);
    // The picker is the whole gesture; there is nothing to stay in the mode for.
    handleToolSelect("select");
  }

  /**
   * The picker was dismissed without a file.
   *
   * Without this the tool stayed on "image" with nothing to do, and since the engine
   * ignores presses under that tool, the whole board stopped responding until another
   * tool was chosen by hand. Excalidraw resets to Select on the same path
   * (`App.tsx:12773-12789`).
   */
  function onImagePickerCancelled(): void {
    imageDropAt = null;
    if (tool === "image") handleToolSelect("select");
  }

  /** Whether an event landed somewhere that owns its own drop or paste — a field, a dialog. */
  function isOwnedElsewhere(target: EventTarget | null): boolean {
    const el = target instanceof Element ? target : null;
    return Boolean(
      el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog'),
    );
  }

  function hasFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  /**
   * A file dragged over any part of the editor.
   *
   * On the whole editor rather than the canvas alone: the toolbar, the inspector and the
   * zoom bar float *over* the canvas, so a drop that happened to land on one of them used
   * to be ignored — and a file drop nobody cancels is opened by the browser in the tab,
   * replacing the board. Excalidraw puts its handler on the container for the same reason
   * (`App.tsx:2451`, `:4224-4235`).
   */
  function onChromeDragOver(event: DragEvent): void {
    // Cancelled everywhere, a dialog included. Whether the drop *places* anything is
    // decided on the drop; whether the browser opens the file in place of the board must
    // never depend on what happened to be under the pointer — an open dialog's backdrop
    // covers the whole editor, and a drop on it used to navigate the tab away.
    if (hasFiles(event)) event.preventDefault();
  }

  async function onChromeDrop(event: DragEvent): Promise<void> {
    if (!hasFiles(event)) return;
    // Cancelled for *any* file, image or not, and wherever it lands. A drop of a PDF
    // that nobody cancels is opened by the browser in this tab, and the board is gone.
    event.preventDefault();
    if (isOwnedElsewhere(event.target)) return;
    const files = imagesFrom(Array.from(event.dataTransfer?.files ?? []));
    if (files.length === 0) {
      notify(describeRejection("type"));
      return;
    }
    // Canvas-relative, whichever element the drop landed on: that is the space the engine
    // places things in.
    const rect = canvasHost?.getBoundingClientRect();
    const at = rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : viewportCentre();
    await placeImages(files, at);
  }

  /** Where the pointer last was over the canvas, canvas-relative. Pasted images land here. */
  let lastPointer: { x: number; y: number } | null = null;

  /**
   * Pasting an image from the clipboard.
   *
   * On the capture phase of the editor, so it runs *before* the engine's own paste
   * listener on its container, and stops the event there when it handles it. That order
   * matters: with an image and no text on the clipboard the engine read no text and fell
   * back to its internal clipboard — so pasting a screenshot after copying some shapes
   * pasted the shapes. Files are read synchronously, before any await: the clipboard is
   * only readable during the event.
   *
   * Leaves pastes into fields and dialogs alone, as Excalidraw does (`App.tsx:4771-4782`).
   *
   * A scene copied while a sticky note was four shapes is pasted with the note the engine
   * draws (`stickyNotes.ts`); any other text goes on to the engine's own listener.
   */
  function onChromePaste(event: ClipboardEvent): void {
    if (isOwnedElsewhere(event.target)) return;
    const files = imagesFrom(Array.from(event.clipboardData?.files ?? []));
    if (files.length === 0) {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      const nonce = (): number => Math.floor(Math.random() * 0x7fffffff);
      const migrated = text ? migrateLegacyStickyJson(text, Date.now(), nonce) : null;
      if (migrated === null || !engine) return;
      event.preventDefault();
      event.stopPropagation();
      engine.pasteJson(migrated);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void placeImages(files, lastPointer ?? viewportCentre());
  }

  /**
   * Choosing the image tool *is* the gesture.
   *
   * Excalidraw opens the picker straight away rather than waiting for a click on the
   * canvas. Hung off the engine's tool change rather than off the toolbar button so that
   * both ways in behave the same — pressing 9 used to set the tool and then sit there,
   * because only the button knew what the tool was for.
   */
  function openImagePicker(): void {
    imageDropAt = null;
    imageInput?.click();
  }

  let showEmbed = $state(false);
  /** The embed whose link the dialog is changing, rather than adding a new one. */
  let editingEmbed = $state<{ id: string; url: string } | null>(null);
  /**
   * The live frames, in screen pixels, as the engine reports them.
   *
   * Recomputed whenever the camera or the scene moves, because an `<iframe>` is a real
   * DOM element sitting over the canvas and has to keep up with the rectangle drawn
   * under it.
   */
  let embedFrames = $state.raw<EmbedFrame[]>([]);

  /**
   * The embed whose page has the pointer, if any.
   *
   * None of them by default. A frame that took every pointer event made the embed a hole
   * in the board: a press on it went to the video, so it could not be selected, moved or
   * resized from anywhere it covered. Now the board owns the pointer and a *click* in an
   * embed's middle hands it to the page — Excalidraw's `activeEmbeddable` — until the next
   * press on the board, or Escape, takes it back.
   */
  let activeEmbed = $state<string | null>(null);
  /** The embed whose middle the pointer rests on, for the "Click to interact" hint. */
  let hoverEmbed = $state<string | null>(null);
  /** The press that may turn out to be a click on an embed. */
  let embedPress: { x: number; y: number; at: number } | null = null;
  const embedIframes: Record<string, HTMLIFrameElement> = {};
  /** The embeds that have been on screen, and so stay mounted — see `framesToMount`. */
  const seenEmbeds = new Set<string>();

  function refreshEmbedFrames(): void {
    embedFrames = engine
      ? framesToMount(parseEmbedFrames(engine.embedFramesJson()), seenEmbeds)
      : [];
    if (activeEmbed && !embedFrames.some((frame) => frame.id === activeEmbed)) {
      activeEmbed = null;
    }
  }

  /** The embed whose middle is at a screen point — and on top there, not under a shape. */
  function embedAt(x: number, y: number): EmbedFrame | null {
    const candidates = embedFrames.filter((frame) => isFrameCentre(frame, x, y));
    if (candidates.length === 0 || !engine) return null;
    const hit = engine.hitTest(x, y);
    return candidates.find((frame) => frame.id === hit?.id) ?? null;
  }

  /** On a click in an embed's middle: hand it the pointer, and start it if it plays. */
  function activateEmbedAt(point: { x: number; y: number }): void {
    const press = embedPress;
    embedPress = null;
    if (!press || tool !== "select" || embedFrames.length === 0) return;
    if (!isClick(press, { ...point, at: performance.now() })) return;
    const frame = embedAt(point.x, point.y);
    if (!frame) return;
    activeEmbed = frame.id;
    hoverEmbed = null;
    const message = playMessage(frame.url);
    const target = embedIframes[frame.id]?.contentWindow;
    if (message && target) target.postMessage(message, new URL(frame.url).origin);
  }

  function trackEmbed(node: HTMLIFrameElement, id: string) {
    embedIframes[id] = node;
    return {
      destroy() {
        if (embedIframes[id] === node) delete embedIframes[id];
      },
    };
  }

  const pageHostname = typeof location === "undefined" ? "" : location.hostname;

  /**
   * Once per frame while something may be moving an embed.
   *
   * The engine reports a change to the scene when a gesture is committed, not at every
   * move of it, so a frame placed only on scene changes stayed where the drag started and
   * jumped at the end — the page looked as if it had come loose from the board.
   */
  let embedRefresh = false;
  function scheduleEmbedRefresh(): void {
    if (embedRefresh) return;
    embedRefresh = true;
    // Asked for after the handler returns, so it lands after the frame callback the
    // pointer input queues for the engine's move — callbacks in one frame run in the
    // order they were asked for. Asked for first, it read the embed where the previous
    // move had left it, and the frame trailed the drag by one move all the way.
    queueMicrotask(() =>
      requestAnimationFrame(() => {
        embedRefresh = false;
        refreshEmbedFrames();
      }),
    );
  }

  // A scene the page hands in is not reported back — the page already has it — so its
  // embeds are placed here. Deferred, so the canvas has taken the scene first.
  $effect(() => {
    void scene;
    if (engine) queueMicrotask(refreshEmbedFrames);
  });

  function insertEmbed(url: string): void {
    const at = viewportCentre();
    engine?.insertEmbed(url, at.x, at.y);
    refreshEmbedFrames();
    handleToolSelect("select");
  }

  function handleToolSelect(next: DrawTool): void {
    tool = next;
    engine?.setTool(next);
    // Deliberately NOT calling setArrowheads here. It mutates the *current
    // selection*, and after drawing a shape that selection is the shape you just
    // drew — so picking the line tool silently stripped the head off the arrow
    // before it. Picking a tool must never edit an existing element. The engine
    // already defaults an arrow's head from its type (render::default_arrowhead),
    // so this was redundant as well as harmful.
  }

  /** Returning `true` claims the gesture, so the engine does not also act on it. */
  function handleCanvasPointerDown(
    point: { x: number; y: number },
    event?: PointerEvent,
  ): boolean | void {
    if (pressEndedEdit) {
      pressEndedEdit = false;
      if (tool === "text") return true;
    }
    // Any press on the board takes the pointer back from a page: a press inside the
    // page's own frame never reaches the canvas at all.
    activeEmbed = null;
    const plain =
      !event ||
      (event.button === 0 && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey);
    embedPress = plain ? { x: point.x, y: point.y, at: performance.now() } : null;
    if (realtime && engine) {
      // A press on something another person holds does nothing to it; say why, rather
      // than leave it looking like the board stopped responding.
      if (tool === "select" || tool === "eraser") {
        const holder = engine.peerAt(point.x, point.y);
        if (holder) notify(heldNotice(peerStates.find((p) => p.clientId === holder)?.name));
      }
      startPreviews();
    }
    if (tool === "eraser") {
      // Only the trail is drawn here. What the sweep marks, how it fades and what the
      // release deletes are the engine's (`engine/eraser.rs`), so the press goes through
      // to it. This used to claim the gesture and run an eraser of its own, which asked
      // for the topmost element under each sample — so a stack of copies lost one copy
      // per pass, the top one answering every sample while the rest were never reached.
      eraserTrail.start(point.x, point.y);
    }
  }

  function handleCanvasPointerMove(point: { x: number; y: number }): void {
    if (embedFrames.length > 0) scheduleEmbedRefresh();
    if (tool !== "eraser") return;
    eraserTrail.addPoint(point.x, point.y);
  }

  function handleCanvasPointerUp(point: { x: number; y: number }): void {
    activateEmbedAt(point);
    if (tool === "eraser") eraserTrail.stop();
  }

  function handleSceneChange(json: string): void {
    refreshStyle();
    onSceneChange?.(json);
    refreshEmbedFrames();
    if (!realtime) return;
    liveBroadcast.observe(json);
    flushLive();
  }

  /**
   * Sends peers what they do not have yet — when it can be sent.
   *
   * Diffed against what peers already have: tombstones synthesised for soft-deletes,
   * and an explicit order when z-order moved without stamp changes. Nothing is taken
   * while the link is down, so what is drawn offline goes out on reconnect instead of
   * being marked as sent and dropped.
   */
  function flushLive(): void {
    if (!realtime || realtime.connectionStatus !== "connected") return;
    const patch = liveBroadcast.takePatch();
    if (patch) realtime.sendPatch(patch);
  }

  /**
   * Tells the engine who holds what and what they are doing, once every claim has been
   * settled against ours — see `peerClaims.ts`. Only when that changed: the engine
   * repaints on every call.
   */
  function syncPeers(): void {
    if (!engine || !realtime) return;
    const resolved = resolvePeers(
      { clientId: realtime.profile.clientId, claims: realtime.ownClaims },
      peerStates,
    );
    const told = JSON.stringify(resolved);
    if (told === toldEngine) return;
    toldEngine = told;
    engine.setPeers(resolved as unknown as DrawPeer[]);
    editorRevision += 1;
  }

  /** Says what we now hold: the selection, each element with when it was taken. */
  function claimSelected(ids: readonly string[]): void {
    if (!realtime) return;
    const previous: Claims = realtime.ownClaims;
    const next = claimSelection(previous, ids, Date.now());
    const same =
      Object.keys(next).length === Object.keys(previous).length &&
      Object.keys(next).every((id) => id in previous);
    if (same) return;
    realtime.setClaims(next);
    // Ours changed, so who wins a race may have too.
    syncPeers();
  }

  // Our gesture in progress, streamed to peers while it runs so a shape moves on their
  // screens as it moves on ours. At most once per `previewInterval`, only when something
  // changed and someone is there to see it, and ended once the gesture is: after its
  // commit, which went out as a patch from the pointer-up itself.
  let previewRaf = 0;
  let previewSent = false;
  let previewJson = "";
  let previewAt = 0;

  function startPreviews(): void {
    if (!previewRaf) previewRaf = requestAnimationFrame(previewTick);
  }

  function previewTick(): void {
    previewRaf = 0;
    if (!engine || !realtime) return;
    // A text being typed is a gesture too (`engine/text_session.rs`): the words appear on
    // everyone's screen as they are written, and it is held while they are.
    const running = dragging || engine.linearInProgress() || textEdit !== null;
    if (!running || peers.length === 0) {
      if (previewSent) {
        realtime.sendPreviewEnd();
        previewSent = false;
        previewJson = "";
      }
      if (!running) return;
    } else if (
      realtime.connectionStatus === "connected" &&
      performance.now() - previewAt >= previewInterval(previewJson.length)
    ) {
      const elements = engine.gestureElements() as unknown as StampedElement[];
      const json = JSON.stringify(elements);
      if (elements.length > 0 && json !== previewJson) {
        realtime.sendPreview(elements);
        previewSent = true;
        previewJson = json;
        previewAt = performance.now();
      }
    }
    previewRaf = requestAnimationFrame(previewTick);
  }

  /** Merges a peer's patch — from the socket, or from the server when catching up. */
  function applyRemote(incoming: ScenePatch<StampedElement>): void {
    if (!engine) return;
    if (!incoming.elements?.length && !incoming.order?.length) return;
    // Pictures its sender left off, because this client has them: put back before
    // anything reads the patch, or the autosave would save an image without its picture.
    const elements = liveBroadcast.withPictures(incoming.elements ?? []);
    const patch: ScenePatch<StampedElement> = incoming.order
      ? { elements, order: incoming.order }
      : { elements };
    // Merge by id, never paste. `pasteJson` mints fresh ids, so feeding remote edits
    // through it duplicated every one of them — and because the result was then
    // broadcast back, two clients grew the board without bound.
    //
    // `applyRemotePatch` emits no scene event, so nothing echoes back to the peer that
    // sent it. We still feed the host `onSceneChange` so `live` / autosave see peer
    // deletes and updates.
    const payload: {
      type: string;
      version: number;
      elements: StampedElement[];
      order?: string[];
    } = {
      type: "osidraw",
      version: 1,
      elements: patch.elements ?? [],
    };
    if (patch.order) payload.order = patch.order;
    if (!engine.applyRemotePatch(JSON.stringify(payload))) return;
    refreshStyle();
    liveBroadcast.adoptRemote(patch);
    // Order-only patches carry no elements; exportJson is the safe host sync.
    // Otherwise a delta keeps tombstones visible to the autosave tracker.
    onSceneChange?.(patch.order?.length ? engine.exportJson() : remotePatchToSceneEvent(patch));
    refreshEmbedFrames();
  }

  /**
   * After the live link comes back: what peers did while it was down reached the
   * server but not us, and nothing would ever resend it. Read the board and merge it —
   * the merge keeps whichever copy of each element is newer, so what we did offline
   * stands. Best effort: if the read fails, the next reconnect tries again.
   */
  async function catchUp(): Promise<void> {
    if (!fetchLatest) return;
    let elements: StampedElement[];
    try {
      elements = await fetchLatest();
    } catch {
      return;
    }
    applyRemote({ elements });
  }

  onMount(() => {
    // Apply the stored choice *before* reading the tokens: themeFromCss resolves the
    // canvas colours off the host CSS variables, and the `dark` class is what swaps
    // them. Reading first would hand the engine a white canvas under dark chrome.
    themePreference = readThemePreference(localStorage);
    canvasBackground = readCanvasBackground(localStorage);
    grid = readGridPreference(localStorage);
    objectsSnap = readObjectsSnapPreference(localStorage);
    // In case the engine was ready first; `onReady` covers the usual order.
    engine?.setObjectsSnap(objectsSnap);
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

    let unsubPeers: (() => void) | undefined;
    let unsubPeerState: (() => void) | undefined;
    let unsubStatus: (() => void) | undefined;
    let unsubPatch: (() => void) | undefined;
    let liveCancelled = false;
    if (slug) {
      // Seed the broadcaster from the loaded scene so the first stroke is a diff.
      liveBroadcast.reset(scene.toArray() as StampedElement[]);
      // Fragment room key never leaves the browser. Mint one if the URL has none so
      // the share link becomes a capability URL; peers who open the same #room=
      // derive the same AES key. The API only sees opaque sealed frames.
      void (async () => {
        const raw = await resolveRoomKey(slug, window.location);
        const roomKey = await importRoomKey(raw);
        if (liveCancelled) return;
        realtime = new RealtimeChannel(slug, roomKey);
        unsubPeers = realtime.onPeers((list) => {
          // Before `peers` is overwritten: this diffs against the outgoing list, so a
          // peer's laser trail gets its final `down: false` when they leave mid-stroke.
          if (engine) syncPeerLasers(peers, list, engine.peerLaser.bind(engine));
          peers = list;
        });
        unsubPeerState = realtime.onPeerState((list) => {
          peerStates = list;
          syncPeers();
        });
        // What was selected before the link existed is held from now.
        if (engine) claimSelected(engine.getSelectedElements().map((element) => element.id));
        // Whoever joins is sent what they lack, and this client is on joining: the
        // server has only what has been saved. Sent first, so all of it is known here.
        realtime.setSceneSync({
          inventory: () => {
            flushLive();
            return liveBroadcast.inventory();
          },
          missing: (have) => {
            flushLive();
            return liveBroadcast.missing(have);
          },
        });
        unsubStatus = realtime.onStatus((next) => {
          const reconnected = next === "connected" && liveHistory.everConnected;
          if (liveStatus === "connecting" && next === "disconnected") {
            liveHistory.everFailed = true;
          }
          if (next === "connected") liveHistory.everConnected = true;
          liveStatus = next;
          if (next === "connected") {
            // Ours first — what was drawn offline — then theirs, from the server.
            flushLive();
            if (reconnected) void catchUp();
          }
        });
        unsubPatch = realtime.onRemotePatch(applyRemote);
        realtime.connect();
      })();
    }

    return () => {
      liveCancelled = true;
      media.removeEventListener("change", onSystemThemeChange);
      unsubPeers?.();
      unsubPeerState?.();
      unsubStatus?.();
      unsubPatch?.();
      realtime?.disconnect();
    };
  });

  onDestroy(() => {
    if (raf) cancelAnimationFrame(raf);
    if (cursorRaf) cancelAnimationFrame(cursorRaf);
    if (previewRaf) cancelAnimationFrame(previewRaf);
    eraserTrail.clear();
    realtime?.disconnect();
  });

  function onCameraChange(camera: Camera): void {
    if (textEdit) editorRevision += 1;
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
      // An `<iframe>` is a real element over the canvas; it has to keep up with the
      // rectangle drawn under it or it slides away as soon as anyone pans.
      refreshEmbedFrames();
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
  /** Whether a button was down at the last hover sample: no hint during a drag. */
  let hoverButtons = false;
  let hoverPending: { x: number; y: number } | null = null;

  function onCanvasPointerMove(e: MouseEvent): void {
    const target = e.currentTarget as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    hoverPending = { x: sx, y: sy };
    hoverButtons = e.buttons !== 0;
    lastPointer = { x: sx, y: sy };

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
      if (at && engine) {
        hoverCursor = engine.hoverCursor(at.x, at.y);
        const over =
          !hoverButtons && tool === "select" && embedFrames.length > 0 ? embedAt(at.x, at.y) : null;
        hoverEmbed = over && over.id !== activeEmbed ? over.id : null;
        if (hoverEmbed) hoverCursor = "pointer";
      }

      const next = cursorPending;
      cursorPending = null;
      if (!next || !realtime) return;
      if (Math.abs(next.x - lastSent.x) < 1 && Math.abs(next.y - lastSent.y) < 1) return;
      lastSent = next;
      realtime.sendCursor(next.x, next.y, tool === "laser" ? "laser" : "pointer", dragging);
    });
  }

  /**
   * Down and up, sent at once rather than waiting for the next `onCanvasPointerMove` —
   * which the 1px dedup above can skip outright (a click with no drag), and which may
   * never come again after a release. Only while the laser is the active tool: every
   * other tool's cursor is unaffected, exactly as it was before this existed.
   */
  function sendLaserCursorEdge(e: PointerEvent, down: boolean): void {
    if (!realtime || !currentCamera || tool !== "laser") return;
    const target = e.currentTarget as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const next = {
      x: (e.clientX - rect.left - currentCamera.x) / currentCamera.scale,
      y: (e.clientY - rect.top - currentCamera.y) / currentCamera.scale,
    };
    lastSent = next;
    realtime.sendCursor(next.x, next.y, "laser", down);
  }

  function onCanvasPointerLeave(): void {
    hoverCursor = null;
    hoverEmbed = null;
  }

  let mainMenu = $state.raw<DrawMainMenu | null>(null);

  /**
   * Ctrl/Cmd+S: the board's own, and the text editor's — which ends the edit first, as
   * the oracle's Ctrl/Cmd+S submits before it saves (`textWysiwyg.tsx@1118751f:683-686`).
   */
  function saveAsFile(): void {
    if (!engine) return;
    downloadBlob("drawing.osidraw", new Blob([engine.exportJson()], { type: "application/json" }));
  }

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
    if (isTextField(event.target)) return;

    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (event.key === "Escape") {
      // The engine lets the eraser's marks go on the same key; the trail goes with them.
      eraserTrail.stop();
      activeEmbed = null;
    } else if (mod && event.shiftKey && key === "e") {
      event.preventDefault();
      showExport = true;
    } else if (mod && key === "o") {
      event.preventDefault();
      // The file picker lives inside the menu, so the menu has to exist to open it.
      showMainMenu = true;
      queueMicrotask(() => mainMenu?.openFile());
    } else if (mod && key === "s") {
      event.preventDefault();
      saveAsFile();
    } else if (!mod && event.altKey && event.code === "KeyS") {
      // Excalidraw's `Alt+S` (`actionToggleObjectsSnapMode.tsx`), on `code` for the same
      // reason as the grid below — and because on a Mac, Option+S types "ß".
      event.preventDefault();
      flipObjectsSnap();
    } else if (mod && event.code === "Quote") {
      // Excalidraw's grid shortcut, and matched on `code` the way theirs is: `code` is
      // the physical key, `key` the character it produces. On a layout where that key is
      // not an apostrophe — AZERTY, QWERTZ, Dvorak — matching the character means the
      // shortcut is either somewhere else entirely or nowhere at all.
      event.preventDefault();
      pickGrid({ enabled: !grid.enabled });
    } else if (!mod && event.key === "?") {
      event.preventDefault();
      showShortcuts = true;
    }
  }
</script>

<svelte:window onkeydown={onAppShortcut} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="draw-chrome"
  style:cursor={hoverCursor ?? toolCursor}
  onkeydowncapture={onStyleShortcut}
  ondragover={onChromeDragOver}
  ondrop={onChromeDrop}
  onpastecapture={onChromePaste}
>
  <DrawHeader
    {title}
    {status}
    live={liveText}
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
          {grid}
          {objectsSnap}
          onPickTheme={pickTheme}
          onPickCanvasBackground={pickCanvasBackground}
          onPickGrid={pickGrid}
          onToggleObjectsSnap={flipObjectsSnap}
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
  <div
    bind:this={canvasHost}
    class="canvas-host"
    onmousemove={onCanvasPointerMove}
    onmouseleave={onCanvasPointerLeave}
    onpointerdowncapture={(e) => {
      dragging = true;
      sendLaserCursorEdge(e, true);
    }}
    onpointerup={(e) => {
      dragging = false;
      sendLaserCursorEdge(e, false);
    }}
    onpointercancel={(e) => {
      dragging = false;
      sendLaserCursorEdge(e, false);
    }}
  >
    <DrawCanvas
      {scene}
      {theme}
      defaultStroke={ink}
      {ariaLabel}
      onSceneChange={handleSceneChange}
      {onCameraChange}
      onReady={(next) => {
        engine = next;
        // Known from the start rather than from the first pan: the cursor we send and
        // the peers' cursors we draw are both placed with it, and without it ours was
        // never sent and theirs sat at the corner until someone moved the camera.
        currentCamera = next.camera;
        zoom = zoomPercent(next.camera.scale);
        next.setGrid(grid);
        next.setObjectsSnap(objectsSnap);
        styleRevision = next.styleRevision();
        exposeForDevTools(next);
        refreshEmbedFrames();
        toldEngine = "";
        syncPeers();
        onReady?.(next);
      }}
      onToolChange={(next: DrawTool) => {
        tool = next;
        if (next === "image") openImagePicker();
        if (next === "embed") showEmbed = true;
      }}
      onSelectionChange={(ids) => {
        selectedCount = ids.length;
        openPicker = null;
        refreshStyle();
        claimSelected(ids);
      }}
      onNotice={(notice) => notify(NOTICE_TEXT[notice])}
      onRequestTextEdit={(request) => {
        textEdit = request;
        if (realtime) startPreviews();
      }}
      onContextMenu={(point, kind) => {
        if (!engine) return;
        // "canvas" opens the board menu even when a selection is kept from before this
        // right-click (a right-click never clears it) — the menu kind is the hit's own,
        // not read back off whatever is still selected.
        menu = {
          x: point.x,
          y: point.y,
          element:
            kind === "canvas"
              ? null
              : menuElementFromSelection(
                  engine.getSelectedElements(),
                  engine.selectionLocked(),
                  engine.selectionIsGroup(),
                  engine.selectionStyle(),
                ),
        };
      }}
      onToolLockChange={(locked) => {
        toolLocked = locked;
      }}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
    />
    {#if eraserTrailSvgPath}
      <svg class="eraser-trail-canvas" aria-hidden="true">
        <path
          d={eraserTrailSvgPath}
          fill={themeMode === "dark" ? "rgba(255, 255, 255, 0.3)" : "rgba(0, 0, 0, 0.2)"}
        />
      </svg>
    {/if}
  </div>

  <!--
    Off-screen rather than `display: none`: a hidden input cannot be opened by script in
    some browsers, and this one is only ever opened by script.
  -->
  <input
    bind:this={imageInput}
    class="sr-only"
    type="file"
    accept={IMAGE_ACCEPT}
    aria-label="Insert image"
    onchange={onImageChosen}
    oncancel={onImagePickerCancelled}
  />

  <!--
    Live pages, over the canvas. Each is laid out at its size on the board and scaled
    with the zoom, and none takes the pointer until a click in its middle hands it over —
    see `activeEmbed`. Until then a press on one is the board's, so an embed is selected,
    moved and resized like any other shape.
  -->
  {#each embedFrames as frame (frame.id)}
    <div
      class="embed-frame"
      class:active={frame.id === activeEmbed}
      style={`${frameStyle(frame)};--embed-scale:${frame.scale}`}
    >
      <iframe
        use:trackEmbed={frame.id}
        title="Embedded page"
        src={frame.srcdoc ? undefined : frameSrc(frame, pageHostname)}
        srcdoc={frame.srcdoc}
        sandbox={sandboxFor(frame)}
        referrerpolicy={EMBED_REFERRER_POLICY}
        allow={EMBED_ALLOW}
        allowfullscreen
        loading="lazy"
        style={frameInnerStyle(frame)}
      ></iframe>
    </div>
    {#if frame.id === hoverEmbed}
      <span
        class="embed-hint"
        style:left={`${frame.x + frame.width / 2}px`}
        style:top={`${frame.y + frame.height / 2}px`}>Click to interact</span
      >
    {/if}
  {/each}

  {#if imageNotice}
    <p class="image-notice" role="status">{imageNotice}</p>
  {/if}

  {#if editingEmbed}
    {@const { id, url } = editingEmbed}
    <DrawEmbedModal
      {engine}
      initial={url}
      onInsert={(next) => {
        if (engine?.setEmbedUrl(id, next)) refreshEmbedFrames();
      }}
      onClose={() => {
        editingEmbed = null;
      }}
    />
  {:else if showEmbed}
    <DrawEmbedModal
      {engine}
      onInsert={insertEmbed}
      onClose={() => {
        showEmbed = false;
        // Cancelling leaves the tool selected with nothing to do, which reads as the
        // board having stopped responding.
        if (tool === "embed") handleToolSelect("select");
      }}
    />
  {/if}

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

  {#if panelVisible}
    <DrawInspector
      {summary}
      can={shapeActions}
      {engine}
      {themeMode}
      {openPicker}
      onOpenPicker={(kind) => (openPicker = kind)}
      onApply={applyStyle}
      onPreview={previewStyle}
      run={(action) => {
        if (!engine) return;
        action(engine);
        refreshStyle();
      }}
    />
  {/if}

  <DrawZoomBar {engine} {zoom} {contentVisible} />

  {#if textEdit && engine}
    {#key textEdit.id}
      <DrawTextEditor
        {engine}
        request={textEdit}
        revision={styleRevision + editorRevision}
        onInput={() => {
          if (realtime) startPreviews();
        }}
        onSave={saveAsFile}
        onDone={(boardPress) => {
          textEdit = null;
          if (boardPress) {
            pressEndedEdit = true;
            // Only for the press under way: one that never reached the board's handler
            // must not swallow the next.
            setTimeout(() => (pressEndedEdit = false));
          }
          refreshStyle();
        }}
      />
    {/key}
  {/if}

  <DrawModals
    {engine}
    {slug}
    {peers}
    connectionStatus={liveStatus}
    bind:menu
    bind:showMainMenu
    bind:showExport
    bind:showMermaid
    bind:showShare
    bind:showShortcuts
    onCopyStyles={copyStyles}
    onEditEmbedLink={(id) => {
      const url = embedFrames.find((frame) => frame.id === id)?.url;
      if (url) editingEmbed = { id, url };
    }}
    onInsertMermaid={(elements) => {
      if (engine) engine.pasteJson(JSON.stringify({ type: "osidraw", version: 1, elements }));
    }}
  />
</div>
