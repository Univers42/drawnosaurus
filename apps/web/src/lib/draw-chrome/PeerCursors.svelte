<script lang="ts">
  import { IDENTITY, type Camera } from "@osionos/draw-engine/types";
  import type { PeerCursor } from "../realtime/realtimeClient.ts";
  import { worldToScreen } from "./camera.ts";

  let {
    peers = [],
    camera,
  }: {
    peers: PeerCursor[];
    camera?: Camera;
  } = $props();

  function toScreen(x: number, y: number): { sx: number; sy: number } {
    return worldToScreen(camera ?? IDENTITY, x, y);
  }
</script>

<div class="peer-cursors-layer" aria-hidden="true">
  {#each peers.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) as peer (peer.clientId)}
    {@const { sx, sy } = toScreen(peer.x, peer.y)}
    <div class="cursor-wrapper" style:transform="translate({sx}px, {sy}px)">
      <svg class="cursor-icon" viewBox="0 0 16 16" width="20" height="20" fill={peer.color}>
        <path d="M0 0 L14 6 L7 8 L5 15 Z" stroke="#ffffff" stroke-width="1.5" />
      </svg>
      <span class="cursor-tag" style:background={peer.color}>
        {peer.name}
      </span>
    </div>
  {/each}
</div>

<style>
  .peer-cursors-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 10;
  }

  .cursor-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: flex-start;
    transition: transform 0.08s ease-out;
    will-change: transform;
  }

  .cursor-icon {
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
  }

  .cursor-tag {
    margin-left: 6px;
    margin-top: 10px;
    padding: 2px 8px;
    border-radius: 6px;
    color: #ffffff;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }
</style>
