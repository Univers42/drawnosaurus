<script lang="ts">
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import { downloadBlob } from "./download.ts";

  let {
    engine,
    onClose,
  }: {
    engine: DrawEngine | null;
    onClose: () => void;
  } = $props();

  let transparent = $state(false);
  let scale = $state(2);
  let exporting = $state(false);

  async function handleExportPng(): Promise<void> {
    if (!engine) return;
    exporting = true;
    try {
      const blob = await engine.exportPng();
      if (blob) downloadBlob("drawing.png", blob);
      onClose();
    } finally {
      exporting = false;
    }
  }

  function handleExportSvg(): void {
    if (!engine) return;
    const svg = engine.exportSvg(16);
    if (svg) downloadBlob("drawing.svg", new Blob([svg], { type: "image/svg+xml" }));
    onClose();
  }

  function handleExportJson(): void {
    if (!engine) return;
    const json = engine.exportJson();
    if (json) downloadBlob("drawing.osidraw", new Blob([json], { type: "application/json" }));
    onClose();
  }
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
  <div class="modal-card">
    <div class="modal-header">
      <h3 id="export-title">Export Image</h3>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close dialog">✕</button>
    </div>

    <div class="options-section">
      <label class="option-row">
        <span>Transparent background</span>
        <input type="checkbox" bind:checked={transparent} />
      </label>
      <div class="option-row">
        <span>Export Scale</span>
        <div class="scale-chips">
          {#each [1, 2, 3] as s (s)}
            <button
              type="button"
              class="scale-chip"
              class:active={scale === s}
              onclick={() => (scale = s)}
            >
              {s}x
            </button>
          {/each}
        </div>
      </div>
    </div>

    <div class="actions-grid">
      <button
        type="button"
        class="action-card primary"
        onclick={handleExportPng}
        disabled={exporting}
      >
        <strong>PNG</strong>
        <span>Raster image ({scale}x resolution)</span>
      </button>
      <button type="button" class="action-card" onclick={handleExportSvg}>
        <strong>SVG</strong>
        <span>Scalable vector graphics</span>
      </button>
      <button type="button" class="action-card" onclick={handleExportJson}>
        <strong>.osidraw</strong>
        <span>Native JSON drawing project</span>
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: grid;
    place-items: center;
    z-index: 100;
    backdrop-filter: blur(3px);
  }

  .modal-card {
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 24px;
    width: 460px;
    max-width: 90vw;
    box-shadow: var(--shadow-lg);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
  }

  .close-btn {
    border: none;
    background: transparent;
    font-size: 16px;
    cursor: pointer;
    color: var(--muted);
    padding: 4px 8px;
    border-radius: 6px;
  }

  .options-section {
    background: var(--bg);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .option-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    font-weight: 500;
  }

  .scale-chips {
    display: flex;
    gap: 4px;
  }

  .scale-chip {
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    font-size: 12px;
    cursor: pointer;
  }

  .scale-chip.active {
    background: var(--accent);
    color: #ffffff;
    border-color: var(--accent);
  }

  .actions-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .action-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 12px 16px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }

  .action-card:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
    box-shadow: var(--shadow-sm);
  }

  .action-card strong {
    font-size: 14px;
    color: var(--ink);
  }

  .action-card span {
    font-size: 12px;
    color: var(--muted);
    margin-top: 2px;
  }

  .action-card.primary {
    border-color: var(--accent);
  }
</style>
