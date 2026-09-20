<script lang="ts">
  import { ICONS, type IconName } from "./icons.ts";

  let { name, size = 18 }: { name: IconName; size?: number } = $props();
  const nodes = $derived(ICONS[name]);
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each nodes as node, index (index)}
    {#if node.tag === "path"}
      <path d={node.d} />
    {:else if node.tag === "rect"}
      <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={node.rx} />
    {:else if node.tag === "circle"}
      <circle cx={node.cx} cy={node.cy} r={node.r} />
    {:else}
      <line x1={node.x1} y1={node.y1} x2={node.x2} y2={node.y2} />
    {/if}
  {/each}
</svg>
