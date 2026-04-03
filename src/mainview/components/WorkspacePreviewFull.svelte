<script lang="ts">
  import type { WorkspaceState } from "../stores/workspaceStore.svelte";

  let { ws }: { ws: WorkspaceState } = $props();

  // Generate a consistent color based on workspace id
  function getWorkspaceColor(id: string): string {
    const colors = [
      "#1e3a5f", "#1e3f5f", "#1e455f", "#1e4a5f",
      "#1e5f4a", "#1e5f3f", "#1e5f3a", "#3a5f1e",
      "#3f5f1e", "#4a5f1e", "#455f1e", "#5f4a1e",
      "#5f451e", "#5f3f1e", "#5f3a1e", "#5f1e3a",
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  const bgColor = getWorkspaceColor(ws.id);
</script>

<!-- Full-screen workspace preview — shows during swipe gestures -->
<div class="ws-preview-full" style="background-color: {bgColor};">
  <div class="ws-preview-full__content">
    <span class="ws-preview-full__project">{ws.project?.rootName && ws.project.rootName !== "No folder open" ? ws.project.rootName : ws.name}</span>
    {#if ws.openTabs.length > 0}
      <span class="ws-preview-full__tabs">{ws.openTabs.length} tab{ws.openTabs.length === 1 ? '' : 's'} open</span>
    {/if}
  </div>
</div>

<style>
  .ws-preview-full {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    position: relative;
    overflow: hidden;
    pointer-events: none;
    user-select: none;
  }

  .ws-preview-full__content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
    padding: 24px;
  }

  .ws-preview-full__project {
    font-size: 22px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.95);
    letter-spacing: 0.3px;
  }

  .ws-preview-full__tabs {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
  }
</style>
