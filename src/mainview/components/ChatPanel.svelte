<script lang="ts">
  import { workspaceStore } from "../stores/workspaceStore.svelte";
  import { aiStore, type ChatAttachment, type ChatMessage } from "../stores/aiStore.svelte";
  import AISettingsModal from "./AISettingsModal.svelte";

  interface DiffBlock {
    id: string;
    filePath: string;
    hunks: DiffHunk[];
    status: "pending" | "applied" | "rejected";
  }

  interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }

  interface Message extends ChatMessage {
    diffs?: DiffBlock[];
  }

  let {
    onClose,
    activeTab,
    onApplyDiff,
    onRejectDiff,
  }: {
    onClose: () => void;
    activeTab: { path: string; name: string; content: string } | null;
    onApplyDiff?: (diff: DiffBlock) => void;
    onRejectDiff?: (diff: DiffBlock) => void;
  } = $props();

  let messages = $state<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hi! I can help you edit code. Select code in the editor and ask me to modify it, or describe what you want to build. You can also attach files and images to your messages.",
      timestamp: new Date(),
    },
  ]);

  let inputText = $state("");
  let isStreaming = $state(false);
  let messagesEl = $state<HTMLDivElement | null>(null);
  let currentStreamContent = $state("");
  let attachments = $state<ChatAttachment[]>([]);
  let fileInput = $state<HTMLInputElement | null>(null);
  let imageInput = $state<HTMLInputElement | null>(null);

  const ws = $derived(workspaceStore.active);
  const activeProvider = $derived(aiStore.activeProvider);

  function formatTime(d: Date): string {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function parseDiffContent(content: string): DiffBlock[] {
    const blocks: DiffBlock[] = [];
    const diffRegex = /```diff\n([\s\S]*?)```/g;
    let match;

    while ((match = diffRegex.exec(content)) !== null) {
      const diffText = match[1];
      const fileMatch = diffText.match(/--- a\/(.+)\n\+\+\+ b\/(.+)/);

      if (fileMatch) {
        const filePath = fileMatch[2];
        const lines = diffText.split("\n");
        const hunks: DiffHunk[] = [];
        let currentLines: string[] = [];
        let currentHunk: DiffHunk | null = null;

        for (const line of lines) {
          const hunkMatch = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
          if (hunkMatch) {
            if (currentHunk) {
              currentHunk.lines = currentLines;
              hunks.push(currentHunk);
            }
            currentHunk = {
              oldStart: parseInt(hunkMatch[1]),
              oldLines: parseInt(hunkMatch[2]) || 1,
              newStart: parseInt(hunkMatch[3]),
              newLines: parseInt(hunkMatch[4]) || 1,
              lines: [],
            };
            currentLines = [];
          } else if (currentHunk && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "")) {
            currentLines.push(line);
          }
        }

        if (currentHunk) {
          currentHunk.lines = currentLines;
          hunks.push(currentHunk);
        }

        if (hunks.length > 0) {
          blocks.push({
            id: crypto.randomUUID(),
            filePath,
            hunks,
            status: "pending",
          });
        }
      }
    }

    return blocks;
  }

  async function sendMessage() {
    if ((!inputText.trim() && attachments.length === 0) || isStreaming) return;

    if (!activeProvider?.apiKey) {
      messages = [...messages, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Please configure your AI provider API key in settings. Click the gear icon above to open settings.",
        timestamp: new Date(),
      }];
      return;
    }

    // Add context about active file
    let content = inputText.trim();
    if (activeTab && !content.includes(activeTab.name)) {
      content = `[Current file: ${activeTab.path}]\n\n${content}`;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: inputText.trim(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      timestamp: new Date(),
    };

    messages = [...messages, userMessage];
    inputText = "";
    const currentAttachments = [...attachments];
    attachments = [];
    isStreaming = true;
    currentStreamContent = "";

    // Scroll to bottom
    setTimeout(() => {
      messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
    }, 100);

    try {
      const streamMessages = messages
        .filter(m => m.role !== "system")
        .map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          attachments: m.attachments,
        }));

      for await (const chunk of aiStore.streamChat(streamMessages)) {
        currentStreamContent += chunk;

        // Update streaming message
        messages = messages.map(m =>
          m.id === userMessage.id ? m : m
        );
      }

      // Parse diffs from the response
      const diffs = parseDiffContent(currentStreamContent);

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: currentStreamContent,
        diffs: diffs.length > 0 ? diffs : undefined,
        timestamp: new Date(),
      };

      messages = [...messages, assistantMessage];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      messages = [...messages, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Error: ${errorMessage}. Please check your API key and try again.`,
        timestamp: new Date(),
      }];
    } finally {
      isStreaming = false;
      currentStreamContent = "";
    }

    setTimeout(() => {
      messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
    }, 100);
  }

  function handleApplyDiff(diff: DiffBlock) {
    diff.status = "applied";
    onApplyDiff?.(diff);
    messages = [...messages];
  }

  function handleRejectDiff(diff: DiffBlock) {
    diff.status = "rejected";
    onRejectDiff?.(diff);
    messages = [...messages];
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        const base64 = await aiStore.readFileAsBase64(file);
        attachments = [...attachments, {
          id: crypto.randomUUID(),
          type: "image",
          name: file.name,
          content: base64,
          mimeType: file.type,
        }];
      } else {
        const text = await aiStore.readFileAsText(file);
        attachments = [...attachments, {
          id: crypto.randomUUID(),
          type: "file",
          name: file.name,
          content: text,
          mimeType: file.type,
        }];
      }
    }

    target.value = "";
  }

  function removeAttachment(id: string) {
    attachments = attachments.filter(a => a.id !== id);
  }

  function triggerFileUpload() {
    fileInput?.click();
  }

  function triggerImageUpload() {
    imageInput?.click();
  }

  function openSettings() {
    aiStore.openSettings();
  }

  function handleQuickAction(action: string) {
    inputText = action;
    if (activeTab) {
      inputText += ` for ${activeTab.name}`;
    }
  }
</script>

<div class="flex flex-col h-full select-none">
  <!-- Header -->
  <div class="flex items-center justify-between px-2 h-[30px] bg-jb-panel2 border-b border-jb-border flex-shrink-0">
    <div class="flex items-center gap-1.5">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" class="text-jb-blue">
        <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1z"/>
        <path d="M5 8l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="text-[12px] font-semibold text-jb-text2">AI Assistant</span>
    </div>
    <div class="flex items-center gap-0.5">
      <button
        title="AI Settings"
        onclick={openSettings}
        class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="8" cy="8" r="2"/>
          <path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M3.5 12.5l1.5-1.5M11 5l1.5-1.5"/>
        </svg>
      </button>
      <button
        title="New Chat"
        onclick={() => {
          messages = [{
            id: crypto.randomUUID(),
            role: "assistant",
            content: "Hi! I can help you edit code. Select code in the editor and ask me to modify it, or describe what you want to build. You can also attach files and images to your messages.",
            timestamp: new Date(),
          }];
        }}
        class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
          <path d="M8 2v12M2 8h12"/>
        </svg>
      </button>
      <button
        title="Hide"
        onclick={onClose}
        class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]"
      >✕</button>
    </div>
  </div>

  <!-- Context bar -->
  {#if activeTab}
    <div class="flex items-center gap-1.5 px-2 h-[24px] bg-jb-panel border-b border-jb-border flex-shrink-0 text-[11px]">
      <svg viewBox="0 0 12 12" width="10" height="10" fill="#4e9ede">
        <rect x="0.5" y="1.5" width="11" height="9" rx="1"/>
        <rect x="0.5" y="1.5" width="5" height="3" rx="1" fill="#6aaddc"/>
      </svg>
      <span class="text-jb-muted">Editing:</span>
      <span class="text-jb-text truncate">{activeTab.name}</span>
    </div>
  {/if}

  <!-- Messages -->
  <div bind:this={messagesEl} class="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
    {#each messages as msg (msg.id)}
      <div class="px-3 py-2.5 border-b border-jb-border/50">
        <!-- Message header -->
        <div class="flex items-center gap-1.5 mb-1.5">
          {#if msg.role === "user"}
            <div class="w-5 h-5 rounded-full bg-jb-blue/20 flex items-center justify-center text-[10px] text-jb-blue font-bold">U</div>
          {:else}
            <div class="w-5 h-5 rounded-full bg-jb-green/20 flex items-center justify-center text-[10px] text-jb-green font-bold">AI</div>
          {/if}
          <span class="text-[11px] font-medium text-jb-text">
            {msg.role === "user" ? "You" : "Assistant"}
          </span>
          <span class="text-[10px] text-jb-muted ml-auto">{formatTime(msg.timestamp)}</span>
        </div>

        <!-- Message content -->
        <div class="text-[12px] text-jb-text leading-relaxed pl-6 whitespace-pre-wrap">
          {msg.content}
        </div>

        <!-- Attachments -->
        {#if msg.attachments && msg.attachments.length > 0}
          <div class="mt-2 pl-6 flex flex-wrap gap-1.5">
            {#each msg.attachments as attachment}
              {#if attachment.type === "image"}
                <div class="relative group">
                  <img
                    src={attachment.content}
                    alt={attachment.name}
                    class="h-16 w-auto rounded border border-jb-border object-cover"
                  />
                  <span class="absolute bottom-0 left-0 right-0 text-[8px] bg-black/60 text-white px-1 truncate rounded-b">
                    {attachment.name}
                  </span>
                </div>
              {:else}
                <div class="flex items-center gap-1 px-2 py-1 rounded bg-jb-panel2 border border-jb-border text-[10px] text-jb-text">
                  <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1">
                    <path d="M6 1v10M3 4l3-3 3 3"/>
                  </svg>
                  {attachment.name}
                </div>
              {/if}
            {/each}
          </div>
        {/if}

        <!-- Diffs -->
        {#if msg.diffs && msg.diffs.length > 0}
          <div class="mt-3 pl-6 space-y-2">
            {#each msg.diffs as diff (diff.id)}
              <div class="rounded border border-jb-border overflow-hidden">
                <!-- Diff header -->
                <div class="flex items-center justify-between px-2 py-1 bg-jb-panel2 text-[11px]">
                  <div class="flex items-center gap-1.5">
                    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1">
                      <rect x="1" y="2" width="10" height="8" rx="1"/>
                      <path d="M3 5h6M3 7h4"/>
                    </svg>
                    <span class="text-jb-text font-medium truncate max-w-[180px]">{diff.filePath}</span>
                  </div>
                  {#if diff.status === "pending"}
                    <div class="flex items-center gap-1">
                      <button
                        onclick={() => handleApplyDiff(diff)}
                        class="px-1.5 py-0.5 rounded text-[10px] bg-jb-green/20 text-jb-green hover:bg-jb-green/30 border-none cursor-pointer"
                      >Apply</button>
                      <button
                        onclick={() => handleRejectDiff(diff)}
                        class="px-1.5 py-0.5 rounded text-[10px] bg-jb-red/20 text-jb-red hover:bg-jb-red/30 border-none cursor-pointer"
                      >Reject</button>
                    </div>
                  {:else if diff.status === "applied"}
                    <span class="text-[10px] text-jb-green flex items-center gap-0.5">
                      <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor"><path d="M6 1a5 5 0 1 1 0 10A5 5 0 0 1 6 1zm2.5 3l-3.5 3.5-1.5-1.5-.7.7 2.2 2.2 4.2-4.2z"/></svg>
                      Applied
                    </span>
                  {:else}
                    <span class="text-[10px] text-jb-red flex items-center gap-0.5">
                      <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor"><path d="M6 1a5 5 0 1 1 0 10A5 5 0 0 1 6 1zm2 3.5L7.5 5 9 6.5l-.5.5-1.5-1.5L5.5 7l-.5-.5L6.5 5 5 3.5l.5-.5L7 4.5 8.5 3z"/></svg>
                      Rejected
                    </span>
                  {/if}
                </div>

                <!-- Diff content -->
                <div class="font-mono text-[11px] leading-relaxed overflow-x-auto max-h-[200px] overflow-y-auto">
                  {#each diff.hunks as hunk, hunkIdx}
                    <div class="bg-jb-bg/50">
                      {#each hunk.lines as line, lineIdx}
                        <div
                          class="px-2 py-0.5 whitespace-nowrap
                            {line.startsWith('+') ? 'bg-jb-green/10 text-jb-green' : ''}
                            {line.startsWith('-') ? 'bg-jb-red/10 text-jb-red' : ''}"
                        >
                          <span class="inline-block w-4 text-center text-jb-muted/50 select-none">
                            {hunk.newStart + lineIdx}
                          </span>
                          <span class="ml-1">{line}</span>
                        </div>
                      {/each}
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    <!-- Streaming indicator -->
    {#if isStreaming}
      <div class="px-3 py-2.5">
        <div class="flex items-center gap-1.5">
          <div class="w-5 h-5 rounded-full bg-jb-green/20 flex items-center justify-center text-[10px] text-jb-green font-bold">AI</div>
          <div class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-jb-blue animate-pulse"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-jb-blue animate-pulse" style="animation-delay: 0.2s"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-jb-blue animate-pulse" style="animation-delay: 0.4s"></span>
          </div>
        </div>
        {#if currentStreamContent}
          <div class="mt-2 text-[12px] text-jb-text leading-relaxed pl-6 whitespace-pre-wrap opacity-70">
            {currentStreamContent}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Input area -->
  <div class="flex-shrink-0 border-t border-jb-border px-4 py-4 pb-6 bg-jb-panel">
    <!-- Attachments preview -->
    {#if attachments.length > 0}
      <div class="flex flex-wrap gap-2 mb-2">
        {#each attachments as attachment (attachment.id)}
          {#if attachment.type === "image"}
            <div class="relative group">
              <img
                src={attachment.content}
                alt={attachment.name}
                class="h-12 w-auto rounded border border-jb-border object-cover"
              />
              <button
                onclick={() => removeAttachment(attachment.id)}
                class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-jb-red text-white flex items-center justify-center text-[8px] opacity-0 group-hover:opacity-100 transition-opacity border-none cursor-pointer"
              >✕</button>
            </div>
          {:else}
            <div class="flex items-center gap-1 px-2 py-1 rounded bg-jb-panel2 border border-jb-border text-[10px] text-jb-text">
              <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M6 1v10M3 4l3-3 3 3"/>
              </svg>
              <span class="truncate max-w-[100px]">{attachment.name}</span>
              <button
                onclick={() => removeAttachment(attachment.id)}
                class="ml-1 text-jb-muted hover:text-jb-red bg-transparent border-none cursor-pointer"
              >✕</button>
            </div>
          {/if}
        {/each}
      </div>
    {/if}

    <!-- Quick actions -->
    <div class="flex items-center gap-1 mb-2">
      <button
        onclick={() => handleQuickAction("Explain this code")}
        class="px-1.5 py-0.5 rounded text-[10px] bg-jb-panel2 text-jb-muted hover:text-jb-text hover:bg-jb-hover border border-jb-border cursor-pointer"
      >Explain</button>
      <button
        onclick={() => handleQuickAction("Refactor this code")}
        class="px-1.5 py-0.5 rounded text-[10px] bg-jb-panel2 text-jb-muted hover:text-jb-text hover:bg-jb-hover border border-jb-border cursor-pointer"
      >Refactor</button>
      <button
        onclick={() => handleQuickAction("Add comments")}
        class="px-1.5 py-0.5 rounded text-[10px] bg-jb-panel2 text-jb-muted hover:text-jb-text hover:bg-jb-hover border border-jb-border cursor-pointer"
      >Comment</button>
      <button
        onclick={() => handleQuickAction("Fix bugs in this code")}
        class="px-1.5 py-0.5 rounded text-[10px] bg-jb-panel2 text-jb-muted hover:text-jb-text hover:bg-jb-hover border border-jb-border cursor-pointer"
      >Fix</button>
    </div>

    <!-- Input -->
    <div class="relative mb-2">
      <textarea
        bind:value={inputText}
        onkeydown={handleKeydown}
        placeholder={activeProvider?.apiKey ? "Ask to edit code..." : "Configure API key in settings to start chatting"}
        rows="2"
        class="w-full px-3 py-2 text-[12px] bg-jb-bg border border-jb-border rounded resize-none text-jb-text placeholder:text-jb-muted focus:outline-none focus:border-jb-blue"
      ></textarea>
      <button
        title="Send message"
        onclick={sendMessage}
        disabled={(!inputText.trim() && attachments.length === 0) || isStreaming}
        class="absolute right-2 bottom-4 w-6 h-6 flex items-center justify-center rounded bg-jb-blue text-white border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-jb-blue/80"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 8h10M9 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <!-- Provider selector and attachment buttons -->
    <div class="flex items-center gap-2">
      <!-- Provider dropdown -->
      <select
        value={aiStore.settings.activeProviderId}
        onchange={(e) => aiStore.setActiveProvider(e.currentTarget.value)}
        class="px-2 py-1 text-[10px] bg-jb-bg border border-jb-border rounded text-jb-text focus:outline-none focus:border-jb-blue cursor-pointer"
      >
        {#each aiStore.settings.providers as provider}
          <option value={provider.id}>{provider.name}</option>
        {/each}
      </select>

      {#if activeProvider?.supportsRouter}
        <button
          onclick={() => aiStore.toggleRouterMode()}
          class="px-2 py-1 text-[10px] rounded border cursor-pointer transition-colors {aiStore.settings.routerMode ? 'bg-jb-blue/20 text-jb-blue border-jb-blue/30' : 'bg-jb-panel2 text-jb-muted border-jb-border hover:text-jb-text'}"
          title={aiStore.settings.routerMode ? "Router mode enabled - auto model selection" : "Click to enable router mode"}
        >
          Router
        </button>
      {/if}

      <div class="flex-1"></div>

      <input
        bind:this={fileInput}
        type="file"
        multiple
        onchange={handleFileSelect}
        class="hidden"
      />
      <input
        bind:this={imageInput}
        type="file"
        accept="image/*"
        multiple
        onchange={handleFileSelect}
        class="hidden"
      />
      <button
        onclick={triggerFileUpload}
        disabled={isStreaming}
        title="Attach File"
        class="w-7 h-7 flex items-center justify-center rounded text-jb-muted hover:text-jb-text hover:bg-jb-hover bg-jb-panel2 border border-jb-border cursor-pointer disabled:opacity-40"
      >
        <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M7 1.5v11M2.5 7l4.5-4.5 4.5 4.5"/>
        </svg>
      </button>
      <button
        onclick={triggerImageUpload}
        disabled={isStreaming}
        title="Add Image"
        class="w-7 h-7 flex items-center justify-center rounded text-jb-muted hover:text-jb-text hover:bg-jb-hover bg-jb-panel2 border border-jb-border cursor-pointer disabled:opacity-40"
      >
        <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="1.5" y="2.5" width="11" height="9" rx="1"/>
          <circle cx="7" cy="7" r="2"/>
          <path d="M2 10l3.5-3.5 2 2 3-3"/>
        </svg>
      </button>
    </div>
  </div>
</div>

{#if aiStore.isSettingsOpen}
  <AISettingsModal onClose={() => aiStore.closeSettings()} />
{/if}

<style>
  @keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
  .animate-pulse {
    animation: pulse 1s ease-in-out infinite;
  }
</style>
