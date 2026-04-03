<script lang="ts">
  interface Props {
    isVisible: boolean;
  }

  let { isVisible }: Props = $props();
</script>

{#if isVisible}
  <div class="fixed inset-0 flex items-center justify-center bg-jb-bg/80 backdrop-blur-sm z-50">
    <div class="flex flex-col items-center gap-4">
      <!-- Spinner -->
      <div class="w-12 h-12 rounded-full border-4 border-jb-border border-t-jb-blue animate-spin" />

      <!-- Text -->
      <div class="flex flex-col items-center gap-1">
        <span class="text-jb-text font-medium text-sm">Loading project</span>
        <span class="text-jb-muted text-xs">Initializing workspace...</span>
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .animate-spin {
    animation: spin 1s linear infinite;
  }
</style>
