<script lang="ts">
  import { aiStore } from "../stores/aiStore.svelte";

  let { onClose }: { onClose: () => void } = $props();

  let selectedTab = $state<"providers" | "router">("providers");

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function updateProviderKey(providerId: string, key: string) {
    aiStore.updateProvider(providerId, { apiKey: key });
  }

  function updateProviderModel(providerId: string, model: string) {
    aiStore.updateProvider(providerId, { model });
  }

  function updateProviderUrl(providerId: string, url: string) {
    aiStore.updateProvider(providerId, { baseUrl: url });
  }
</script>

<div
  class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
  onclick={handleBackdropClick}
>
  <div
    class="bg-jb-panel border border-jb-border rounded-lg shadow-2xl w-[600px] max-h-[80vh] flex flex-col"
  >
    <!-- Header -->
    <div
      class="flex items-center justify-between px-4 py-3 border-b border-jb-border"
    >
      <h2 class="text-[14px] font-semibold text-jb-text">AI Settings</h2>
      <button
        onclick={onClose}
        class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:text-jb-text hover:bg-jb-hover bg-transparent border-none cursor-pointer"
      >✕</button>
    </div>

    <!-- Tabs -->
    <div class="flex border-b border-jb-border">
      <button
        class="px-4 py-2 text-[12px] font-medium border-b-2 transition-colors {selectedTab ===
        'providers'
          ? 'text-jb-blue border-jb-blue'
          : 'text-jb-muted border-transparent hover:text-jb-text'} bg-transparent cursor-pointer"
        onclick={() => (selectedTab = "providers")}
      >
        Providers
      </button>
      <button
        class="px-4 py-2 text-[12px] font-medium border-b-2 transition-colors {selectedTab ===
        'router'
          ? 'text-jb-blue border-jb-blue'
          : 'text-jb-muted border-transparent hover:text-jb-text'} bg-transparent cursor-pointer"
        onclick={() => (selectedTab = "router")}
      >
        Router Mode
      </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-4">
      {#if selectedTab === "providers"}
        <div class="space-y-4">
          <!-- Provider selector -->
          <div>
            <label class="block text-[11px] font-medium text-jb-muted mb-1.5"
              >Active Provider</label
            >
            <select
              value={aiStore.settings.activeProviderId}
              onchange={(e) =>
                aiStore.setActiveProvider(e.currentTarget.value)}
              class="w-full px-2.5 py-1.5 text-[12px] bg-jb-bg border border-jb-border rounded text-jb-text focus:outline-none focus:border-jb-blue"
            >
              {#each aiStore.settings.providers as provider}
                <option value={provider.id}>{provider.name}</option>
              {/each}
            </select>
          </div>

          <!-- Provider details -->
          {#each aiStore.settings.providers as provider}
            {@const isActive =
              aiStore.settings.activeProviderId === provider.id}
            <div
              class="border rounded-lg p-3 {isActive
                ? 'border-jb-blue bg-jb-blue/5'
                : 'border-jb-border'}"
            >
              <div class="flex items-center gap-2 mb-3">
                <div
                  class="w-2 h-2 rounded-full {isActive
                    ? 'bg-jb-green'
                    : 'bg-jb-muted'}"
                ></div>
                <span class="text-[12px] font-medium text-jb-text"
                  >{provider.name}</span
                >
                {#if isActive}
                  <span
                    class="text-[10px] px-1.5 py-0.5 rounded bg-jb-green/20 text-jb-green"
                    >Active</span
                  >
                {/if}
              </div>

              <div class="space-y-3">
                <!-- API Key -->
                <div>
                  <label
                    class="block text-[10px] font-medium text-jb-muted mb-1"
                    >API Key</label
                  >
                  <input
                    type="password"
                    value={provider.apiKey}
                    oninput={(e) =>
                      updateProviderKey(provider.id, e.currentTarget.value)}
                    placeholder="Enter API key..."
                    class="w-full px-2.5 py-1.5 text-[11px] bg-jb-bg border border-jb-border rounded text-jb-text placeholder:text-jb-muted/50 focus:outline-none focus:border-jb-blue"
                  />
                </div>

                <!-- Model -->
                <div>
                  <label
                    class="block text-[10px] font-medium text-jb-muted mb-1"
                    >Model</label
                  >
                  <input
                    type="text"
                    value={provider.model}
                    oninput={(e) =>
                      updateProviderModel(provider.id, e.currentTarget.value)}
                    placeholder="e.g., gpt-4o, claude-3-opus"
                    class="w-full px-2.5 py-1.5 text-[11px] bg-jb-bg border border-jb-border rounded text-jb-text placeholder:text-jb-muted/50 focus:outline-none focus:border-jb-blue"
                  />
                </div>

                <!-- Base URL (for custom) -->
                {#if provider.id === "custom"}
                  <div>
                    <label
                      class="block text-[10px] font-medium text-jb-muted mb-1"
                      >Base URL</label
                    >
                    <input
                      type="text"
                      value={provider.baseUrl}
                      oninput={(e) =>
                        updateProviderUrl(provider.id, e.currentTarget.value)}
                      placeholder="http://localhost:11434/v1"
                      class="w-full px-2.5 py-1.5 text-[11px] bg-jb-bg border border-jb-border rounded text-jb-text placeholder:text-jb-muted/50 focus:outline-none focus:border-jb-blue"
                    />
                  </div>
                {/if}

                <!-- Features -->
                <div class="flex gap-3 pt-1">
                  {#if provider.supportsVision}
                    <span
                      class="text-[10px] px-1.5 py-0.5 rounded bg-jb-panel2 text-jb-muted flex items-center gap-1"
                    >
                      <svg
                        viewBox="0 0 12 12"
                        width="10"
                        height="10"
                        fill="currentColor"
                      >
                        <path
                          d="M6 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 1.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
                        />
                        <circle cx="6" cy="6" r="1" />
                      </svg>
                      Vision
                    </span>
                  {/if}
                  {#if provider.supportsRouter}
                    <span
                      class="text-[10px] px-1.5 py-0.5 rounded bg-jb-panel2 text-jb-muted flex items-center gap-1"
                    >
                      <svg
                        viewBox="0 0 12 12"
                        width="10"
                        height="10"
                        fill="currentColor"
                      >
                        <path
                          d="M6 1L1 4v4l5 3 5-3V4L6 1zm0 1.5l3.5 2-3.5 2-3.5-2 3.5-2z"
                        />
                      </svg>
                      Router
                    </span>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="space-y-4">
          <div
            class="flex items-center justify-between p-3 bg-jb-panel2 rounded-lg border border-jb-border"
          >
            <div>
              <div class="text-[12px] font-medium text-jb-text">
                Router Mode
              </div>
              <div class="text-[10px] text-jb-muted mt-0.5">
                Let OpenRouter automatically select the best model for your
                request
              </div>
            </div>
            <button
              onclick={() => aiStore.toggleRouterMode()}
              class="relative w-10 h-5 rounded-full transition-colors {aiStore
                .settings.routerMode
                ? 'bg-jb-blue'
                : 'bg-jb-border'} border-none cursor-pointer"
            >
              <div
                class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform {aiStore
                  .settings.routerMode
                  ? 'left-5'
                  : 'left-0.5'}"
              ></div>
            </button>
          </div>

          {#if aiStore.settings.routerMode}
            <div>
              <label class="block text-[11px] font-medium text-jb-muted mb-1.5"
                >Fallback Model</label
              >
              <input
                type="text"
                bind:value={aiStore.settings.routerFallbackModel}
                placeholder="openai/gpt-4o"
                class="w-full px-2.5 py-1.5 text-[12px] bg-jb-bg border border-jb-border rounded text-jb-text placeholder:text-jb-muted/50 focus:outline-none focus:border-jb-blue"
              />
              <p class="text-[10px] text-jb-muted mt-1.5">
                Used when router cannot determine the best model or for
                unsupported features
              </p>
            </div>

            <div
              class="p-3 bg-jb-blue/10 rounded-lg border border-jb-blue/20 text-[11px] text-jb-text leading-relaxed"
            >
              <strong class="text-jb-blue">How Router Mode works:</strong>
              <ul class="mt-1.5 space-y-1 text-jb-muted">
                <li>• Automatically selects optimal model for your request</li>
                <li>• Balances quality, speed, and cost</li>
                <li>• Supports vision, function calling, and more</li>
                <li>• Falls back to specified model if needed</li>
              </ul>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="flex justify-end gap-2 px-4 py-3 border-t border-jb-border">
      <button
        onclick={onClose}
        class="px-3 py-1.5 text-[11px] font-medium text-jb-text bg-jb-panel2 hover:bg-jb-hover rounded border border-jb-border cursor-pointer"
      >
        Close
      </button>
    </div>
  </div>
</div>
