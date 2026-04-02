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
  const fileMap = new Map<string, File>();
  let selectedDirHandle: FileSystemDirectoryHandle | null = null;

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
    const folderMap = new Map<string, FileNode[]>();
    folderMap.set("", []);

    fileMap.clear();

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

  function openFolderDialog() {
    fileInput?.click();
  }

  function handleFolderSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files?.length) return;

    const files = input.files;
    const rootName = files[0].webkitRelativePath.split("/")[0];
    const fileNodes = buildTree(files);
    
    workspaceStore.updateProject(workspaceId, { rootName, fileNodes });

    const firstFile = files[0] as File & { path?: string };
    // Since File API doesn't expose absolute paths, we pass the folder name
    // and let the backend resolve it via git operations
    const folderPath = rootName;
    
    workspaceStore.setRootPath(workspaceId, folderPath);
    onFolderOpen?.(folderPath);

    input.value = "";
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;

    const items = e.dataTransfer?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        workspaceStore.updateProject(workspaceId, { 
          rootName: entry.name, 
          fileNodes: [] 
        });
        workspaceStore.setRootPath(workspaceId, entry.name);
        onFolderOpen?.(entry.name);
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
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" class="text-jb-muted opacity-40">
          <path d="M3 7v13a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
        </svg>
        <div class="flex flex-col items-center gap-2">
          <span class="text-[12px] text-jb-muted">No project open</span>
          <button
            onclick={openFolderDialog}
            class="px-3 py-1.5 text-[11px] bg-jb-panel2 border border-jb-border rounded hover:bg-jb-hover text-jb-text cursor-pointer transition-colors"
          >
            Open Folder
          </button>
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
            onFileClick={handleFileOpen}
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
