<script lang="ts">
  import type { DrawElementDto } from "@drawnosaurus/contract";
  import { parseMermaidFlowchart } from "../mermaid/mermaidParser.ts";
  import { mermaidToElements } from "../mermaid/mermaidToElements.ts";

  let {
    onInsert,
    onClose,
  }: {
    onInsert: (elements: DrawElementDto[]) => void;
    onClose: () => void;
  } = $props();

  const TEMPLATES: Record<string, string> = {
    flowchart: `graph TD\n  Start[Start Project] --> Decision{Is it ready?}\n  Decision -->|Yes| Launch[Launch v1]\n  Decision -->|No| Fix[Fix Bugs]\n  Fix --> Decision`,
    architecture: `flowchart LR\n  Client[Browser WebApp] --> API[Fastify API]\n  API --> DB[(MongoDB Atlas)]\n  Client -.-> Engine[Rust WASM]`,
  };

  let code = $state(TEMPLATES.flowchart ?? "");
  let error = $state<string | null>(null);

  function loadTemplate(key: string): void {
    if (TEMPLATES[key]) code = TEMPLATES[key];
  }

  function handleInsert(): void {
    try {
      error = null;
      const parsed = parseMermaidFlowchart(code);
      if (parsed.nodes.length === 0) {
        error = "No valid nodes found in diagram";
        return;
      }
      const elements = mermaidToElements(parsed);
      onInsert(elements);
      onClose();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Failed to parse Mermaid code";
    }
  }
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="mermaid-title">
  <div class="modal-card">
    <div class="modal-header">
      <h3 id="mermaid-title">Insert Mermaid Diagram</h3>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close dialog">✕</button>
    </div>

    <div class="templates-row">
      <span class="label">Templates:</span>
      <button type="button" class="template-chip" onclick={() => loadTemplate("flowchart")}>
        Flowchart
      </button>
      <button type="button" class="template-chip" onclick={() => loadTemplate("architecture")}>
        Architecture
      </button>
    </div>

    <textarea
      bind:value={code}
      rows={8}
      placeholder="Paste your Mermaid graph TD / flowchart code here..."
      aria-label="Mermaid code"
    ></textarea>

    {#if error}
      <p class="error-msg" role="alert">{error}</p>
    {/if}

    <div class="actions">
      <button type="button" class="btn-cancel" onclick={onClose}>Cancel</button>
      <button type="button" class="btn-primary" onclick={handleInsert}>Insert onto Canvas</button>
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
    width: 520px;
    max-width: 92vw;
    box-shadow: var(--shadow-lg);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
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

  .templates-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .templates-row .label {
    font-size: 12px;
    color: var(--muted);
  }

  .template-chip {
    padding: 3px 10px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--ink);
    font-size: 12px;
    cursor: pointer;
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--ink);
    resize: vertical;
  }

  .error-msg {
    color: var(--danger);
    font-size: 12px;
    margin: 6px 0 0;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .btn-cancel {
    padding: 8px 16px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink);
    border-radius: 8px;
    font-size: 13px;
    cursor: pointer;
  }

  .btn-primary {
    padding: 8px 16px;
    background: var(--accent);
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
</style>
