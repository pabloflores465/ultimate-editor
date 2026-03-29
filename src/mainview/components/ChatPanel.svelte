<script lang="ts">
  import { workspaceStore } from "../stores/workspaceStore.svelte";

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

  interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    diffs?: DiffBlock[];
    timestamp: Date;
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

  let messages = $state<ChatMessage[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hi! I can help you edit code. Select code in the editor and ask me to modify it, or describe what you want to build.",
      timestamp: new Date(),
    },
  ]);

  let inputText = $state("");
  let isStreaming = $state(false);
  let messagesEl = $state<HTMLDivElement | null>(null);

  const ws = $derived(workspaceStore.active);

  function formatTime(d: Date): string {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function parseDiffContent(diffText: string): DiffBlock[] {
    const blocks: DiffBlock[] = [];
    const diffRegex = /@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/g;
    let match;
    const lines = diffText.split("\n");
    
    let currentFile = "";
    let currentHunks: DiffHunk[] = [];
    let currentLines: string[] = [];
    let hunkStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith("diff --git") || line.startsWith("--- ")) {
        if (currentFile && currentHunks.length > 0) {
          blocks.push({
            id: crypto.randomUUID(),
            filePath: currentFile,
            hunks: [...currentHunks],
            status: "pending",
          });
        }
        const fileMatch = line.match(/a\/(.+?)\s/);
        currentFile = fileMatch ? fileMatch[1] : "";
        currentHunks = [];
        continue;
      }

      if (line.startsWith("+++ b/")) {
        currentFile = line.slice(6);
        continue;
      }

      const hunkMatch = line.match(diffRegex);
      if (hunkMatch) {
        if (currentLines.length > 0 && currentHunks.length > 0) {
          currentHunks[currentHunks.length - 1].lines = currentLines;
        }
        currentHunks.push({
          oldStart: parseInt(hunkMatch[1]),
          oldLines: parseInt(hunkMatch[2]) || 1,
          newStart: parseInt(hunkMatch[3]),
          newLines: parseInt(hunkMatch[4]) || 1,
          lines: [],
        });
        currentLines = [];
        continue;
      }

      if (currentHunks.length > 0 && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "")) {
        currentLines.push(line);
      }
    }

    if (currentFile && currentHunks.length > 0) {
      if (currentLines.length > 0) {
        currentHunks[currentHunks.length - 1].lines = currentLines;
      }
      blocks.push({
        id: crypto.randomUUID(),
        filePath: currentFile,
        hunks: currentHunks,
        status: "pending",
      });
    }

    return blocks;
  }

  async function sendMessage() {
    if (!inputText.trim() || isStreaming) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: inputText.trim(),
      timestamp: new Date(),
    };

    messages = [...messages, userMessage];
    inputText = "";
    isStreaming = true;

    await new Promise((r) => setTimeout(r, 500));

    const mockDiffs: DiffBlock[] = activeTab
      ? [
          {
            id: crypto.randomUUID(),
            filePath: activeTab.path,
            hunks: [
              {
                oldStart: 1,
                oldLines: 5,
                newStart: 1,
                newLines: 8,
                lines: [
                  " function hello() {",
                  "-  console.log('hi');",
                  "+  // Enhanced greeting function",
                  "+  const greeting = 'Hello, World!';",
                  "+  console.log(greeting);",
                  "+  return greeting;",
                  " }",
                ],
              },
            ],
            status: "pending",
          },
        ]
      : [];

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: activeTab
        ? `I'll help you modify \`${activeTab.name}\`. Here's a suggested change:`
        : "I'd be happy to help! Please open a file first so I can see the context.",
      diffs: mockDiffs,
      timestamp: new Date(),
    };

    messages = [...messages, assistantMessage];
    isStreaming = false;

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
        title="New Chat"
        onclick={() => {
          messages = [{
            id: crypto.randomUUID(),
            role: "assistant",
            content: "Hi! I can help you edit code. Select code in the editor and ask me to modify it, or describe what you want to build.",
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
        <div class="text-[12px] text-jb-text leading-relaxed pl-6">
          {msg.content}
        </div>

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
      </div>
    {/if}
  </div>

  <!-- Input area -->
  <div class="flex-shrink-0 border-t border-jb-border p-2 bg-jb-panel">
    <!-- Quick actions -->
    <div class="flex items-center gap-1 mb-2">
      <button
        onclick={() => inputText = 'Explain this code'}
        class="px-1.5 py-0.5 rounded text-[10px] bg-jb-panel2 text-jb-muted hover:text-jb-text hover:bg-jb-hover border border-jb-border cursor-pointer"
      >Explain</button>
      <button
        onclick={() => inputText = 'Refactor this code'}
        class="px-1.5 py-0.5 rounded text-[10px] bg-jb-panel2 text-jb-muted hover:text-jb-text hover:bg-jb-hover border border-jb-border cursor-pointer"
      >Refactor</button>
      <button
        onclick={() => inputText = 'Add comments'}
        class="px-1.5 py-0.5 rounded text-[10px] bg-jb-panel2 text-jb-muted hover:text-jb-text hover:bg-jb-hover border border-jb-border cursor-pointer"
      >Comment</button>
      <button
        onclick={() => inputText = 'Fix bugs in this code'}
        class="px-1.5 py-0.5 rounded text-[10px] bg-jb-panel2 text-jb-muted hover:text-jb-text hover:bg-jb-hover border border-jb-border cursor-pointer"
      >Fix</button>
    </div>

    <!-- Input -->
    <div class="relative">
      <textarea
        bind:value={inputText}
        onkeydown={handleKeydown}
        placeholder="Ask to edit code..."
        rows="2"
        class="w-full px-2 py-1.5 text-[12px] bg-jb-bg border border-jb-border rounded resize-none text-jb-text placeholder:text-jb-muted focus:outline-none focus:border-jb-blue"
      ></textarea>
      <button
        title="Send message"
        onclick={sendMessage}
        disabled={!inputText.trim() || isStreaming}
        class="absolute right-1.5 bottom-1.5 w-6 h-6 flex items-center justify-center rounded bg-jb-blue text-white border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-jb-blue/80"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 8h10M9 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
</div>

<style>
  @keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
  .animate-pulse {
    animation: pulse 1s ease-in-out infinite;
  }
</style>
