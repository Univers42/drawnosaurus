<script lang="ts">
  import { onMount } from "svelte";
  import { shareLink } from "../sharing/secret.ts";
  import { copyText } from "./share.ts";
  import { takeFocus } from "./focusHandback.ts";
  import { qrSource } from "./qr.ts";

  let {
    slug,
    secret = null,
    onShare,
    onClose,
  }: {
    slug: string;
    /** The drawing's secret, when it is shared: the link is then already known. */
    secret?: Uint8Array | null;
    /** Mints the secret, writes the first copy, goes live, and answers with the link. */
    onShare?: () => Promise<string>;
    onClose: () => void;
  } = $props();

  /** The link, once the drawing is shared. */
  let link = $state<string | null>(null);
  /** The link last copied, for its button's word — or one that did not copy. */
  let copied = $state(false);
  let copyFailed = $state(false);
  /** A share under way, and what went wrong with the last one. */
  let busy = $state(false);
  let failure = $state<string | null>(null);

  let card: HTMLDivElement | undefined;

  /**
   * The link of a drawing that is already shared: the one the page put in the address
   * bar, with the secret in its fragment. Opening the dialog again shows the same link.
   */
  const known = $derived(
    secret && typeof window !== "undefined"
      ? shareLink(window.location.origin, slug, secret)
      : null,
  );

  const shown = $derived(link ?? known);

  onMount(() => {
    // An open dialog takes the focus and hands it back on close — `takeFocus`, and why it
    // is two things and not one, in `focusHandback.ts`.
    const handBack = takeFocus(card);
    return handBack;
  });

  /**
   * The first control of the dialog takes the focus, as the oracle's does: it focuses the
   * first focusable element that is not the close button (`Dialog.tsx@1118751f:61-68`).
   * The link's own field is where a person would then read the link from.
   */
  $effect(() => {
    // Read what is on screen, so the effect runs again when the view changes.
    const view = shown;
    if (!card || !view) return;
    const control = card.querySelector<HTMLElement>("[data-first]");
    control?.focus();
  });

  async function share(): Promise<void> {
    if (!onShare) return;
    busy = true;
    failure = null;
    try {
      link = await onShare();
    } catch (error) {
      failure = error instanceof Error ? error.message : "the drawing could not be shared";
    } finally {
      busy = false;
    }
  }

  async function copy(): Promise<void> {
    if (!shown) return;
    if (await copyText(shown)) {
      copied = true;
      copyFailed = false;
      setTimeout(() => {
        copied = false;
      }, 2000);
    } else {
      // Nothing reached the clipboard: say so, and leave the text to copy by hand.
      copyFailed = true;
    }
  }
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="public-share-title">
  <div class="modal-card pop-in" tabindex="-1" bind:this={card}>
    <div class="modal-header">
      <h3 id="public-share-title">Live collaboration</h3>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close dialog">✕</button>
    </div>

    {#if shown}
      <p class="lead">Send this link. Whoever opens it draws on this drawing with you, live.</p>
      <div class="link-row">
        <input
          readonly
          value={shown}
          aria-label="Share link"
          data-first
          onfocus={(event) => (event.currentTarget as HTMLInputElement).select()}
        />
        <button type="button" class="copy-btn" data-first onclick={() => void copy()}>
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
      {#if copyFailed}
        <p class="copy-failed" role="alert">Could not copy — select the link and press Ctrl+C.</p>
      {/if}
      <div class="qr" role="img" aria-label="QR code for collaboration link">
        <img src={qrSource(shown)} alt="QR code of the share link" />
      </div>
      <p class="note">
        The link carries the drawing's secret, and it is never sent to a server: whoever has it can
        draw on this drawing, and nobody else can read what is there.
      </p>
    {:else}
      <p class="lead">Invite people to draw on this drawing with you, live.</p>
      <button
        type="button"
        class="start-btn"
        data-first
        disabled={busy || !onShare}
        onclick={() => void share()}
      >
        {busy ? "Sharing…" : "Share live"}
      </button>
      {#if failure}
        <p class="copy-failed" role="alert">{failure}</p>
      {/if}
      <p class="note">
        The drawing is kept online as well, so the people you share it with still find it after you
        close the tab. The secret stays in the link: no server can read it.
      </p>
    {/if}
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: grid;
    place-items: center;
    z-index: 100;
    backdrop-filter: blur(2px);
  }

  .modal-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--shadow-lg);
    padding: 20px;
    width: min(460px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 14px;
    color: var(--ink);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
  }

  .close-btn {
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 15px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: var(--radius);
  }

  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--ink);
  }

  .lead {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }

  .link-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .link-row input {
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 10px;
    font-size: 12px;
    font-family: var(--font-mono, monospace);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
  }

  .copy-btn,
  .start-btn {
    height: 34px;
    padding: 0 14px;
    border-radius: var(--radius);
    border: none;
    background: var(--accent);
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .copy-btn:hover,
  .start-btn:hover {
    filter: brightness(1.08);
  }

  .start-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .copy-failed {
    margin: 0;
    font-size: 12px;
    color: var(--danger);
  }

  /* The QR code's own box: white, so the code reads on a dark theme too
     (`ShareDialog.scss@1118751f:143-166`). */
  .qr {
    display: flex;
    justify-content: center;
    align-items: center;
    align-self: center;
    padding: 16px;
    background: #fff;
    border-radius: 8px;
    border: 1px solid #e0e0e0;
    width: 150px;
    height: 150px;
  }

  .qr img {
    width: 150px;
    height: 150px;
  }

  .note {
    margin: 0;
    border-top: 1px solid var(--line);
    padding-top: 10px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--muted);
  }
</style>
