<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { DrawCanvas } from "@osionos/draw-engine/svelte";
  import { DEFAULT_ELEMENT_STYLE, LIGHT_THEME } from "@osionos/draw-engine/types";
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
  import { themeFromCss } from "./theme.ts";
  import { menuElementFromSelection, type MenuElementInfo } from "./menu.ts";
  import DrawToolbar from "./DrawToolbar.svelte";
  import DrawInspector from "./DrawInspector.svelte";
  import DrawActions from "./DrawActions.svelte";
  import DrawZoomBar from "./DrawZoomBar.svelte";
  import DrawTextEditor from "./DrawTextEditor.svelte";
  import DrawContextMenu from "./DrawContextMenu.svelte";
  import "./draw-chrome.css";

  let {
    scene,
    ariaLabel = "Drawing canvas",
    onSceneChange,
    onReady,
  }: {
    scene: Scene;
    ariaLabel?: string;
    onSceneChange?: (json: string) => void;
    onReady?: (engine: DrawEngine) => void;
  } = $props();

  let engine = $state.raw<DrawEngine | null>(null);
  let theme = $state<DrawTheme>(LIGHT_THEME);
  let ink = $state("#1e1e1e");
  let tool = $state<DrawTool>("select");
  let toolLocked = $state(false);
  let selectedCount = $state(0);
  let activeStyle = $state<DrawElementStyle>(DEFAULT_ELEMENT_STYLE);
  let textEdit = $state<TextEditRequest | null>(null);
  let zoom = $state(100);
  let contentVisible = $state(true);
  let menu = $state<{ x: number; y: number; element: MenuElementInfo | null } | null>(null);

  let raf = 0;
  let pending: Camera | null = null;

  const cursor = $derived(cursorForTool(tool));

  function syncStyle(source: DrawEngine | null): void {
    if (!source) return;
    const first = source.getSelectedElements()[0];
    activeStyle = first ? styleOf(first) : source.getNextStyle();
  }

  onMount(() => {
    const resolved = themeFromCss(getComputedStyle(document.documentElement));
    theme = resolved.theme;
    ink = resolved.ink;
  });

  onDestroy(() => {
    if (raf) cancelAnimationFrame(raf);
  });

  function onCameraChange(camera: Camera): void {
    pending = camera;
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
</script>

<div class="draw-chrome" style:cursor>
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
    onToolChange={(next) => {
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
  <DrawToolbar
    active={tool}
    {toolLocked}
    onSelect={(next) => engine?.setTool(next)}
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
    onApply={(patch) => {
      engine?.applyStyle(patch);
      syncStyle(engine);
    }}
  />
  <DrawActions {engine} />
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
</div>
