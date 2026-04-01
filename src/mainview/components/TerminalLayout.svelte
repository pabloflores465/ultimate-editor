<script lang="ts">
  import type { TilingNode, SplitNode } from "../stores/tilingStore.svelte";

  let {
    node,
    terminalIds,
    onActivate,
    children,
  }: {
    node: TilingNode;
    terminalIds: string[];
    onActivate: (termId: string) => void;
    children: (termId: string) => import("svelte").Snippet;
  } = $props();

  interface Bounds {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  function computeLayout(
    n: TilingNode,
    bounds: Bounds,
    result: Map<string, Bounds>
  ): void {
    if (n.type === "terminal") {
      result.set(n.id, bounds);
    } else {
      const split = n as SplitNode;
      if (split.direction === "vertical") {
        const firstW = bounds.w * split.ratio;
        computeLayout(split.first, { ...bounds, w: firstW }, result);
        computeLayout(split.second, { x: bounds.x + firstW, y: bounds.y, w: bounds.w - firstW, h: bounds.h }, result);
      } else {
        const firstH = bounds.h * split.ratio;
        computeLayout(split.first, { ...bounds, h: firstH }, result);
        computeLayout(split.second, { x: bounds.x, y: bounds.y + firstH, w: bounds.w, h: bounds.h - firstH }, result);
      }
    }
  }

  function computeDividers(
    n: TilingNode,
    bounds: Bounds
  ): { x: number; y: number; w: number; h: number }[] {
    const result: { x: number; y: number; w: number; h: number }[] = [];
    
    function traverse(node: TilingNode, b: Bounds): void {
      if (node.type === "split") {
        const split = node as SplitNode;
        if (split.direction === "vertical") {
          const firstW = b.w * split.ratio;
          result.push({ x: b.x + firstW, y: b.y, w: 3, h: b.h });
          traverse(split.first, { ...b, w: firstW });
          traverse(split.second, { x: b.x + firstW, y: b.y, w: b.w - firstW, h: b.h });
        } else {
          const firstH = b.h * split.ratio;
          result.push({ x: b.x, y: b.y + firstH, w: b.w, h: 3 });
          traverse(split.first, { ...b, h: firstH });
          traverse(split.second, { x: b.x, y: b.y + firstH, w: b.w, h: b.h - firstH });
        }
      }
    }
    
    traverse(n, bounds);
    return result;
  }

  const layoutMap = $derived.by(() => {
    const map = new Map<string, Bounds>();
    computeLayout(node, { x: 0, y: 0, w: 100, h: 100 }, map);
    return map;
  });

  const dividers = $derived(computeDividers(node, { x: 0, y: 0, w: 100, h: 100 }));
</script>

{#each terminalIds as termId (termId)}
  {@const bounds = layoutMap.get(termId)}
  {#if bounds}
    <div
      class="terminal-wrapper absolute"
      style:left="{bounds.x}%"
      style:top="{bounds.y}%"
      style:width="{bounds.w}%"
      style:height="{bounds.h}%"
      role="button"
      tabindex="-1"
      onclick={() => onActivate(termId)}
      onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(termId); } }}
    >
      {@render children(termId)}
    </div>
  {/if}
{/each}

{#each dividers as div, i}
  <div
    class="absolute bg-jb-border hover:bg-jb-blue transition-colors"
    style:left="{div.x}%"
    style:top="{div.y}%"
    style:width="{div.w}%"
    style:height="{div.h}%"
  ></div>
{/each}

<style>
  .terminal-wrapper {
    background: #1e1f22;
    box-sizing: border-box;
  }
</style>
