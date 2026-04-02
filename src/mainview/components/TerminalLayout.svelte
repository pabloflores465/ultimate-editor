<script lang="ts">
  import type { TilingNode, SplitNode } from "../stores/tilingStore.svelte";

  let {
    node,
    terminalIds,
    tiling,
    onActivate,
    children,
  }: {
    node: TilingNode;
    terminalIds: string[];
    tiling: import("../stores/tilingStore.svelte").TilingStore;
    onActivate: (termId: string) => void;
    children: (termId: string) => import("svelte").Snippet;
  } = $props();

  const DIVIDER_SIZE_PX = 4;

  interface Bounds {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  interface Divider {
    splitId: string;
    x: number;
    y: number;
    w: string;
    h: string;
    isVertical: boolean;
  }

  function computeLayout(
    n: TilingNode,
    bounds: Bounds,
    containerPxW: number,
    containerPxH: number,
    result: Map<string, Bounds>
  ): void {
    if (n.type === "terminal") {
      result.set(n.id, bounds);
    } else {
      const split = n as SplitNode;
      const divPx = DIVIDER_SIZE_PX / containerPxW * 100;
      const verticalOverlapPx = 1 / containerPxW * 100;
      if (split.direction === "vertical") {
        const firstW = bounds.w * split.ratio - divPx / 2;
        computeLayout(split.first, { ...bounds, w: firstW }, containerPxW, containerPxH, result);
        computeLayout(split.second, {
          x: bounds.x + bounds.w * split.ratio + divPx / 2 - verticalOverlapPx,
          y: bounds.y,
          w: bounds.w - bounds.w * split.ratio - divPx / 2 + verticalOverlapPx,
          h: bounds.h
        }, containerPxW, containerPxH, result);
      } else {
        const divPy = DIVIDER_SIZE_PX / containerPxH * 100;
        const firstH = bounds.h * split.ratio - divPy / 2;
        computeLayout(split.first, { ...bounds, h: firstH }, containerPxW, containerPxH, result);
        computeLayout(split.second, {
          x: bounds.x,
          y: bounds.y + bounds.h * split.ratio + divPy / 2,
          w: bounds.w,
          h: bounds.h - bounds.h * split.ratio - divPy / 2
        }, containerPxW, containerPxH, result);
      }
    }
  }

  function computeDividers(
    n: TilingNode,
    bounds: Bounds,
    containerPxW: number,
    containerPxH: number
  ): Divider[] {
    const result: Divider[] = [];
    
    function traverse(node: TilingNode, b: Bounds): void {
      if (node.type === "split") {
        const split = node as SplitNode;
        if (split.direction === "vertical") {
          const divPx = DIVIDER_SIZE_PX / containerPxW * 100;
          result.push({ 
            splitId: split.id, 
            x: b.x + b.w * split.ratio - divPx / 2, 
            y: b.y, 
            w: `${DIVIDER_SIZE_PX}px`, 
            h: "100%", 
            isVertical: true 
          });
          traverse(split.first, { ...b, w: b.w * split.ratio - divPx / 2 });
          traverse(split.second, { 
            x: b.x + b.w * split.ratio + divPx / 2, 
            y: b.y, 
            w: b.w - b.w * split.ratio - divPx / 2, 
            h: b.h 
          });
        } else {
          const divPy = DIVIDER_SIZE_PX / containerPxH * 100;
          result.push({ 
            splitId: split.id, 
            x: b.x, 
            y: b.y + b.h * split.ratio - divPy / 2, 
            w: "100%", 
            h: `${DIVIDER_SIZE_PX}px`, 
            isVertical: false 
          });
          traverse(split.first, { ...b, h: b.h * split.ratio - divPy / 2 });
          traverse(split.second, { 
            x: b.x, 
            y: b.y + b.h * split.ratio + divPy / 2, 
            w: b.w, 
            h: b.h - b.h * split.ratio - divPy / 2 
          });
        }
      }
    }
    
    traverse(n, bounds);
    return result;
  }

  let containerEl = $state<HTMLElement | null>(null);
  let containerSize = $state({ w: 0, h: 0 });

  $effect(() => {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    containerSize = { w: rect.width, h: rect.height };
  });

  const layoutMap = $derived.by(() => {
    const map = new Map<string, Bounds>();
    if (containerSize.w > 0 && containerSize.h > 0) {
      computeLayout(node, { x: 0, y: 0, w: 100, h: 100 }, containerSize.w, containerSize.h, map);
    }
    return map;
  });

  const dividers = $derived.by(() => {
    if (containerSize.w > 0 && containerSize.h > 0) {
      return computeDividers(node, { x: 0, y: 0, w: 100, h: 100 }, containerSize.w, containerSize.h);
    }
    return [];
  });

  let dragging = $state<{ splitId: string; isVertical: boolean } | null>(null);

  function startDrag(e: MouseEvent, div: Divider) {
    e.preventDefault();
    e.stopPropagation();
    dragging = { splitId: div.splitId, isVertical: div.isVertical };
    
    const onMove = (moveEvent: MouseEvent) => {
      if (!dragging || !containerEl) return;
      
      const rect = containerEl.getBoundingClientRect();
      const relX = moveEvent.clientX - rect.left;
      const relY = moveEvent.clientY - rect.top;
      
      let newRatio: number;
      if (dragging.isVertical) {
        newRatio = relX / rect.width;
      } else {
        newRatio = relY / rect.height;
      }
      
      tiling.setRatio(dragging.splitId, newRatio);
    };
    
    const onUp = () => {
      dragging = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
</script>

<div bind:this={containerEl} class="absolute inset-0 overflow-hidden" style="background:#1e1f22">
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
        onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); onActivate(termId); } }}
      >
        {@render children(termId)}
      </div>
    {/if}
  {/each}

  {#each dividers as div}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute bg-jb-border hover:bg-jb-blue transition-colors cursor-default z-10"
      class:cursor-col-resize={div.isVertical}
      class:cursor-row-resize={!div.isVertical}
      style:left="{div.x}%"
      style:top="{div.y}%"
      style:width="{div.w}"
      style:height="{div.h}"

      onmousedown={(e) => startDrag(e, div)}
    ></div>
  {/each}
</div>

<style>
  .terminal-wrapper {
    background: #1e1f22;
    box-sizing: border-box;
    overflow: hidden;
  }
</style>
