<script lang="ts">
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import { downloadBlob } from "./download.ts";

  let { engine }: { engine: DrawEngine | null } = $props();

  async function exportPng(): Promise<void> {
    const blob = await engine?.exportPng();
    if (blob) downloadBlob("drawing.png", blob);
  }

  function exportSvg(): void {
    const svg = engine?.exportSvg();
    if (svg) downloadBlob("drawing.svg", new Blob([svg], { type: "image/svg+xml" }));
  }

  function exportJson(): void {
    const json = engine?.exportJson();
    if (json) downloadBlob("drawing.osidraw", new Blob([json], { type: "application/json" }));
  }

  function reset(): void {
    if (globalThis.confirm("Clear the whole canvas? This cannot be undone.")) engine?.clear();
  }
</script>

<div class="draw-panel group" role="group" aria-label="Export and canvas actions">
  <button type="button" title="Export PNG" onclick={exportPng}>PNG</button>
  <button type="button" title="Export SVG" onclick={exportSvg}>SVG</button>
  <button type="button" title="Export .osidraw JSON" onclick={exportJson}>JSON</button>
  <button type="button" class="danger" title="Reset canvas" onclick={reset}>Reset</button>
</div>

<style>
  .group {
    position: absolute;
    bottom: 16px;
    right: 16px;
    display: flex;
    gap: 4px;
    padding: 6px;
    border-radius: 12px;
    z-index: 2;
  }

  button {
    height: 30px;
    padding: 0 10px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    font-size: 12px;
    font-weight: 600;
  }

  .danger {
    color: var(--danger);
  }
</style>
