<script lang="ts">
  import FileTree from "./FileTree.svelte";

  interface FileNode {
    name: string;
    type: "file" | "folder";
    key?: string;
    icon?: string;
    route?: string | null;
    path?: string;           // relative path for non-route files
    children?: FileNode[];
  }

  let {
    nodes,
    depth = 0,
    expandedFolders,
    onToggleFolder,
    activeRoute = "/",
    activeTabPath = "",
    onFileOpen,
  }: {
    nodes: FileNode[];
    depth?: number;
    expandedFolders: Record<string, boolean>;
    onToggleFolder: (key: string) => void;
    activeRoute?: string;
    activeTabPath?: string;
    onFileOpen?: (path: string) => void;
  } = $props();

  function fileColor(icon: string) {
    const map: Record<string,string> = {
      svelte: "#ff6b6b", ts: "#4e9ede", js: "#ffc66d",
      css: "#9876aa", json: "#aed9b8",
    };
    return map[icon] ?? "#a9b7c6";
  }
  function fileLabel(icon: string) {
    const map: Record<string,string> = {
      svelte: "S", ts: "TS", js: "JS", css: "CSS", json: "{}",
    };
    return map[icon] ?? "•";
  }
</script>

{#each nodes as node}
  {#if node.type === "folder"}
    <div
      class="flex items-center h-[22px] cursor-pointer text-jb-text text-[13px] whitespace-nowrap overflow-hidden hover:bg-jb-hover select-none"
      style="padding-left: {depth * 14 + 6}px; gap: 4px;"
      role="button"
      tabindex="0"
      onclick={() => node.key && onToggleFolder(node.key)}
      onkeydown={(e) => e.key === "Enter" && node.key && onToggleFolder(node.key)}
    >
      <!-- Chevron -->
      <span
        class="inline-block text-jb-muted flex-shrink-0 transition-transform duration-100 text-[11px] leading-none w-3 text-center"
        style="transform: rotate({node.key && expandedFolders[node.key] ? 90 : 0}deg)"
      >▶</span>
      <!-- Folder icon (open/closed) -->
      <svg viewBox="0 0 16 16" width="14" height="14" class="flex-shrink-0">
        {#if node.key && expandedFolders[node.key]}
          <path d="M1.5 4.5h13v9h-13z" fill="#4e9ede" opacity="0.8"/>
          <path d="M1.5 4.5l2-2.5h4l1 2.5H1.5z" fill="#6aaddc"/>
          <rect x="1.5" y="4.5" width="13" height="0.5" fill="#6aaddc"/>
        {:else}
          <path d="M1.5 3h4l1.5 2h7v8h-12.5z" fill="#4e9ede" opacity="0.7"/>
        {/if}
      </svg>
      <span class="flex-1 overflow-hidden text-ellipsis">{node.name}</span>
    </div>

    {#if node.key && expandedFolders[node.key] && node.children}
      <FileTree
        nodes={node.children}
        depth={depth + 1}
        {expandedFolders}
        {onToggleFolder}
        {activeRoute}
        {activeTabPath}
        {onFileOpen}
      />
    {/if}

  {:else}
    {#if node.route}
      <!-- Route-based file (svelte pages) -->
      <a
        href="#{node.route}"
        class="flex items-center h-[22px] cursor-pointer text-jb-text text-[13px] whitespace-nowrap overflow-hidden no-underline hover:bg-jb-hover"
        class:bg-jb-select={activeRoute === node.route}
        class:text-jb-text2={activeRoute === node.route}
        style="padding-left: {depth * 14 + 22}px; gap: 4px;"
      >
        <span
          class="font-mono font-black text-[8px] w-4 text-center flex-shrink-0 leading-none"
          style="color: {fileColor(node.icon ?? '')}"
        >{fileLabel(node.icon ?? '')}</span>
        <span class="flex-1 overflow-hidden text-ellipsis">{node.name}</span>
      </a>
    {:else if node.path && onFileOpen}
      <!-- Clickable file → opens in editor -->
      <div
        role="button"
        tabindex="0"
        class="flex items-center h-[22px] cursor-pointer text-jb-text text-[13px] whitespace-nowrap overflow-hidden hover:bg-jb-hover select-none"
        class:bg-jb-select={activeTabPath === node.path}
        class:text-jb-text2={activeTabPath === node.path}
        style="padding-left: {depth * 14 + 22}px; gap: 4px;"
        onclick={() => onFileOpen!(node.path!)}
        onkeydown={(e) => e.key === "Enter" && onFileOpen!(node.path!)}
      >
        <span
          class="font-mono font-black text-[8px] w-4 text-center flex-shrink-0 leading-none"
          style="color: {fileColor(node.icon ?? '')}"
        >{fileLabel(node.icon ?? '')}</span>
        <span class="flex-1 overflow-hidden text-ellipsis">{node.name}</span>
      </div>
    {:else}
      <!-- Non-interactive file (no path/callback) -->
      <div
        class="flex items-center h-[22px] cursor-default text-jb-muted text-[13px] whitespace-nowrap overflow-hidden hover:bg-jb-hover/50"
        style="padding-left: {depth * 14 + 22}px; gap: 4px;"
      >
        <span
          class="font-mono font-black text-[8px] w-4 text-center flex-shrink-0 leading-none opacity-60"
          style="color: {fileColor(node.icon ?? '')}"
        >{fileLabel(node.icon ?? '')}</span>
        <span class="flex-1 overflow-hidden text-ellipsis">{node.name}</span>
      </div>
    {/if}
  {/if}
{/each}
