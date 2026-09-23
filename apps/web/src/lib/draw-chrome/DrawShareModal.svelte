<script lang="ts">
  import type { ConnectionStatus, PeerCursor } from "../realtime/realtimeClient.ts";

  let {
    slug,
    peers = [],
    connectionStatus = "disconnected",
    onClose,
  }: {
    slug: string;
    peers: PeerCursor[];
    connectionStatus?: ConnectionStatus;
    onClose: () => void;
  } = $props();

  let copied = $state(false);

  // Prefer the live href (includes `#room=` after connect). Peers can also join from
  // the bare board URL — the room key is derived from the slug when the fragment is
  // absent — but sharing the full link keeps a private `#room=` override intact.
  const shareUrl = $derived(
    typeof window !== "undefined" ? window.location.href : `/boards/${slug}`,
  );

  const statusLabel = $derived(
    connectionStatus === "connected"
      ? "Live"
      : connectionStatus === "connecting"
        ? "Connecting…"
        : "Offline",
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
  <div class="modal-card pop-in">
    <div class="modal-header">
      <div class="title-with-status">
        <h3 id="share-title">Live Collaboration</h3>
        <span
          class="live-pill"
          class:live-pill--offline={connectionStatus !== "connected"}
          class:live-pill--connecting={connectionStatus === "connecting"}
        >
          <span class="pulse-dot"></span>
          {statusLabel}
        </span>
      </div>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close dialog">✕</button>
    </div>

    <p class="description">
      Anyone with this board link can draw together in real time. Live frames are sealed in the
      browser so the realtime relay only sees ciphertext; board saves over HTTP are still readable
      by the server.
    </p>

    <div class="link-box">
      <input readonly value={shareUrl} aria-label="Share URL" />
      <button type="button" class="copy-btn" onclick={copyLink}>
        {copied ? "Copied! ✓" : "Copy Link"}
      </button>
    </div>

    <div class="peers-section">
      <div class="peers-header">
        <h4>Active Collaborators</h4>
        <span class="count-badge">{peers.length + 1} online</span>
      </div>
      <div class="peers-list">
        <div class="peer-item me">
          <div class="avatar" style:background="#6965db">You</div>
          <span class="name">You (Host)</span>
        </div>
        {#each peers as peer (peer.clientId)}
          <div class="peer-item">
            <div class="avatar" style:background={peer.color}>
              {peer.name.slice(0, 2).toUpperCase()}
            </div>
            <span class="name">{peer.name}</span>
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
    backdrop-filter: blur(4px);
  }

  .modal-card {
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 24px;
    width: 460px;
    max-width: 90vw;
    box-shadow: var(--shadow-lg);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .title-with-status {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: var(--fg-strong);
  }

  .live-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 700;
    color: #2f9e44;
    background: rgba(47, 158, 68, 0.12);
    padding: 2px 8px;
    border-radius: 999px;
  }

  .live-pill--connecting {
    color: #f08c00;
    background: rgba(240, 140, 0, 0.12);
  }

  .live-pill--connecting .pulse-dot {
    background: #f08c00;
  }

  .live-pill--offline {
    color: var(--muted);
    background: rgba(128, 128, 128, 0.12);
  }

  .live-pill--offline .pulse-dot {
    background: var(--muted);
    animation: none;
  }

  .pulse-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #2f9e44;
    animation: pulse 1.2s infinite alternate;
  }

  @keyframes pulse {
    from {
      opacity: 0.4;
    }
    to {
      opacity: 1;
    }
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

  .description {
    font-size: 13px;
    color: var(--muted);
    margin: 0 0 16px;
    line-height: 1.45;
  }

  .description code {
    font-size: 12px;
    color: var(--ink);
  }

  .link-box {
    display: flex;
    gap: 8px;
    margin-bottom: 20px;
  }

  .link-box input {
    flex: 1;
    padding: 8px 12px;
    border-radius: var(--radius);
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
    border-radius: var(--radius);
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--transition);
  }

  .copy-btn:hover {
    filter: brightness(1.08);
  }

  .peers-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .peers-section h4 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }

  .count-badge {
    font-size: 11px;
    color: var(--muted);
  }

  .peers-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 150px;
    overflow-y: auto;
    padding: 2px;
  }

  .peer-item {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    padding: 4px 6px;
    border-radius: 8px;
  }

  .avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .name {
    color: var(--ink);
    font-weight: 500;
  }
</style>
