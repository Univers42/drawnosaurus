<script lang="ts">
  import type { PeerCursor } from "../realtime/realtimeClient.ts";

  let {
    slug,
    peers = [],
    onClose,
  }: {
    slug: string;
    peers: PeerCursor[];
    onClose: () => void;
  } = $props();

  let copied = $state(false);

  const shareUrl = $derived(
    typeof window !== "undefined" ? `${window.location.origin}/boards/${slug}` : `/boards/${slug}`,
  );

  async function copyLink(): Promise<void> {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(shareUrl);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2000);
    }
  }
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="share-title">
  <div class="modal-card">
    <div class="modal-header">
      <h3 id="share-title">Live Collaboration</h3>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close dialog">✕</button>
    </div>

    <p class="description">
      Share this link to invite others to view and edit this board in real-time.
    </p>

    <div class="link-box">
      <input readonly value={shareUrl} aria-label="Share URL" />
      <button type="button" class="copy-btn" onclick={copyLink}>
        {copied ? "Copied! ✓" : "Copy Link"}
      </button>
    </div>

    <div class="peers-section">
      <h4>Active Collaborators ({peers.length + 1})</h4>
      <div class="peers-list">
        <div class="peer-item me">
          <span class="dot" style:background="#1971c2"></span>
          <span>You</span>
        </div>
        {#each peers as peer (peer.clientId)}
          <div class="peer-item">
            <span class="dot" style:background={peer.color}></span>
            <span>{peer.name}</span>
          </div>
        {/each}
      </div>
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
    width: 440px;
    max-width: 90vw;
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

  .description {
    font-size: 13px;
    color: var(--muted);
    margin: 0 0 16px;
  }

  .link-box {
    display: flex;
    gap: 8px;
    margin-bottom: 20px;
  }

  .link-box input {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--ink);
    font-size: 13px;
  }

  .copy-btn {
    padding: 8px 16px;
    background: var(--accent);
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
  }

  .peers-section h4 {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }

  .peers-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 140px;
    overflow-y: auto;
  }

  .peer-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
</style>
