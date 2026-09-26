<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { ApiClientError, createBoard, replaceBoard } from "$lib/api/client.ts";
  import { TEMPLATES } from "$lib/templates/index.ts";
  import MainMenuIcon from "./MainMenuIcon.svelte";

  /**
   * Lists the five starter boards (`$lib/templates`) and puts the one picked wherever
   * this viewer is allowed to put it.
   *
   * The gateway, not a role flag threaded down from the page, decides that: a host can
   * create and delete boards, a network or internet guest cannot
   * (`docker/gateway/Caddyfile`, `apps/api/src/share.ts::roleOf`). Rather than duplicate
   * that rule here, this just tries the host's path — create a board, then fill it — and
   * only on the 403 that answers a guest falls back to the other one, inserting into the
   * board already open. Either way the template's ids are never reused verbatim into a
   * *running* scene: a fresh board gets the file as it is (nothing there to collide
   * with); an insert goes through `engine.pasteJson`, which mints its own.
   */
  let {
    onInsert,
    onClose,
  }: {
    onInsert: (json: string) => void;
    onClose: () => void;
  } = $props();

  let busyId = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function use(template: (typeof TEMPLATES)[number]): Promise<void> {
    if (busyId) return;
    busyId = template.id;
    error = null;
    try {
      const summary = await createBoard(template.name);
      await replaceBoard(summary.slug, template.file, summary.rev);
      onClose();
      await goto(resolve("/boards/[slug]", { slug: summary.slug }));
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status === 403) {
        onInsert(JSON.stringify(template.file));
        onClose();
        return;
      }
      error = cause instanceof Error ? cause.message : "Could not use that template.";
      busyId = null;
    }
  }
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="templates-title">
  <div class="modal-card">
    <div class="modal-header">
      <h3 id="templates-title">Templates</h3>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close dialog">✕</button>
    </div>

    <p class="hint">
      Starts a new board if you can create one here, or drops it into this board otherwise.
    </p>

    <ul class="template-list">
      {#each TEMPLATES as template (template.id)}
        <li>
          <button
            type="button"
            class="template-row"
            disabled={busyId !== null}
            onclick={() => use(template)}
          >
            <span class="template-preview" aria-hidden="true">
              <MainMenuIcon name="diagram" />
            </span>
            <span class="template-text">
              <span class="template-name">{template.name}</span>
              <span class="template-description">{template.description}</span>
            </span>
            {#if busyId === template.id}
              <span class="template-status">Adding…</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>

    {#if error}
      <p class="error-msg" role="alert">{error}</p>
    {/if}

    <div class="actions">
      <button type="button" class="btn-cancel" onclick={onClose}>Cancel</button>
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
    width: 480px;
    max-width: 92vw;
    box-shadow: var(--shadow-lg);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
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

  .hint {
    margin: 0 0 14px;
    font-size: 12px;
    color: var(--muted);
  }

  .template-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 60vh;
    overflow-y: auto;
  }

  .template-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg);
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }

  .template-row:hover:not(:disabled),
  .template-row:focus-visible {
    border-color: var(--accent);
    outline: none;
  }

  .template-row:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .template-preview {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: var(--surface);
    color: var(--muted);
  }

  .template-text {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .template-name {
    font-size: 13px;
    font-weight: 600;
  }

  .template-description {
    font-size: 12px;
    color: var(--muted);
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .template-status {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--muted);
  }

  .error-msg {
    color: var(--danger);
    font-size: 12px;
    margin: 10px 0 0;
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
</style>
