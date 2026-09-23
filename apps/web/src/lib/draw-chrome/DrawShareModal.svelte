<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { renderSVG } from "uqr";
  import type { ShareInfo } from "@drawnosaurus/contract";
  import { getShareInfo, startTunnel, stopTunnel } from "$lib/api/client.ts";
  import type { ConnectionStatus, PeerCursor } from "../realtime/realtimeClient.ts";
  import { copyText, describeLink, internetPrompt, shareLinks, type ShareLink } from "./share.ts";

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

  /** What the server says about where others can reach it; null until it answers. */
  let info = $state<ShareInfo | null>(null);
  /** The link last copied, for its button's "Copied" — or one that did not copy. */
  let copied = $state<string | null>(null);
  let copyFailed = $state<string | null>(null);
  /** The link whose QR code is showing. */
  let qrFor = $state<string | null>(null);
  /** An internet-link request in flight, and what went wrong with the last one. */
  let busy = $state(false);
  let requestError = $state<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      info = await getShareInfo();
    } catch {
      // Keep what was there: the links do not stop working because one answer failed.
    }
  }

  onMount(() => {
    void refresh();
  });

  // While the internet link opens, ask again every second until it is on or failed.
  let poll: ReturnType<typeof setInterval> | null = null;
  $effect(() => {
    const opening = info?.tunnel.state === "starting";
    if (opening && !poll) poll = setInterval(() => void refresh(), 1000);
    if (!opening && poll) {
      clearInterval(poll);
      poll = null;
    }
  });
  onDestroy(() => {
    if (poll) clearInterval(poll);
  });

  // From the live location, so the fragment room key travels with each link. The server
  // never receives that fragment; without it, a peer cannot decrypt live frames.
  const links = $derived(
    typeof window === "undefined"
      ? []
      : shareLinks(
          {
            origin: window.location.origin,
            pathname: window.location.pathname || `/boards/${slug}`,
            search: window.location.search,
            hash: window.location.hash,
          },
          info,
        ),
  );
  const primary = $derived(links[0]);
  /**
   * The internet link, shown where it was opened — in its own section, for the computer
   * that opened it — rather than filed under "Other links", where pressing the button
   * seemed to do nothing.
   */
  const internetLink = $derived(
    info?.canManage
      ? links.find((link) => link.kind === "internet" && link !== primary)
      : undefined,
  );
  const others = $derived(links.slice(1).filter((link) => link !== internetLink));
  const tunnelState = $derived(info?.tunnel.state ?? "unavailable");

  const statusLabel = $derived(
    connectionStatus === "connected"
      ? "Live"
      : connectionStatus === "connecting"
        ? "Connecting…"
        : "Offline",
  );

  async function copyLink(url: string): Promise<void> {
    if (await copyText(url)) {
      copied = url;
      copyFailed = null;
      setTimeout(() => {
        if (copied === url) copied = null;
      }, 2000);
    } else {
      // Nothing reached the clipboard: say so, and leave the text to copy by hand.
      copyFailed = url;
    }
  }

  const qrSource = (url: string): string =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(url, { pixelSize: 4, border: 2 }))}`;

  async function openInternet(): Promise<void> {
    busy = true;
    requestError = null;
    try {
      info = await startTunnel();
    } catch (error) {
      requestError = error instanceof Error ? error.message : "the internet link did not open";
    } finally {
      busy = false;
    }
  }

  async function closeInternet(): Promise<void> {
    busy = true;
    requestError = null;
    try {
      info = await stopTunnel();
      if (qrFor && !links.some((link) => link.url === qrFor)) qrFor = null;
    } catch (error) {
      requestError = error instanceof Error ? error.message : "the internet link did not close";
    } finally {
      busy = false;
    }
  }
</script>

{#snippet linkRow(link: ShareLink, main: boolean)}
  {@const about = describeLink(link)}
  <div class="link-row" class:link-row--primary={main} data-kind={link.kind}>
    <div class="link-label">
      <span class="link-title">{about.title}</span>
      <span class="link-hint">{about.hint}</span>
    </div>
    <div class="link-box">
      <input
        readonly
        value={link.url}
        aria-label={`Share link — ${about.title}`}
        onfocus={(event) => (event.currentTarget as HTMLInputElement).select()}
      />
      <button type="button" class="copy-btn" onclick={() => copyLink(link.url)}>
        {copied === link.url ? "Copied! ✓" : "Copy link"}
      </button>
      <button
        type="button"
        class="qr-btn"
        aria-label="Show a QR code of this link"
        aria-pressed={qrFor === link.url}
        onclick={() => (qrFor = qrFor === link.url ? null : link.url)}>QR</button
      >
    </div>
    {#if copyFailed === link.url}
      <p class="copy-failed" role="alert">Could not copy — select the link and press Ctrl+C.</p>
    {/if}
    {#if qrFor === link.url}
      <div class="qr">
        <img src={qrSource(link.url)} alt="QR code of the link" />
        <span>Scan it with a phone or tablet's camera to open the board there.</span>
      </div>
    {/if}
  </div>
{/snippet}

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

    <p class="lead">Send this link. Whoever opens it draws on this board with you, live.</p>

    {#if primary}
      {@render linkRow(primary, true)}
    {/if}

    {#if others.length > 0}
      <details class="more">
        <summary>Other links ({others.length})</summary>
        {#each others as link (link.url)}
          {@render linkRow(link, false)}
        {/each}
      </details>
    {/if}

    {#if info?.canManage && tunnelState !== "unavailable"}
      <section class="internet" aria-label="Internet link">
        {#if tunnelState === "starting"}
          <p>Opening a public link… it takes about ten seconds.</p>
        {:else if tunnelState === "on"}
          {#if internetLink}
            {@render linkRow(internetLink, false)}
          {/if}
          <p>
            Open until you stop it, or restart drawnosaurus.
            <button type="button" class="text-btn" onclick={closeInternet} disabled={busy}
              >Stop sharing on the internet</button
            >
          </p>
        {:else}
          <p>{internetPrompt(links)}</p>
          <button type="button" class="internet-btn" onclick={openInternet} disabled={busy}
            >Share on the internet</button
          >
          {#if tunnelState === "failed" && info?.tunnel.message}
            <p class="tunnel-error" role="alert">It did not open: {info.tunnel.message}.</p>
          {/if}
        {/if}
        {#if requestError}
          <p class="tunnel-error" role="alert">{requestError}</p>
        {/if}
      </section>
    {/if}

    <details class="help">
      <summary>How does this work?</summary>
      <ol>
        <li>
          Copy the link and send it — chat, email — or show its QR code to someone with a phone.
        </li>
        <li>They open it in any browser. Nothing to install, no account.</li>
        <li>
          If it does not open for them, try one of the other links. If none do, their network cannot
          reach this computer: use <strong>Share on the internet</strong>.
        </li>
      </ol>
      <p>
        The part after <code>#</code> is the room's secret key. It never reaches the server, so live changes
        stay end-to-end encrypted — and anyone who has the link can edit this board.
      </p>
    </details>

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

  .link-row {
    margin-bottom: 14px;
  }

  .link-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 6px;
  }

  .link-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-strong);
  }

  .link-hint {
    font-size: 12px;
    color: var(--muted);
  }

  .copy-failed {
    margin: 6px 0 0;
    font-size: 12px;
    color: #e03131;
  }

  .link-box {
    display: flex;
    gap: 8px;
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
  .lead {
    font-size: 13px;
    color: var(--ink);
    margin: 0 0 14px;
    line-height: 1.45;
  }

  .link-row--primary .link-box input {
    font-size: 14px;
    font-weight: 600;
  }

  .qr-btn {
    padding: 8px 10px;
    background: var(--bg);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
  }

  .qr-btn[aria-pressed="true"] {
    border-color: var(--accent);
    color: var(--accent);
  }

  .qr {
    margin-top: 10px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
    color: var(--muted);
  }

  .qr img {
    width: 148px;
    height: 148px;
    background: #ffffff;
    border-radius: 8px;
    padding: 6px;
    image-rendering: pixelated;
  }

  details.more,
  details.help {
    margin: 0 0 14px;
    font-size: 13px;
  }

  details summary {
    cursor: pointer;
    color: var(--muted);
    font-weight: 600;
    margin-bottom: 8px;
  }

  details.help ol {
    margin: 0 0 8px;
    padding-left: 18px;
    color: var(--ink);
    line-height: 1.5;
  }

  details.help p {
    margin: 0;
    color: var(--muted);
    line-height: 1.45;
  }

  .internet {
    border-top: 1px solid var(--line);
    padding-top: 12px;
    margin: 4px 0 14px;
    font-size: 13px;
    color: var(--ink);
  }

  .internet p {
    margin: 0 0 8px;
    line-height: 1.45;
  }

  .internet-btn {
    padding: 8px 14px;
    background: var(--bg);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
  }

  .internet-btn:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  .text-btn {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
  }

  .tunnel-error {
    color: #e03131;
  }
</style>
