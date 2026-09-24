<script lang="ts">
  /**
   * Vectorize an image already on the board: trace it, show the trace, put it in its place.
   *
   * The trace runs in a Web Worker (`TraceWorker`), so the board stays live and Cancel
   * is immediate. Each change of preset or slider retraces — sliders after a pause, so a
   * drag is one trace, not thirty. The insert is one engine call, one undo step. The
   * numbers behind the presets and the caps are in `./vectorize.ts`.
   */
  import { onMount } from "svelte";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import {
    TraceCancelled,
    TraceWorker,
    svgDataUrl,
    type TracePreset,
    type TraceResult,
  } from "@osionos/draw-engine/vectorize";
  import InspectorSegmented from "./InspectorSegmented.svelte";
  import { scaledToFit } from "./imageFile.ts";
  import {
    DIAL_RANGE,
    PRESETS,
    TRACE_MAX_SIDE,
    VECTORIZE_LIMITS,
    dialApplies,
    insertBlocker,
    overallProgress,
    presetChoice,
    refusalMessage,
    statsLine,
    traceConfig,
    type Dials,
    type InsertAs,
  } from "./vectorize.ts";

  let {
    engine,
    imageId,
    onClose,
  }: {
    engine: DrawEngine | null;
    imageId: string;
    onClose: () => void;
  } = $props();

  /** A slider waits this long after the last move before tracing. */
  const SETTLE_MS = 300;

  const SLIDERS: Array<{ dial: keyof Dials; label: string; less: string; more: string }> = [
    { dial: "colours", label: "Colours", less: "Fewer", more: "More" },
    { dial: "detail", label: "Detail", less: "Less", more: "More" },
    { dial: "smoothness", label: "Smoothness", less: "Sharp", more: "Smooth" },
  ];

  let preset = $state<TracePreset>("photo");
  let dials = $state<Dials>({ ...presetChoice("photo").dials });
  let insertAs = $state<InsertAs>("shapes");
  let keepOriginal = $state(false);

  let status = $state<"loading" | "tracing" | "ready" | "cancelled" | "failed">("loading");
  let progress = $state({ label: "Reading the picture", value: 0 });
  let result = $state<TraceResult | null>(null);
  let previewUrl = $state<string | null>(null);
  let problem = $state<string | null>(null);
  let inserting = $state(false);

  const blocker = $derived(result ? insertBlocker(result.stats, insertAs, preset) : null);
  const canInsert = $derived(
    status === "ready" && result !== null && blocker === null && !inserting && engine !== null,
  );

  let card: HTMLDivElement | undefined;
  let bitmap: ImageBitmap | null = null;
  let tracer: TraceWorker | null = null;
  let opening: Promise<TraceWorker> | null = null;
  let settle: ReturnType<typeof setTimeout> | undefined;
  /** Counts trace requests: only the newest one's result is shown. */
  let requested = 0;
  let closed = false;

  onMount(() => {
    card?.focus();
    void start();
    return () => {
      closed = true;
      clearTimeout(settle);
      tracer?.terminate();
      void opening?.then((worker) => worker.terminate()).catch(() => undefined);
      bitmap?.close();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  });

  async function start(): Promise<void> {
    try {
      bitmap = await loadBitmap();
    } catch {
      status = "failed";
      problem = "The picture could not be read. It may not have finished arriving yet.";
      return;
    }
    if (!closed) await trace();
  }

  /** The image's pixels, no larger than the size it is traced at. */
  async function loadBitmap(): Promise<ImageBitmap> {
    const element = engine?.getSelectedElements().find((el) => el.id === imageId);
    const dataUrl = (element as { dataUrl?: string } | undefined)?.dataUrl;
    if (!element || !dataUrl) throw new Error("no picture");
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    // An SVG with no intrinsic size reports 0; its box on the board stands in for it.
    const size = scaledToFit(
      image.naturalWidth || Math.abs(element.width),
      image.naturalHeight || Math.abs(element.height),
      TRACE_MAX_SIDE,
    );
    return createImageBitmap(image, {
      resizeWidth: Math.max(1, Math.round(size.width)),
      resizeHeight: Math.max(1, Math.round(size.height)),
      resizeQuality: "high",
    });
  }

  async function worker(): Promise<TraceWorker> {
    if (tracer) return tracer;
    if (!bitmap) throw new Error("no picture");
    opening ??= TraceWorker.open(bitmap, (step) => {
      if (status === "tracing") progress = overallProgress(step);
    });
    const pending = opening;
    try {
      const opened = await pending;
      // Cancelled while it was starting: this one is not wanted any more.
      if (opening !== pending) {
        opened.terminate();
        throw new TraceCancelled();
      }
      tracer = opened;
      return opened;
    } catch (error) {
      if (opening === pending) opening = null;
      throw error;
    }
  }

  async function trace(): Promise<void> {
    const ask = ++requested;
    status = "tracing";
    progress = { label: "Starting", value: 0 };
    problem = null;
    try {
      const traced = await (await worker()).render(traceConfig(preset, dials));
      if (traced === null || ask !== requested || closed) return;
      result = traced;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(new Blob([traced.svg], { type: "image/svg+xml" }));
      status = "ready";
    } catch (error) {
      if (error instanceof TraceCancelled || ask !== requested || closed) return;
      status = "failed";
      problem = `Tracing failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /** After a cancel or a failure: from the picture again if it was never read. */
  function retry(): Promise<void> {
    return bitmap ? trace() : start();
  }

  function retrace(after: number): void {
    clearTimeout(settle);
    settle = setTimeout(() => void trace(), after);
  }

  function pickPreset(next: TracePreset): void {
    preset = next;
    dials = { ...presetChoice(next).dials };
    retrace(0);
  }

  function moveDial(dial: keyof Dials, value: number): void {
    dials = { ...dials, [dial]: value };
    retrace(SETTLE_MS);
  }

  /** Stops the trace in progress. The worker goes with it; the next trace starts another. */
  function cancelTrace(): void {
    requested += 1;
    clearTimeout(settle);
    tracer?.terminate();
    tracer = null;
    opening = null;
    status = "cancelled";
  }

  async function insert(): Promise<void> {
    if (!canInsert || !engine || !result || !tracer) return;
    inserting = true;
    problem = null;
    try {
      const options = { keepOriginal, limits: VECTORIZE_LIMITS };
      const outcome =
        insertAs === "shapes"
          ? engine.vectorizeImage(imageId, { as: "shapes", rings: await tracer.rings() }, options)
          : engine.vectorizeImage(
              imageId,
              { as: "picture", dataUrl: svgDataUrl(result.svg) },
              options,
            );
      if ("refused" in outcome) problem = refusalMessage(outcome.refused);
      else onClose();
    } catch (error) {
      problem = `Inserting failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      inserting = false;
    }
  }

  const statusText = $derived.by(() => {
    if (status === "loading") return "Reading the picture…";
    if (status === "tracing") return `${progress.label}…`;
    if (status === "cancelled") return "Tracing cancelled.";
    if (status === "failed" || !result) return "Nothing traced.";
    return statsLine(result.stats, insertAs);
  });
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="vectorize-title">
  <div class="modal-card" tabindex="-1" bind:this={card}>
    <div class="modal-header">
      <h3 id="vectorize-title">Vectorize image</h3>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close dialog">✕</button>
    </div>

    <div class="preview" aria-busy={status === "tracing" || status === "loading"}>
      {#if previewUrl}
        <img src={previewUrl} alt="Preview of the trace" />
      {/if}
      {#if status === "tracing" || status === "loading"}
        <div class="working">
          <progress max="1" value={progress.value} aria-label="Tracing progress"></progress>
          {#if status === "tracing"}
            <button type="button" class="small" onclick={cancelTrace}>Cancel trace</button>
          {/if}
        </div>
      {:else if status === "cancelled" || status === "failed"}
        <div class="working">
          <button type="button" class="small" onclick={() => void retry()}>Trace again</button>
        </div>
      {/if}
    </div>

    <p class="stats" role="status" aria-live="polite">{statusText}</p>
    {#if blocker && status === "ready"}
      <p class="warning" role="alert">{blocker}</p>
    {/if}
    {#if problem}
      <p class="error" role="alert">{problem}</p>
    {/if}

    <div class="controls">
      <InspectorSegmented
        options={PRESETS.map((choice) => ({ label: choice.label, value: choice.preset }))}
        value={preset}
        ariaLabel="Preset"
        onPick={(value) => pickPreset(value as TracePreset)}
      />

      {#each SLIDERS as slider (slider.dial)}
        {@const range = DIAL_RANGE[slider.dial]}
        {@const applies = dialApplies(preset, slider.dial)}
        <label class="slider" class:off={!applies}>
          <span class="name">{slider.label}</span>
          <span class="end" aria-hidden="true">{slider.less}</span>
          <input
            type="range"
            min={range.min}
            max={range.max}
            step="1"
            value={dials[slider.dial]}
            disabled={!applies}
            aria-valuetext={applies ? `${dials[slider.dial]} of ${range.max}` : "Not used"}
            oninput={(event) => moveDial(slider.dial, event.currentTarget.valueAsNumber)}
          />
          <span class="end" aria-hidden="true">{slider.more}</span>
        </label>
      {/each}

      <fieldset>
        <legend>Insert as</legend>
        <label>
          <input type="radio" name="vectorize-as" value="shapes" bind:group={insertAs} />
          Editable shapes
        </label>
        <label>
          <input type="radio" name="vectorize-as" value="picture" bind:group={insertAs} />
          One vector picture
        </label>
      </fieldset>

      <label class="check">
        <input type="checkbox" bind:checked={keepOriginal} />
        Keep the original image
      </label>
    </div>

    <div class="actions">
      <button type="button" class="btn-cancel" onclick={onClose}>Cancel</button>
      <button type="button" class="btn-primary" disabled={!canInsert} onclick={() => void insert()}>
        {inserting ? "Inserting…" : "Insert"}
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
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 0.75rem;
    padding: 1.25rem;
    width: min(30rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    overflow: auto;
    box-sizing: border-box;
    box-shadow: 0 16px 48px rgb(0 0 0 / 24%);
  }

  .modal-card:focus {
    outline: none;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.875rem;
  }

  h3 {
    margin: 0;
    font-size: 1rem;
  }

  .close-btn {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--muted);
  }

  .preview {
    position: relative;
    display: grid;
    place-items: center;
    height: 13rem;
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    background: var(--bg);
    overflow: hidden;
  }

  .preview img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .working {
    position: absolute;
    inset: auto 0.75rem 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  progress {
    flex: 1;
    accent-color: var(--accent);
  }

  .stats,
  .warning,
  .error {
    margin: 0.5rem 0 0;
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .stats {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .warning {
    color: var(--text);
  }

  .error {
    color: var(--danger, #e03131);
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    margin-top: 0.875rem;
    font-size: 0.8125rem;
  }

  .slider {
    display: grid;
    grid-template-columns: 5.5rem auto 1fr auto;
    align-items: center;
    gap: 0.5rem;
  }

  .slider.off {
    opacity: 0.5;
  }

  .slider input {
    width: 100%;
    accent-color: var(--accent);
  }

  .end {
    font-size: 0.6875rem;
    color: var(--muted);
  }

  fieldset {
    display: flex;
    gap: 1rem;
    margin: 0;
    padding: 0;
    border: none;
  }

  legend {
    float: left;
    width: 5.5rem;
    padding: 0;
  }

  fieldset label,
  .check {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .actions button,
  .small {
    padding: 0.4375rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .small {
    padding: 0.25rem 0.625rem;
    font-size: 0.75rem;
  }

  .btn-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .btn-primary:disabled,
  .small:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
