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
  <div class="modal-card pop-in">
    <div class="modal-header">
      <h3 id="export-title">Export Drawing</h3>
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
        <div class="card-icon">PNG</div>
        <div class="card-text">
          <strong>PNG Image</strong>
          <span>High-res raster ({scale}x resolution)</span>
        </div>
      </button>
      <button type="button" class="action-card" onclick={handleExportSvg}>
        <div class="card-icon svg-badge">SVG</div>
        <div class="card-text">
          <strong>SVG Vector</strong>
          <span>Scalable vector graphics for design tools</span>
        </div>
      </button>
      <button type="button" class="action-card" onclick={handleExportJson}>
        <div class="card-icon json-badge">OSI</div>
        <div class="card-text">
          <strong>.osidraw File</strong>
          <span>Native JSON scene for backup & reload</span>
        </div>
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
    backdrop-filter: blur(4px);
  }

  .modal-card {
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 24px;
    width: 480px;
    max-width: 92vw;
    box-shadow: var(--shadow-lg);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 18px;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: var(--fg-strong);
  }

  .close-btn {
    border: none;
    background: transparent;
    font-size: 16px;
    cursor: pointer;
    color: var(--muted);
    padding: 6px 10px;
    border-radius: 6px;
    transition: background var(--transition);
  }

  .close-btn:hover {
    background: var(--bg-hover);
  }

  .options-section {
    background: var(--bg);
    border-radius: 10px;
    padding: 14px;
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
    gap: 6px;
  }

  .scale-chip {
    padding: 4px 12px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
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
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--surface);
    cursor: pointer;
    text-align: left;
    transition: all var(--transition);
  }

  .action-card:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
    box-shadow: var(--shadow-sm);
    background: var(--bg);
  }

  .card-icon {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    background: var(--accent-subtle);
    color: var(--accent);
    display: grid;
    place-items: center;
    font-size: 12px;
    font-weight: 800;
    flex-shrink: 0;
  }

  .card-icon.svg-badge {
    background: rgba(47, 158, 68, 0.14);
    color: #2f9e44;
  }

  .card-icon.json-badge {
    background: rgba(240, 140, 0, 0.14);
    color: #f08c00;
  }

  .card-text {
    display: flex;
    flex-direction: column;
  }

  .card-text strong {
    font-size: 14px;
    color: var(--fg-strong);
  }

  .card-text span {
    font-size: 12px;
    color: var(--muted);
    margin-top: 2px;
  }

  .action-card.primary {
    border-color: var(--accent);
  }
</style>
