<script lang="ts">
  import FileTree from "./FileTree.svelte";
  import { workspaceStore, type FileNode } from "../stores/workspaceStore.svelte";

  let {
    expandedFolders,
    onToggleFolder,
    activeRoute = "/",
    activeTabPath = "",
    onClose,
    onFileOpen,
    onFolderOpen,
    workspaceId,
    projectRootName,
    projectFileNodes,
  }: {
    expandedFolders: Record<string, boolean>;
    onToggleFolder: (key: string) => void;
    activeRoute?: string;
    activeTabPath?: string;
    onClose: () => void;
    onFileOpen?: (path: string, name: string, icon: string, content: string) => void;
    onFolderOpen?: (path: string) => void;
    workspaceId: string;
    projectRootName: string;
    projectFileNodes: FileNode[];
  } = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let isDragOver = $state(false);
  let selectedDirHandle: FileSystemDirectoryHandle | null = null;
  
  // Use fileMap from the workspace's project state
  $effect(() => {
    const ws = workspaceStore.workspaces.find(w => w.id === workspaceId);
    if (ws && !ws.project.fileMap) {
      ws.project.fileMap = new Map<string, File>();
    }
  });

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
    console.log("[buildTree] Building tree for workspace:", workspaceId, "files count:", files.length);
    const folderMap = new Map<string, FileNode[]>();
    folderMap.set("", []);

    const ws = workspaceStore.workspaces.find(w => w.id === workspaceId);
    if (!ws) {
      console.error("[buildTree] Workspace not found:", workspaceId);
      return [];
    }
    if (!ws.project.fileMap) {
      console.log("[buildTree] Creating new fileMap for workspace");
      ws.project.fileMap = new Map<string, File>();
    }
    const fileMap = ws.project.fileMap;
    console.log("[buildTree] fileMap before clear, size:", fileMap.size);
    fileMap.clear();
    console.log("[buildTree] fileMap cleared");

    const sorted = Array.from(files).sort((a, b) =>
      a.webkitRelativePath.localeCompare(b.webkitRelativePath),
    );

    for (const file of sorted) {
      const parts = file.webkitRelativePath.split("/");

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

      const fileName = parts[parts.length - 1];
      const parentPath = parts.slice(1, parts.length - 1).join("/");
      const parentChildren = folderMap.get(parentPath) ?? folderMap.get("")!;

      const filePath = parts.slice(1).join("/");

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

  async function handleFileOpen(path: string) {
    console.log("[handleFileOpen] Opening file:", path, "workspaceId:", workspaceId);
    if (!onFileOpen) {
      console.error("[handleFileOpen] No onFileOpen callback!");
      return;
    }
    const ws = workspaceStore.workspaces.find(w => w.id === workspaceId);
    console.log("[handleFileOpen] Found workspace:", ws?.id, "project:", ws?.project);
    const fileMap = ws?.project?.fileMap;
    console.log("[handleFileOpen] fileMap:", fileMap, "size:", fileMap?.size);
    if (!fileMap) {
      console.error("[handleFileOpen] No fileMap found for workspace", workspaceId);
      return;
    }
    const file = fileMap.get(path);
    console.log("[handleFileOpen] File from map:", file);
    if (!file) {
      console.error("[handleFileOpen] File not found in map:", path);
      console.log("[handleFileOpen] Available paths:", Array.from(fileMap.keys()));
      return;
    }
    try {
      console.log("[handleFileOpen] Reading file content...");
      const content = await file.text();
      console.log("[handleFileOpen] Content length:", content.length);
      const icon = getFileIcon(file.name);
      onFileOpen(path, file.name, icon, content);
    } catch (err) {
      console.error("[handleFileOpen] Failed to read file:", path, err);
    }
  }

  function openFolderDialog() {
    fileInput?.click();
  }

  function handleFolderSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;

    // Set loading state
    workspaceStore.updateActive({ isLoadingProject: true });

    const files = input.files;
    const rootName = files[0].webkitRelativePath.split("/")[0];

    // Use setTimeout to allow UI update and show loading screen
    setTimeout(() => {
      const fileNodes = buildTree(files);

      // Set a temporary root path with the folder name
      const tempPath = `/${rootName}`;

      console.log(`[Sidebar] handleFolderSelect: rootName=${rootName}, fileNodes.length=${fileNodes.length}`);
      workspaceStore.updateProject(workspaceId, { rootName, fileNodes });
      workspaceStore.setRootPath(workspaceId, tempPath);
      workspaceStore.updateActive({ isLoadingProject: false });
      console.log(`[Sidebar] After update: ws.id=${workspaceId}, project set`);

      // Trigger backend to get absolute folder path
      window.dispatchEvent(new CustomEvent('ultimate:folder-selected', { detail: { workspaceId } }));

      input.value = "";
    }, 100);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;

    const items = e.dataTransfer?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        workspaceStore.updateActive({ isLoadingProject: true });
        setTimeout(() => {
          workspaceStore.updateProject(workspaceId, {
            rootName: entry.name,
            fileNodes: []
          });
          workspaceStore.setRootPath(workspaceId, entry.name);
          workspaceStore.updateActive({ isLoadingProject: false });
          onFolderOpen?.(entry.name);
        }, 100);
        break;
      }
    }
  }
</script>

<div class="flex flex-col h-full select-none">

  <!-- ── Header ────────────────────────────────────────────────── -->
  <div class="flex items-center justify-between px-2 h-[30px] bg-jb-panel2 border-b border-jb-border flex-shrink-0">
    <!-- Title -->
    <span class="text-[12px] font-semibold text-jb-text2 truncate flex-1 mr-1" title={projectRootName}>
      {projectRootName}
    </span>

    <!-- Actions -->
    <div class="flex items-center gap-0.5">
      <button
        title="New File"
        class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]"
      >+</button>
      <button
        title="Open Folder"
        onclick={openFolderDialog}
        class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]"
      >📂</button>
      <button
        title="Collapse All"
        class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]"
      >⊟</button>
      <button
        title="Close"
        onclick={onClose}
        class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]"
      >✕</button>
    </div>
  </div>

  <!-- ── Hidden file input ───────────────────────────────────────── -->
  <input
    type="file"
    bind:this={fileInput}
    webkitdirectory
    directory
    multiple
    accept="*"
    class="hidden"
    onchange={handleFolderSelect}
  />

  <!-- ── Project Tree or Empty State ─────────────────────────────── -->
  <div class="flex-1 min-h-0 overflow-hidden relative">
    {#if projectFileNodes.length === 0}
      <!-- Empty state -->
      <div
        class="flex flex-col items-center justify-center h-full gap-4 p-4"
        ondragover={(e) => { e.preventDefault(); isDragOver = true; }}
        ondragleave={() => { isDragOver = false; }}
        ondrop={handleDrop}
      >
        <svg viewBox="0 0 48 48" width="52" height="52" fill="none" stroke="#6b6f72" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="opacity-80">
          <path d="M6 10h12l4 5h20a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3z"/>
        </svg>
        <p class="text-[14px] font-medium text-jb-text2">No project open</p>
        <button
          class="flex items-center gap-2 px-4 py-2 text-[13px] text-jb-text bg-jb-panel border border-jb-border rounded hover:bg-jb-hover hover:border-jb-blue/50 transition-colors"
          onclick={openFolderDialog}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span>Open Folder</span>
        </button>
        <div class="flex items-center gap-2 text-[11px]" style="color:#5a5d5f">
          <kbd class="px-1.5 py-0.5 bg-jb-panel2 border border-jb-border rounded text-[10px]">Ctrl</kbd>
          +
          <kbd class="px-1.5 py-0.5 bg-jb-panel2 border border-jb-border rounded text-[10px]">Shift</kbd>
          +
          <kbd class="px-1.5 py-0.5 bg-jb-panel2 border border-jb-border rounded text-[10px]">O</kbd>
        </div>
      </div>
    {:else}
      <!-- File tree -->
      <div class="h-full overflow-y-auto overflow-x-hidden">
        <div class="py-1">
          <FileTree
            nodes={projectFileNodes}
            expandedFolders={expandedFolders}
            onToggleFolder={onToggleFolder}
            onFileOpen={handleFileOpen}
            activeTabPath={activeTabPath}
          />
        </div>
      </div>
    {/if}

    <!-- Drag overlay -->
    {#if isDragOver}
      <div
        class="absolute inset-0 bg-jb-blue/10 border-2 border-dashed border-jb-blue rounded flex items-center justify-center pointer-events-none"
        ondragover={(e) => { e.preventDefault(); isDragOver = true; }}
        ondragleave={() => { isDragOver = false; }}
        ondrop={handleDrop}
      >
        <span class="text-jb-blue text-[12px] font-medium">Drop folder here</span>
      </div>
    {/if}
  </div>

</div>
