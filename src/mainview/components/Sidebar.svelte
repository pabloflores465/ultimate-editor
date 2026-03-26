<script lang="ts">
  import FileTree from "./FileTree.svelte";

  // ── Types ────────────────────────────────────────────────────
  interface FileNode {
    name: string;
    type: "file" | "folder";
    key?: string;
    icon?: string;
    route?: string | null;
    children?: FileNode[];
  }

  // ── Props ────────────────────────────────────────────────────
  let {
    expandedFolders,
    onToggleFolder,
    activeRoute = "/",
    activeTabPath = "",
    onClose,
    onFileOpen,
    onProjectChange,
  }: {
    expandedFolders: Record<string, boolean>;
    onToggleFolder: (key: string) => void;
    activeRoute?: string;
    activeTabPath?: string;
    onClose: () => void;
    onFileOpen?: (path: string, name: string, icon: string, content: string) => void;
    onProjectChange?: (hasProject: boolean) => void;
  } = $props();

  // ── Internal state ───────────────────────────────────────────
  let rootName = $state("No folder open");
  let fileNodes = $state<FileNode[]>([]);
  let fileInput = $state<HTMLInputElement | null>(null);
  let isDragOver = $state(false);
  // Map: relative path (without root dir) → File object
  const fileMap = new Map<string, File>();

  // ── Helpers ──────────────────────────────────────────────────
  function getFileIcon(name: string): string {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = {
      svelte: "svelte",
      ts: "ts",
      tsx: "ts",
      js: "js",
      jsx: "js",
      mjs: "js",
      cjs: "js",
      css: "css",
      scss: "css",
      json: "json",
      jsonc: "json",
    };
    return map[ext] ?? "file";
  }

  function buildTree(files: FileList): FileNode[] {
    // Map from folder-path (relative to root, no leading slash) → children array
    const folderMap = new Map<string, FileNode[]>();
    folderMap.set("", []); // root level

    // Clear existing file map
    fileMap.clear();

    const sorted = Array.from(files).sort((a, b) =>
      a.webkitRelativePath.localeCompare(b.webkitRelativePath),
    );

    for (const file of sorted) {
      const parts = file.webkitRelativePath.split("/");
      // parts[0] is the root directory name — skip it

      // Ensure every ancestor folder node exists
      for (let i = 1; i < parts.length - 1; i++) {
        const folderPath = parts.slice(1, i + 1).join("/");
        const parentPath = parts.slice(1, i).join("/");

        if (!folderMap.has(folderPath)) {
          const children: FileNode[] = [];
          folderMap.set(folderPath, children);

          const folderNode: FileNode = {
            name: parts[i],
            type: "folder",
            key: folderPath,
            children,
          };
          folderMap.get(parentPath)!.push(folderNode);
        }
      }

      // Add the file itself
      const fileName = parts[parts.length - 1];
      const parentPath = parts.slice(1, parts.length - 1).join("/");
      const parentChildren = folderMap.get(parentPath) ?? folderMap.get("")!;

      // Relative path without the root folder name
      const filePath = parts.slice(1).join("/");

      // Register in file map
      fileMap.set(filePath, file);

      parentChildren.push({
        name: fileName,
        type: "file",
        icon: getFileIcon(fileName),
        route: null,
        path: filePath,
      });
    }

    return folderMap.get("")!;
  }

  // ── Open file in editor ─────────────────────────────────────
  async function handleFileOpen(path: string) {
    if (!onFileOpen) return;
    const file = fileMap.get(path);
    if (!file) return;
    try {
      const content = await file.text();
      const icon = getFileIcon(file.name);
      onFileOpen(path, file.name, icon, content);
    } catch (err) {
      console.error("Failed to read file:", path, err);
    }
  }

  // ── Event handlers ───────────────────────────────────────────
  function openFolderDialog() {
    fileInput?.click();
  }

  function handleFolderSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;

    const files = input.files;
    rootName = files[0].webkitRelativePath.split("/")[0];
    fileNodes = buildTree(files);
    onProjectChange?.(true);

    // Reset the input so the same folder can be re-opened
    input.value = "";
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;

    const items = e.dataTransfer?.items;
    if (!items) return;

    // Try to get a DataTransferItemList with webkitGetAsEntry
    for (const item of Array.from(items)) {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        // Fallback: we can't read file contents without requestFileSystem in a webview,
        // so just show the folder name and inform user to use the button for full tree.
        rootName = entry.name;
        fileNodes = [];
        break;
      }
    }
  }
</script>

<div class="flex flex-col h-full select-none">

  <!-- ── Header ────────────────────────────────────────────────── -->
  <div class="flex items-center justify-between px-2 h-[30px] bg-jb-panel2 border-b border-jb-border flex-shrink-0">
    <!-- Title -->
    <span class="text-[12px] font-semibold text-jb-text2 truncate flex-1 mr-1" title={rootName}>
      {rootName}
    </span>

    <!-- Actions -->
    <div class="flex items-center gap-0.5 flex-shrink-0">
      <!-- Open folder button -->
      <button
        title="Open Folder…"
        onclick={openFolderDialog}
        class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="M2 4.5h4.5l1.5 2H14v7H2z" stroke-linejoin="round"/>
          <path d="M2 4.5V3a1 1 0 0 1 1-1h2.5l1.5 1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <!-- Expand All (placeholder) -->
      <button
        title="Expand All"
        class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]"
      >⊞</button>

      <!-- Collapse All (placeholder) -->
      <button
        title="Collapse All"
        class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]"
      >⊟</button>

      <!-- Close panel -->
      <button
        title="Hide"
        onclick={onClose}
        class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]"
      >✕</button>
    </div>
  </div>

  <!-- ── Body ──────────────────────────────────────────────────── -->
  <div
    class="flex-1 overflow-y-auto overflow-x-hidden min-h-0 py-1 relative transition-colors duration-150
      {isDragOver ? 'bg-jb-hover/30 outline outline-1 outline-jb-blue outline-offset-[-2px]' : ''}"
    ondragover={(e) => { e.preventDefault(); isDragOver = true; }}
    ondragleave={() => { isDragOver = false; }}
    ondrop={handleDrop}
    role="region"
    aria-label="File explorer"
  >
    {#if fileNodes.length === 0}
      <!-- Empty state -->
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-jb-muted pointer-events-none">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="opacity-40">
          <path d="M3 7h5l2 3h11v10H3z"/>
        </svg>
        <p class="text-[12px] opacity-60">No folder open</p>
        <button
          onclick={openFolderDialog}
          class="pointer-events-auto px-3 py-1.5 text-[11px] bg-jb-panel2 border border-jb-border rounded hover:bg-jb-hover text-jb-text cursor-pointer transition-colors"
        >
          Open Folder…
        </button>
        <p class="text-[10px] opacity-40 mt-1">or drop a folder here</p>
      </div>
    {:else}
      <!-- Root label -->
      <div class="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-jb-hover">
        <svg viewBox="0 0 12 12" width="12" height="12" fill="#4e9ede" opacity="0.7" class="flex-shrink-0">
          <rect x="0.5" y="1.5" width="11" height="9" rx="1"/>
          <rect x="0.5" y="1.5" width="5" height="3" rx="1" fill="#6aaddc"/>
        </svg>
        <span class="text-[12px] font-semibold text-jb-text truncate flex-1">{rootName}</span>
        <!-- Re-open button inline -->
        <button
          title="Change folder…"
          onclick={openFolderDialog}
          class="opacity-0 hover:!opacity-100 group-hover:opacity-60 w-4 h-4 flex items-center justify-center rounded text-jb-muted hover:text-jb-text bg-transparent border-none cursor-pointer flex-shrink-0 text-[10px]"
        >⟳</button>
      </div>

      <!-- File tree -->
      <FileTree
        nodes={fileNodes}
        {expandedFolders}
        {onToggleFolder}
        {activeRoute}
        {activeTabPath}
        onFileOpen={handleFileOpen}
      />
    {/if}
  </div>

  <!-- Hidden file input for folder picker -->
  <input
    bind:this={fileInput}
    type="file"
    webkitdirectory
    multiple
    class="hidden"
    onchange={handleFolderSelect}
    aria-hidden="true"
    tabindex="-1"
  />
</div>
