<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { DrawCanvas } from "@osionos/draw-engine/svelte";
  import { DARK_THEME, DEFAULT_ELEMENT_STYLE, LIGHT_THEME } from "@osionos/draw-engine/types";
  import type {
    Camera,
    DrawElement,
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
    persistGridPreference,
    readCanvasBackground,
    readGridPreference,
    readThemePreference,
    resolveThemeMode,
    themeFromCss,
    type GridPreference,
    type ThemeMode,
    type ThemePreference,
  } from "./theme.ts";
  import { menuElementFromSelection, type MenuElementInfo } from "./menu.ts";
  import { type ExtendedTool } from "./tools.ts";
  import { createStickyNote, DEFAULT_STICKY_NOTE_SIZE } from "../notes/stickyNotes.ts";
  import { EraserTrail } from "../eraser/eraserTrail.ts";
  import { parseEmbedFrames, sandboxFor, frameStyle, type EmbedFrame } from "./embed.ts";
  import DrawEmbedModal from "./DrawEmbedModal.svelte";
  import {
    IMAGE_ACCEPT,
    describeRejection,
    imagesFrom,
    readImageFile,
    rejectImageFile,
  } from "./imageFile.ts";
  import { RealtimeChannel, type PeerCursor } from "../realtime/realtimeClient.ts";
  import type { StampedElement } from "../autosave/sceneDiff.ts";
  import DrawHeader from "./DrawHeader.svelte";
  import DrawMainMenu from "./DrawMainMenu.svelte";
  import { downloadBlob } from "./download.ts";
  import DrawToolbar from "./DrawToolbar.svelte";
  import DrawInspector from "./DrawInspector.svelte";
  import { getShapeActions } from "./shapeActions.ts";
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
  let grid = $state<GridPreference>({ enabled: false, size: 20, step: 5, snap: true });
  let ink = $state("#1e1e1e");
  let tool = $state<ExtendedTool>("select");
  let toolLocked = $state(false);
  let selectedCount = $state(0);
  /** The selected elements, so the panel can decide which controls apply. */
  let selection = $state.raw<DrawElement[]>([]);

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

  $effect(() => {
    const want = getShapeActions(tool, selection, activeStyle.backgroundColor).visible;
    if (!dragging) panelVisible = want;
  });
  let activeStyle = $state<DrawElementStyle>(DEFAULT_ELEMENT_STYLE);
  let textEdit = $state<TextEditRequest | null>(null);
  let zoom = $state(100);
  let contentVisible = $state(true);
  let currentCamera = $state<Camera | undefined>(undefined);
  let menu = $state<{ x: number; y: number; element: MenuElementInfo | null } | null>(null);
  let eraserTrailSvgPath = $state("");
  let stickyStartPoint: { x: number; y: number } | null = null;
  /**
   * What the current eraser sweep has dimmed, and how see-through each one was before.
   *
   * A plain Map rather than a `SvelteMap`: nothing renders from it. The fading is done by
   * patching the elements themselves, so the canvas already shows the change, and this is
   * only the record needed to put them back if the sweep is cancelled. Making it reactive
   * would suggest the markup depends on it, which is the thing a later reader would then
   * have to disprove.
   */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const elementsPendingErase = new Map<string, { element: DrawElement; originalOpacity: number }>();
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
  let realtime: RealtimeChannel<StampedElement> | null = null;
  let raf = 0;
  let pending: Camera | null = null;
  // The tool's cursor is the floor; the engine's hover answer wins when it has one, and
  // it only ever has one while the pointer is actually over the canvas.
  const toolCursor = $derived(cursorForTool(tool));

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

  function pickGrid(patch: Partial<GridPreference>): void {
    grid = { ...grid, ...patch };
    persistGridPreference(typeof localStorage === "undefined" ? undefined : localStorage, grid);
    engine?.setGrid(grid);
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
   * Everything about *where* and *how big* is the engine's — see `insertImage` — so this
   * does only what a browser must: check the file is one we can read, decode it, and
   * report the natural size.
   */
  async function placeImageFile(file: File, at: { x: number; y: number }): Promise<void> {
    const rejection = rejectImageFile(file);
    if (rejection) {
      notify(describeRejection(rejection));
      return;
    }
    const decoded = await readImageFile(file);
    if (!decoded) {
      notify(describeRejection("decode"));
      return;
    }
    engine?.insertImage(decoded.dataUrl, decoded.naturalWidth, decoded.naturalHeight, at.x, at.y);
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

  async function onCanvasDrop(event: DragEvent): Promise<void> {
    const files = imagesFrom(Array.from(event.dataTransfer?.files ?? []));
    if (files.length === 0) return;
    event.preventDefault();
    const rect = canvasHost?.getBoundingClientRect();
    const at = rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : viewportCentre();
    // Dropped where they were dropped: several files stack from that point rather than
    // landing on top of one another, because the engine centres each on the point it is
    // given.
    for (const [index, file] of files.entries()) {
      await placeImageFile(file, { x: at.x + index * 24, y: at.y + index * 24 });
    }
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
  /**
   * The live frames, in screen pixels, as the engine reports them.
   *
   * Recomputed whenever the camera or the scene moves, because an `<iframe>` is a real
   * DOM element sitting over the canvas and has to keep up with the rectangle drawn
   * under it.
   */
  let embedFrames = $state.raw<EmbedFrame[]>([]);

  function refreshEmbedFrames(): void {
    embedFrames = engine ? parseEmbedFrames(engine.embedFramesJson()) : [];
  }

  function insertEmbed(url: string): void {
    const at = viewportCentre();
    engine?.insertEmbed(url, at.x, at.y);
    refreshEmbedFrames();
    handleToolSelect("select");
  }

  function handleToolSelect(next: ExtendedTool): void {
    if (next === "sticky") {
      // The sticky note is the host's own tool, not one the engine knows: the engine
      // stays on "select" and this component watches the pointer for the placement
      // gesture. `tool` is what the toolbar highlights, so it keeps the sticky.
      tool = "sticky";
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

  let lastEraserPoint: { x: number; y: number } | null = null;

  /**
   * Dim whatever the eraser just passed over, without deleting it yet.
   *
   * Excalidraw's eraser is a two-stage gesture: everything the stroke touches fades to
   * near-transparent, and only releasing commits the deletion. That is what makes it
   * safe to sweep — you can see what you are about to lose and still back out with
   * Escape. The original opacity is remembered per element so backing out restores it.
   *
   * `applyRemotePatch` rather than a normal edit because this must not push history:
   * the undo stack should hold one deletion, not one entry per element brushed past.
   */
  function checkEraserHit(sx: number, sy: number): void {
    if (!engine) return;
    const hit = engine.hitTest(sx, sy, 12);
    if (!hit) return;
    if (elementsPendingErase.has(hit.id)) return;

    // Erasing one part of a composite erases the whole of it: a group goes together, and
    // a label goes with its container rather than being orphaned in mid-air.
    let toDim: DrawElement[] = [hit];
    try {
      const parsed = JSON.parse(engine.exportJson());
      const elements: DrawElement[] = Array.isArray(parsed?.elements) ? parsed.elements : [];
      if (hit.groupId) {
        const grouped = elements.filter((el) => el.groupId === hit.groupId && !el.isDeleted);
        if (grouped.length > 0) toDim = grouped;
      } else {
        const boundTexts = elements.filter((el) => el.containerId === hit.id && !el.isDeleted);
        if (boundTexts.length > 0) toDim = [...toDim, ...boundTexts];
        if (hit.containerId) {
          const container = elements.find((el) => el.id === hit.containerId && !el.isDeleted);
          if (container) toDim = [...toDim, container];
        }
      }
    } catch {
      // A scene we cannot parse still erases what was hit; it just does not extend the
      // selection to the rest of the group.
    }

    const patchElements: DrawElement[] = [];
    for (const el of toDim) {
      if (!elementsPendingErase.has(el.id)) {
        elementsPendingErase.set(el.id, { element: el, originalOpacity: el.opacity });
        patchElements.push({
          ...el,
          opacity: Math.min(el.opacity, 20),
          version: el.version + 1,
          versionNonce: Math.floor(Math.random() * 1_000_000_000),
        });
      }
    }

    if (patchElements.length > 0) {
      engine.applyRemotePatch(
        JSON.stringify({ type: "osidraw", version: 1, elements: patchElements }),
      );
    }
  }

  /** Back out of an eraser sweep: put every dimmed element back as it was. */
  function cancelPendingEraser(): void {
    if (elementsPendingErase.size === 0 || !engine) return;
    const restored = Array.from(elementsPendingErase.values()).map(
      ({ element, originalOpacity }) => ({
        ...element,
        opacity: originalOpacity,
        // +2 because the dimming patch already spent +1; a lower version would lose to
        // it under last-writer-wins and the element would stay faded.
        version: element.version + 2,
        versionNonce: Math.floor(Math.random() * 1_000_000_000),
      }),
    );
    elementsPendingErase.clear();
    engine.applyRemotePatch(JSON.stringify({ type: "osidraw", version: 1, elements: restored }));
  }

  /** Returning `true` claims the gesture, so the engine does not also act on it. */
  function handleCanvasPointerDown(point: { x: number; y: number }): boolean | void {
    if (tool === "eraser") {
      lastEraserPoint = { x: point.x, y: point.y };
      eraserTrail.start(point.x, point.y);
      elementsPendingErase.clear();
      checkEraserHit(point.x, point.y);
      return true;
    }
    if (tool === "sticky") {
      stickyStartPoint = { x: point.x, y: point.y };
      return true;
    }
  }

  function handleCanvasPointerMove(point: { x: number; y: number }): void {
    if (tool !== "eraser") return;
    eraserTrail.addPoint(point.x, point.y);
    if (lastEraserPoint) {
      // Sample along the segment, not just at its ends. A fast sweep produces pointer
      // events tens of pixels apart, and testing only those would skip straight over
      // anything thinner than the gap between them.
      const dx = point.x - lastEraserPoint.x;
      const dy = point.y - lastEraserPoint.y;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8));
      for (let i = 1; i <= steps; i++) {
        checkEraserHit(lastEraserPoint.x + dx * (i / steps), lastEraserPoint.y + dy * (i / steps));
      }
    } else {
      checkEraserHit(point.x, point.y);
    }
    lastEraserPoint = { x: point.x, y: point.y };
  }

  function handleCanvasPointerUp(point: { x: number; y: number }): void {
    if (tool === "eraser") {
      lastEraserPoint = null;
      eraserTrail.stop();
      if (elementsPendingErase.size > 0 && engine) {
        const ids = Array.from(elementsPendingErase.keys());
        elementsPendingErase.clear();
        engine.select(ids);
        // One history entry for the whole sweep, which is what the gesture was.
        engine.deleteSelection();
      }
      return;
    }

    if (tool !== "sticky" || !stickyStartPoint || !engine) return;
    const start = stickyStartPoint;
    stickyStartPoint = null;

    const worldStart = engine.screenToWorld(start.x, start.y);
    const worldEnd = engine.screenToWorld(point.x, point.y);

    let x: number;
    let y: number;
    let w = DEFAULT_STICKY_NOTE_SIZE;
    let h = DEFAULT_STICKY_NOTE_SIZE;

    // A drag sizes the note; a click drops a default one centred on the pointer. The
    // 10px threshold is what separates the two — below it the "drag" is just a shaky
    // click and sizing the note from it would produce a sliver.
    if (Math.abs(point.x - start.x) > 10 || Math.abs(point.y - start.y) > 10) {
      x = Math.min(worldStart.x, worldEnd.x);
      y = Math.min(worldStart.y, worldEnd.y);
      w = Math.max(Math.abs(worldEnd.x - worldStart.x), 100);
      h = Math.max(Math.abs(worldEnd.y - worldStart.y), 100);
    } else {
      x = worldEnd.x - w / 2;
      y = worldEnd.y - h / 2;
    }

    const [shadow, note, date, text] = createStickyNote(x, y, "", "yellow", w, h);
    engine.pasteJson(
      JSON.stringify({ type: "osidraw", version: 1, elements: [shadow, note, date, text] }),
      {
        x: x + w / 2,
        y: y + h / 2,
      },
    );

    if (!toolLocked) {
      tool = "select";
      engine.setTool("select");
    }

    // Drop straight into typing: a sticky note with nothing on it is never the goal.
    const selected = engine.getSelectedElements();
    const noteEl = selected.find((el) => el.boundTextId);
    const textEl = noteEl ?? selected.find((el) => el.type === "text" && el.containerId);
    if (textEl) {
      engine.select([textEl.id]);
      engine.editSelectedText();
    }
  }

  function handleSceneChange(json: string): void {
    onSceneChange?.(json);
    refreshEmbedFrames();
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
    grid = readGridPreference(localStorage);
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
    cancelPendingEraser();
    eraserTrail.clear();
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

    if (event.key === "Escape") {
      cancelPendingEraser();
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
      if (engine) {
        downloadBlob(
          "drawing.osidraw",
          new Blob([engine.exportJson()], { type: "application/json" }),
        );
      }
    } else if (!mod && key === "n") {
      // "N" only. 9 is the image tool's, both in the engine's keymap and on the toolbar,
      // and claiming it here did not take it away — `preventDefault` does not stop the
      // engine's own listener, so 9 selected the sticky note and opened the image picker
      // in the same keystroke.
      event.preventDefault();
      handleToolSelect("sticky");
    } else if (mod && event.key === "'") {
      // Excalidraw's grid shortcut.
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
          {grid}
          onPickTheme={pickTheme}
          onPickCanvasBackground={pickCanvasBackground}
          onPickGrid={pickGrid}
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
    ondragover={(event) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
    }}
    ondrop={onCanvasDrop}
    onmousemove={onCanvasPointerMove}
    onmouseleave={onCanvasPointerLeave}
    onpointerdowncapture={() => (dragging = true)}
    onpointerup={() => (dragging = false)}
    onpointercancel={() => (dragging = false)}
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
        next.setGrid(grid);
        syncStyle(next);
        exposeForDevTools(next);
        onReady?.(next);
      }}
      onToolChange={(next: DrawTool) => {
        // The sticky note is a host tool that parks the engine on "select". Without this
        // guard the engine's own tool change would immediately drop the toolbar back to
        // select, and the sticky would look unselectable.
        if (tool === "sticky" && next === "select") return;
        tool = next;
        if (next === "image") openImagePicker();
        if (next === "embed") showEmbed = true;
        syncStyle(engine);
      }}
      onSelectionChange={(ids) => {
        selectedCount = ids.length;
        selection = engine?.getSelectedElements() ?? [];
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
  />

  <!--
    Live pages, over the canvas. `pointer-events` is off while a drag is in progress so
    that dragging an embed moves the element rather than being swallowed by the page
    inside it — the frame is content, but the board still owns the gesture.
  -->
  {#each embedFrames as frame (frame.id)}
    <iframe
      title="Embedded page"
      src={frame.url}
      sandbox={sandboxFor(frame)}
      referrerpolicy="no-referrer"
      loading="lazy"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      class="embed-frame"
      class:inert={dragging}
      style={frameStyle(frame)}
    ></iframe>
  {/each}

  {#if imageNotice}
    <p class="image-notice" role="status">{imageNotice}</p>
  {/if}

  {#if showEmbed}
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
      style={activeStyle}
      {selectedCount}
      {selection}
      {tool}
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
