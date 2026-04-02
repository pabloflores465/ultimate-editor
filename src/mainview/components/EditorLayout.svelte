<script lang="ts">
  import { onMount } from "svelte";
  import FileTree from "./FileTree.svelte";
  import Sidebar from "./Sidebar.svelte";
  import Terminal from "./Terminal.svelte";
  import CodeEditor from "./CodeEditor.svelte";
  import ChatPanel from "./ChatPanel.svelte";
  import type { WorkspaceState } from "../stores/workspaceStore.svelte";
  import { workspaceStore } from "../stores/workspaceStore.svelte";
  import { Electroview } from "electrobun/view";

  // ── Git state ────────────────────────────────────────────────
  interface GitChange {
    path: string;
    index: string;
    workingTree: string;
    status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  }
  interface GitCommit {
    hash: string;
    date: string;
    message: string;
    author_name: string;
    author_email: string;
  }
  let gitIsRepo = $state(false);
  let gitBranch = $state("");
  let gitChanges = $state<GitChange[]>([]);
  let gitDiffs = $state<Map<string, string>>(new Map());
  let gitCommits = $state<GitCommit[]>([]);
  let gitLoading = $state(false);
  let gitCurrentPath = $state("");

  function gitOpenRepo(path: string) {
    if (path === gitCurrentPath) return;
    gitCurrentPath = path;
    gitLoading = true;
    termRpc.send["git:open"]({ path });
  }
  function gitRefresh() {
    if (!gitCurrentPath) return;
    gitLoading = true;
    termRpc.send["git:status"]({ path: gitCurrentPath });
  }
  function gitGetDiff(filePath: string) {
    if (!gitCurrentPath) return;
    if (!gitDiffs.has(filePath)) {
      termRpc.send["git:diff"]({ path: gitCurrentPath, filePath });
    }
  }
  function gitStatusColor(status: GitChange["status"]): string {
    switch (status) {
      case "modified": return "#e2c08d";
      case "added": return "#629755";
      case "deleted": return "#f14c4c";
      case "renamed": return "#4e9ede";
      case "untracked": return "#9876aa";
      default: return "#a9b7c6";
    }
  }
  function gitStatusLetter(status: GitChange["status"]): string {
    switch (status) {
      case "modified": return "M";
      case "added": return "A";
      case "deleted": return "D";
      case "renamed": return "R";
      case "untracked": return "U";
      default: return "?";
    }
  }

  // ── Props ─────────────────────────────────────────────────────
  let {
    children,
    ws,
    onUpdate,
    onOpenOverview,
  }: {
    children: import("svelte").Snippet;
    ws: WorkspaceState;
    onUpdate: (patch: Partial<WorkspaceState>) => void;
    onOpenOverview: () => void;
  } = $props();

  // ── Transient UI state (not persisted per workspace) ─────────
  let resizingLeft   = $state(false);
  let resizingRight  = $state(false);
  let resizingBottom = $state(false);
  let runConfigOpen  = $state(false);
  let runEditOpen    = $state(false);
  let runOutput      = $state<string[]>([]);
  let newConfig      = $state("");
  let hamburgerOpen  = $state(false);
  let toolbarOpen    = $state(true);
  let selectedDiffFile = $state<string | null>(null);
  // mode is stored globally so WorkspaceTabBar can also toggle it
  const mode = $derived(workspaceStore.mode);

  // ── Menu dropdown state ─────────────────────────────────────
  type MenuId = "File" | "Edit" | "View" | "Navigate" | "Code" | "Refactor" | "Build" | "Run" | "Tools" | "Git" | "Window" | "Help" | null;
  let activeMenu = $state<MenuId>(null);

  const menuItems: Record<MenuId, { label: string; shortcut?: string }[]> = {
    File: [
      { label: "New File", shortcut: "⌘N" },
      { label: "Open File…", shortcut: "⌘O" },
      { label: "Open Folder…", shortcut: "⌘⇧O" },
      { label: "Save", shortcut: "⌘S" },
      { label: "Save As…", shortcut: "⌘⇧S" },
    ],
    Edit: [
      { label: "Undo", shortcut: "⌘Z" },
      { label: "Redo", shortcut: "⌘⇧Z" },
      { label: "Cut", shortcut: "⌘X" },
      { label: "Copy", shortcut: "⌘C" },
      { label: "Paste", shortcut: "⌘V" },
    ],
    View: [
      { label: "Toggle Sidebar", shortcut: "⌘B" },
      { label: "Toggle Bottom Panel", shortcut: "⌘J" },
      { label: "Toggle Full Screen", shortcut: "⌃⌘F" },
    ],
    Navigate: [
      { label: "Go to File…", shortcut: "⌘⇧N" },
      { label: "Go to Symbol…", shortcut: "⌘⌥O" },
      { label: "Recent Files", shortcut: "⌘E" },
    ],
    Code: [
      { label: "Format Document", shortcut: "⌘⇧I" },
      { label: "Organize Imports", shortcut: "⌘⇧O" },
    ],
    Refactor: [
      { label: "Rename", shortcut: "⌘F6" },
      { label: "Extract to Method" },
    ],
    Build: [
      { label: "Build Project", shortcut: "⌘F9" },
      { label: "Rebuild Project" },
    ],
    Run: [
      { label: "Run", shortcut: "⌘R" },
      { label: "Debug", shortcut: "⌘D" },
      { label: "Stop", shortcut: "⌘F2" },
    ],
    Tools: [
      { label: "Command Palette…", shortcut: "⌘⇧P" },
      { label: "Terminal", shortcut: "⌥F12" },
    ],
    Git: [
      { label: "Commit…", shortcut: "⌘K" },
      { label: "Push…", shortcut: "⌘⇧K" },
      { label: "Pull…" },
    ],
    Window: [
      { label: "Close Tab", shortcut: "⌘W" },
      { label: "Split Right" },
      { label: "Split Down" },
    ],
    Help: [
      { label: "Documentation", shortcut: "⌘/" },
      { label: "About" },
    ],
  };

  function openMenu(menu: MenuId) {
    activeMenu = activeMenu === menu ? null : menu;
  }

  function closeMenu() {
    activeMenu = null;
  }

  function handleMenuItemClick(item: string) {
    console.log(`Menu item clicked: ${item}`);
    closeMenu();
  }

  // ── Agent mode state ──────────────────────────────────────────
  interface AgentMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
  }
  let agentMessages = $state<AgentMessage[]>([]);
  let agentInput    = $state("");
  let agentStreaming = $state(false);
  let agentEl       = $state<HTMLDivElement | null>(null);

  async function agentSend() {
    if (!agentInput.trim() || agentStreaming) return;
    const userMsg: AgentMessage = { id: crypto.randomUUID(), role: "user", content: agentInput.trim(), timestamp: new Date() };
    agentMessages = [...agentMessages, userMsg];
    agentInput = "";
    agentStreaming = true;
    await new Promise(r => setTimeout(r, 800));
    agentMessages = [...agentMessages, {
      id: crypto.randomUUID(), role: "assistant",
      content: "I'm the agent view — connect me to your AI backend to get real responses.",
      timestamp: new Date(),
    }];
    agentStreaming = false;
    setTimeout(() => agentEl?.scrollTo({ top: agentEl.scrollHeight, behavior: "smooth" }), 50);
  }

  function agentKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); agentSend(); }
  }

  let hasProject = $derived(ws.project.fileNodes.length > 0);

  // ── Git integration ─────────────────────────────────────────
  $effect(() => {
    if (ws.project.rootPath) {
      gitOpenRepo(ws.project.rootPath);
    }
  });

  $effect(() => {
    if (ws.activeTool === "git" && gitIsRepo) {
      gitRefresh();
    }
  });

  // (file tree is now managed by Sidebar.svelte)

  // ── Editor icon colors ────────────────────────────────────────
  function iconColor(icon: string) {
    return ({ svelte:"#ff6b6b", ts:"#4e9ede", tsx:"#4e9ede", js:"#ffc66d", jsx:"#ffc66d", css:"#9876aa", scss:"#9876aa", json:"#aed9b8", html:"#cc7832", md:"#a9b7c6" } as Record<string,string>)[icon] ?? "#a9b7c6";
  }

  // ── Time formatting ──────────────────────────────────────────
  function formatTimeAgo(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return diffDay === 1 ? "1 day ago" : `${diffDay} days ago`;
    if (diffHour > 0) return diffHour === 1 ? "1 hour ago" : `${diffHour} hours ago`;
    if (diffMin > 0) return diffMin === 1 ? "1 minute ago" : `${diffMin} minutes ago`;
    return "just now";
  }

  // ── Active editor tab (from store) ───────────────────────────
  let activeTab = $derived(
    ws.openTabs.find(t => t.id === ws.activeTabId) ?? null
  );

  // ── Save current file ────────────────────────────────────────
  function saveCurrentFile() {
    if (ws.activeTabId) {
      workspaceStore.saveTab(ws.activeTabId);
    }
  }

  // Keyboard shortcut: Ctrl/Cmd+S
  onMount(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveCurrentFile();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  // ── Left tool strip ───────────────────────────────────────
  const leftTools = [
    { id:"project",   num:"1", label:"Project" },
    { id:"structure", num:"2", label:"Structure" },
    { id:"git",       num:"3", label:"Git" },
    { id:"bookmarks", num:"4", label:"Bookmarks" },
    { id:"database",  num:"8", label:"Database" },
  ];

  function toggleTool(id: string) {
    if (ws.activeTool === id && ws.leftPanelOpen) onUpdate({ leftPanelOpen: false });
    else onUpdate({ activeTool: id, leftPanelOpen: true });
  }

  // ── Bottom panel tabs ─────────────────────────────────────
  const bottomTabs = [
    { id:"terminal",  label:"Terminal",  icon:"⌨" },
    { id:"problems",  label:"Problems",  icon:"⚠", badge: 0 },
    { id:"git",       label:"Git",       icon:"⎇" },
    { id:"run",       label:"Run",       icon:"▶" },
    { id:"services",  label:"Services",  icon:"⚙" },
  ];

  function toggleBottom(id: string) {
    if (ws.activeBottom === id && ws.bottomPanelOpen) onUpdate({ bottomPanelOpen: false });
    else onUpdate({ activeBottom: id, bottomPanelOpen: true });
  }

  // ── Run config ────────────────────────────────────────────
  let runConfigs = $state(["bun run dev", "bun run build", "bun run hmr"]);

  // ── Window width tracking ─────────────────────────────
  let windowWidth  = $state(window.innerWidth);
  let navOverflows = $state(false);
  let navEl        = $state<HTMLElement | null>(null);
  let navWrapEl    = $state<HTMLElement | null>(null);

  // Re-observe whenever the bound elements change (e.g. after hamburger toggle)
  $effect(() => {
    if (!navWrapEl) return;
    const ro = new ResizeObserver(() => {
      if (navEl && navWrapEl) {
        navOverflows = navEl.scrollWidth > navWrapEl.clientWidth;
      }
    });
    ro.observe(navWrapEl);
    if (navEl) ro.observe(navEl);
    return () => ro.disconnect();
  });

  // ── Resize ───────────────────────────────────────────────
  onMount(() => {
    const onResize = () => { windowWidth = window.innerWidth; };
    window.addEventListener("resize", onResize);

    const onMove = (e: MouseEvent) => {
      if (resizingLeft) {
        const w = e.clientX - 25; // 25 = left strip width
        if (w > 150 && w < 550) onUpdate({ leftWidth: w });
      }
      if (resizingRight) {
        const root = document.getElementById("jb-root");
        if (!root) return;
        const w = root.getBoundingClientRect().right - e.clientX - 25; // 25 = right strip width
        if (w > 150 && w < 550) onUpdate({ rightWidth: w });
      }
      if (resizingBottom) {
        const root = document.getElementById("jb-root");
        if (!root) return;
        const newH = root.getBoundingClientRect().bottom - e.clientY - 50;
        if (newH > 60 && newH < 550) onUpdate({ bottomHeight: newH });
      }
    };
    const onUp = () => { resizingLeft = false; resizingRight = false; resizingBottom = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  });

  // ── Terminal RPC ──────────────────────────────────────────────────────────
  type AppSchema = {
    bun: {
      requests: Record<string, never>;
      messages: {
        "terminal:input": { data: string; workspaceId: string };
        "terminal:resize": { cols: number; rows: number; workspaceId: string };
        "terminal:ready": { workspaceId: string };
        "terminal:destroy": { workspaceId: string };
        "run:execute": { command: string; workspaceId: string };
        "workspace:setRootPath": { workspaceId: string; path: string };
      };
    };
    webview: {
      requests: Record<string, never>;
      messages: {
        "terminal:output": { data: string; workspaceId: string };
        "terminal:exited": { workspaceId: string };
        "menu:open-settings": Record<string, never>;
        "menu:new-file": Record<string, never>;
        "menu:open-file": Record<string, never>;
        "menu:save-file": Record<string, never>;
        "folder:picked": { workspaceId: string; path: string; name: string; cancelled: boolean };
      };
    };
  };

  // ── Tiling terminal state ──────────────────────────────────────────────────
  import { TilingStore } from "../stores/tilingStore.svelte";
  import TerminalLayout from "./TerminalLayout.svelte";
  let tiling = new TilingStore();

  // Separate map for write functions - more stable than storing in tree nodes
  let terminalWriteFns = new Map<string, (b64: string) => void>();
  console.log(`[EditorLayout] Created new terminalWriteFns Map`);



  // Track all terminal IDs derived directly from tiling tree
  let allTerminalIds = $derived(tiling.terminals.map(t => t.id));

  // Bottom panel maximize
  let bottomMaximized = $state(false);
  let termFullscreen  = $state(false);

  // Initialize terminal when panel opens (only if project is open)
  $effect(() => {
    if (hasProject && ws.bottomPanelOpen && ws.activeBottom === "terminal" && !tiling.root) {
      const id = tiling.init(ws.id);
      console.log(`[EditorLayout] Initialized tiling with terminal ${id}`);
    }
  });

  const termRpc = Electroview.defineRPC<AppSchema>({
    handlers: {
      messages: {
        "terminal:output": ({ data, workspaceId: termId }) => {
          if (tiling.isClosing(termId)) {
            console.log(`[EditorLayout] terminal:output for ${termId} but isClosing, skipping`);
            return;
          }
          const writeFn = terminalWriteFns.get(termId);
          console.log(`[EditorLayout] terminal:output for ${termId}, hasWriteFn: ${!!writeFn}`);
          if (writeFn) {
            writeFn(data);
          }
        },
        "terminal:exited": ({ workspaceId: termId }) => {
          console.log(`[EditorLayout] terminal:exited for ${termId}, isClosing: ${tiling.isClosing(termId)}`);
          if (tiling.isClosing(termId)) return;
          terminalWriteFns.delete(termId);
          const result = tiling.close(termId, ws.id);
        },
        "menu:open-settings": () => { /* TODO */ },
        "menu:new-file":      () => { /* TODO */ },
        "menu:open-file":     (data: { path: string }) => { console.log("menu:open-file received, cwd:", data.path); },
        "menu:save-file":     () => { saveCurrentFile(); },
        "git:status": (data: { isRepo: boolean; branch: string; changes: GitChange[]; rootPath: string }) => {
          gitIsRepo = data.isRepo;
          gitBranch = data.branch;
          gitChanges = data.changes;
          gitLoading = false;
          // Update store with absolute path from git backend
          if (data.rootPath && (data.rootPath.startsWith('/') || /^[A-Za-z]:/.test(data.rootPath))) {
            console.log(`[EditorLayout] Received rootPath from git: ${data.rootPath}`);
            workspaceStore.setRootPath(ws.id, data.rootPath);
            // Send to backend for auto-cd when terminal is created
            termRpc.send["workspace:setRootPath"]({ workspaceId: ws.id, path: data.rootPath });
          }
        },
        "git:diff": (data: { filePath: string; diff: string }) => {
          gitDiffs.set(data.filePath, data.diff);
          gitDiffs = new Map(gitDiffs);
        },
        "git:log": (data: { commits: GitCommit[] }) => {
          gitCommits = data.commits;
        },
        "git:error": (data: { message: string }) => {
          console.error("Git error:", data.message);
          gitLoading = false;
        },
        "folder:picked": (data: { workspaceId: string; path: string; name: string; cancelled: boolean }) => {
          console.log(`[EditorLayout] folder:picked received: ${data.path}`);
          if (!data.cancelled && data.path && (data.path.startsWith('/') || /^[A-Za-z]:/.test(data.path))) {
            // Update store with absolute path
            workspaceStore.setRootPath(ws.id, data.path);
            // Send to backend for auto-cd when terminal is created
            termRpc.send["workspace:setRootPath"]({ workspaceId: ws.id, path: data.path });
          }
        },
      },
    },
  });

  new Electroview({ rpc: termRpc });

  // ── Terminal RPC helpers ──────────────────────────────────────────────────
  function handleTermInput(termId: string, b64: string) {
    if (tiling.isClosing(termId)) {
      console.log(`[EditorLayout] handleTermInput for ${termId} but isClosing, skipping`);
      return;
    }
    console.log(`[EditorLayout] handleTermInput for ${termId}, sending to backend...`);
    try {
      termRpc.send["terminal:input"]({ data: b64, workspaceId: termId });
      console.log(`[EditorLayout] handleTermInput for ${termId}, sent!`);
    } catch (e) {
      console.error(`[EditorLayout] handleTermInput for ${termId} ERROR:`, e);
    }
  }
  function handleTermResize(termId: string, cols: number, rows: number) {
    if (tiling.isClosing(termId)) return;
    termRpc.send["terminal:resize"]({ cols, rows, workspaceId: termId });
  }
  function handleRunExecute(command: string) {
    console.log(`[EditorLayout] handleRunExecute: ${command}`);
    termRpc.send["run:execute"]({ command, workspaceId: ws.id });
  }
  function handleTermMounted(termId: string, writeFn: (b64: string) => void) {
    if (tiling.isClosing(termId)) return;
    console.log(`[EditorLayout] handleTermMounted for ${termId}`);
    terminalWriteFns.set(termId, writeFn);
    termRpc.send["terminal:ready"]({ workspaceId: termId });

  }
  function handleSplit(termId: string, direction: "horizontal" | "vertical") {
    console.log(`[EditorLayout] handleSplit ${direction} for ${termId}`);
    tiling.split(termId, direction, ws.id);
  }
  function handleCloseTerm(termId: string) {
    if (tiling.isClosing(termId)) return;
    console.log(`[EditorLayout] handleCloseTerm for ${termId}`);
    console.log(`[EditorLayout] terminalWriteFns keys before delete: ${Array.from(terminalWriteFns.keys()).join(', ')}`);
    terminalWriteFns.delete(termId);
    console.log(`[EditorLayout] terminalWriteFns keys after delete: ${Array.from(terminalWriteFns.keys()).join(', ')}`);
    termRpc.send["terminal:destroy"]({ workspaceId: termId });
    tiling.close(termId, ws.id);
  }
  function handleActivateTerm(termId: string) {
    tiling.setActive(termId);
  }

  function togglePanelMaximize() {
    bottomMaximized = !bottomMaximized;
  }

  function restorePanelSize() {
    bottomMaximized = false;
    onUpdate({ bottomHeight: 200 });
  }
</script>

<!-- ══════════════════════════════════════════
     JetBrains / IntelliJ IDEA — Darcula Layout
══════════════════════════════════════════ -->
<div
  id="jb-root"
  class="flex flex-col w-full h-full bg-jb-bg text-jb-text overflow-hidden text-[13px]"
  style:cursor={resizingLeft || resizingRight ? "col-resize" : resizingBottom ? "row-resize" : "default"}
>

  <!-- ══ MENU BAR ══════════════════════════════════════════ -->
  <!-- With CSD (hiddenInset), the workspace tab bar IS the title bar.
       This is just the menu bar row, kept draggable so the window
       can still be moved by dragging from this area. -->
  <header class="titlebar electrobun-webkit-app-region-drag flex items-center h-[26px] bg-jb-panel flex-shrink-0 border-b border-jb-border">

    <div bind:this={navWrapEl} class="no-drag electrobun-webkit-app-region-no-drag flex items-center flex-1 min-w-0 overflow-visible pl-1 relative">

      <!-- Hamburger menu - hidden when menu is fully visible -->
      {#if navOverflows && !hamburgerOpen}
        <button
          onclick={() => hamburgerOpen = true}
          class="flex flex-col justify-center items-center w-[22px] h-[22px] gap-[4px] rounded hover:bg-jb-hover flex-shrink-0 mr-1 z-50 relative"
          title="Menu"
        >
          <span class="block w-[13px] h-[1.5px] bg-jb-muted rounded"></span>
          <span class="block w-[13px] h-[1.5px] bg-jb-muted rounded"></span>
          <span class="block w-[13px] h-[1.5px] bg-jb-muted rounded"></span>
        </button>
      {/if}
      {#if hamburgerOpen}
        <button class="fixed inset-0 z-40 cursor-default border-none bg-transparent p-0" onclick={() => hamburgerOpen = false} aria-label="Close menu"></button>
        <div class="absolute top-full left-0 mt-px bg-jb-panel border border-jb-border rounded shadow-lg z-50 py-1 min-w-[200px]">
          {#each ["File","Edit","View","Navigate","Code","Refactor","Build","Run","Tools","Git","Window","Help"] as menuId}
            {@const items = menuItems[menuId as keyof typeof menuItems]}
            {#if items?.length}
              <button
                class="w-full flex items-center justify-between px-3 py-1.5 text-[12px] text-jb-text hover:bg-jb-select cursor-pointer border-none bg-transparent text-left"
                onclick={() => { handleMenuItemClick(menuId); hamburgerOpen = false; }}
              >
                <span>{menuId}</span>
                <span class="text-jb-muted text-[11px] ml-4">▶</span>
              </button>
            {/if}
          {/each}
        </div>
      {/if}

      <nav
        bind:this={navEl}
        class="flex items-center gap-0"
        style:visibility={navOverflows ? "hidden" : "visible"}
        style:position={navOverflows ? "absolute" : "static"}
        style:pointer-events={navOverflows ? "none" : "auto"}
      >
        {#each ["File","Edit","View","Navigate","Code","Refactor","Build","Run","Tools","Git","Window","Help"] as menuId}
          {@const items = menuItems[menuId as keyof typeof menuItems]}
          <div class="relative">
            <button
              class="px-2 py-0.5 text-[12px] rounded whitespace-nowrap border-none bg-transparent cursor-pointer
                {activeMenu === menuId ? 'bg-jb-select text-jb-text' : 'text-jb-text hover:bg-jb-hover'}"
              onclick={(e) => { e.stopPropagation(); openMenu(menuId as MenuId); }}
              onmouseenter={() => activeMenu && (activeMenu = menuId as MenuId)}
            >
              {menuId}
            </button>
            {#if activeMenu === menuId}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="absolute top-full left-0 mt-px bg-jb-panel border border-jb-border rounded shadow-lg z-50 py-1 min-w-[200px]"
                onclick={(e) => e.stopPropagation()}
                onmouseenter={() => {}}
                onmouseleave={() => closeMenu()}
              >
                {#each items as item}
                  <button
                    class="w-full flex items-center justify-between px-3 py-1.5 text-[12px] text-jb-text hover:bg-jb-select cursor-pointer border-none bg-transparent text-left"
                    onclick={() => handleMenuItemClick(item.label)}
                  >
                    <span>{item.label}</span>
                    {#if item.shortcut}
                      <span class="text-jb-muted text-[11px] ml-4">{item.shortcut}</span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </nav>
      <!-- Click outside to close menu -->
      {#if activeMenu}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="fixed inset-0 z-30" onclick={() => closeMenu()} onkeydown={() => {}}></div>
      {/if}

    </div>

    <div class="flex-1 min-w-0"></div>

  </header>

  <!-- ══ MAIN TOOLBAR ══════════════════════════════════════ -->
  {#if toolbarOpen}
  <div class="flex items-center h-[38px] bg-jb-panel border-b border-jb-border flex-shrink-0 px-2 gap-0.5">

    <!-- Search everywhere -->
    <button title="Search Everywhere (⇧⇧)" class="toolbar-btn flex items-center gap-1 px-2 py-1 text-[12px] rounded hover:bg-jb-hover">
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" class="text-jb-muted">
        <circle cx="6.5" cy="6.5" r="5"/><path d="M11 11l3.5 3.5"/>
      </svg>
    </button>

    <div class="w-px h-5 bg-jb-border mx-1"></div>

    <!-- Run config dropdown -->
    <div class="relative flex items-center">
      <button
        class="flex items-center gap-1.5 px-2.5 py-1 bg-jb-panel2 border border-jb-border rounded text-[12px] text-jb-text hover:bg-jb-hover h-[26px] min-w-[160px] justify-between"
        onclick={() => runConfigOpen = !runConfigOpen}
      >
        <span class="flex items-center gap-1.5">
          <svg viewBox="0 0 12 12" width="12" height="12" fill="#629755"><polygon points="2,1 10,6 2,11"/></svg>
          <span>{ws.selectedConfig}</span>
        </span>
        <span class="text-jb-muted text-[10px]">▾</span>
      </button>
      {#if runConfigOpen}
        <div class="absolute top-full left-0 mt-px bg-jb-panel border border-jb-border rounded shadow-lg z-50 py-1 min-w-[200px]">
          {#each runConfigs as cfg}
            <button
              class="w-full text-left px-3 py-1.5 text-[12px] text-jb-text hover:bg-jb-select flex items-center gap-2"
              onclick={() => { onUpdate({ selectedConfig: cfg }); runConfigOpen = false; }}
            >
              <svg viewBox="0 0 12 12" width="10" height="10" fill="#629755"><polygon points="2,1 10,6 2,11"/></svg>
              {cfg}
            </button>
          {/each}
          <div class="border-t border-jb-border my-1"></div>
          <button
            class="w-full text-left px-3 py-1.5 text-[12px] text-jb-muted hover:bg-jb-select flex items-center gap-2"
            onclick={() => { runConfigOpen = false; runEditOpen = true; }}
          >
            <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 1v10M1 6h10"/></svg>
            Edit configurations...
          </button>
        </div>
      {/if}
    </div>

    <!-- Run -->
    <button
      title="Run '{ws.selectedConfig}' (⌘R)"
      onclick={() => { onUpdate({ activeBottom: "run", bottomPanelOpen: true }); handleRunExecute(ws.selectedConfig); }}
      class="flex items-center justify-center w-[28px] h-[28px] rounded hover:bg-jb-hover"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
        <circle cx="8" cy="8" r="7" fill="#629755" opacity="0.15"/>
        <polygon points="5.5,4 12.5,8 5.5,12" fill="#629755"/>
      </svg>
    </button>

    <!-- Debug -->
    <button title="Debug '{ws.selectedConfig}' (⌘D)" class="flex items-center justify-center w-[28px] h-[28px] rounded hover:bg-jb-hover">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
        <circle cx="8" cy="8" r="7" fill="#4e9ede" opacity="0.15"/>
        <circle cx="8" cy="8" r="3" fill="none" stroke="#4e9ede" stroke-width="1.5"/>
        <line x1="8" y1="1.5" x2="8" y2="4" stroke="#4e9ede" stroke-width="1.5"/>
        <line x1="8" y1="12" x2="8" y2="14.5" stroke="#4e9ede" stroke-width="1.5"/>
        <line x1="1.5" y1="8" x2="4" y2="8" stroke="#4e9ede" stroke-width="1.5"/>
        <line x1="12" y1="8" x2="14.5" y2="8" stroke="#4e9ede" stroke-width="1.5"/>
      </svg>
    </button>

    <!-- Stop -->
    <button title="Stop (⌘F2)" class="flex items-center justify-center w-[28px] h-[28px] rounded hover:bg-jb-hover opacity-40 hover:opacity-70">
      <svg viewBox="0 0 16 16" width="14" height="14">
        <rect x="4" y="4" width="8" height="8" rx="1" fill="#ff6b68"/>
      </svg>
    </button>

    <!-- Build -->
    <button title="Build Project (⌘F9)" class="flex items-center justify-center w-[28px] h-[28px] rounded hover:bg-jb-hover">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" class="text-jb-muted">
        <path d="M6 2l-4 7h3v5l4-7H6V2zM10 2l-1 4h2l-2 8 5-6h-3l1-6h-2z" stroke="none" fill="#ffc66d"/>
      </svg>
    </button>

    <div class="w-px h-5 bg-jb-border mx-1"></div>

    <!-- Git actions -->
    {#each [
      { title:"Update Project (⌘T)", svg:`<path d="M8 3v2.5M8 3l-2 2M8 3l2 2" stroke-width="1.5"/><path d="M12 8a4 4 0 1 1-8 0" stroke-width="1.5" fill="none"/>` },
      { title:"Commit (⌘K)",         svg:`<polyline points="4,8 7,11 12,5" stroke-width="1.5"/>` },
      { title:"Push (⌘⇧K)",          svg:`<path d="M8 13V5M8 5l-3 3M8 5l3 3" stroke-width="1.5"/>` },
    ] as ga}
      <button title={ga.title} class="flex items-center justify-center w-[28px] h-[28px] rounded hover:bg-jb-hover">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#a9b7c6" class="text-jb-text">
          {@html ga.svg}
        </svg>
      </button>
    {/each}

    <div class="w-px h-5 bg-jb-border mx-1"></div>

    <!-- Recent files -->
    <button title="Recent Files (⌘E)" class="flex items-center justify-center w-[28px] h-[28px] rounded hover:bg-jb-hover">
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="#a9b7c6" stroke-width="1.3">
        <rect x="3" y="2" width="10" height="12" rx="1"/>
        <path d="M6 6h4M6 9h4M6 12h2"/>
      </svg>
    </button>

    <!-- Right-side: notifications + help -->
    <div class="ml-auto flex items-center gap-1">
      <!-- Notifications -->
      <button title="Notifications" class="flex items-center justify-center w-[28px] h-[28px] rounded hover:bg-jb-hover">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="#808080" stroke-width="1.3">
          <path d="M8 2c-2.8 0-4 2-4 4v3l-1 1v1h10v-1l-1-1V6c0-2-1.2-4-4-4zM6.5 13a1.5 1.5 0 0 0 3 0"/>
        </svg>
      </button>
      <!-- Help -->
      <button title="Help" class="flex items-center justify-center w-[28px] h-[28px] rounded hover:bg-jb-hover">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="#808080" stroke-width="1.3">
          <circle cx="8" cy="8" r="6"/>
          <path d="M6 6.5c0-1.1.9-2 2-2s2 .9 2 2-.9 1.5-2 2v1M8 12v.5"/>
        </svg>
      </button>
    </div>
  </div>
  {/if}

  <!-- ══ BODY (left strip + panels + editor + right strip) ══ -->
  <div class="flex flex-1 min-h-0 overflow-hidden">

    <!-- ── LEFT TOOL STRIP ── -->
    <div class="flex flex-col justify-between bg-jb-panel border-r border-jb-border flex-shrink-0 w-[25px]">
      <!-- Top tool buttons -->
      <div class="flex flex-col items-center pt-1">
        {#each leftTools as tool}
          <button
            title={tool.label}
            class="tool-strip-btn flex items-center gap-1 px-1 py-2.5 text-[11px] cursor-pointer border-none bg-transparent w-full justify-center
              {ws.activeTool === tool.id && ws.leftPanelOpen ? 'text-jb-text2 bg-jb-active' : 'text-jb-muted hover:text-jb-text hover:bg-jb-hover'}"
            onclick={() => toggleTool(tool.id)}
          >
            <span
              class="[writing-mode:vertical-rl] rotate-180 font-medium tracking-wide whitespace-nowrap leading-none text-[11px]"
            >{tool.num}: {tool.label}</span>
          </button>
        {/each}
      </div>
      <!-- Bottom tool buttons -->
      <div class="flex flex-col items-center pb-1">
        <button title="Notifications" class="flex items-center justify-center w-full py-2 text-jb-muted hover:text-jb-text hover:bg-jb-hover bg-transparent border-none cursor-pointer">
          <span class="[writing-mode:vertical-rl] rotate-180 text-[11px] whitespace-nowrap">Notifications</span>
        </button>
      </div>
    </div>

    <!-- ── LEFT TOOL WINDOW (Project / Structure / Git) ── -->
    {#if ws.leftPanelOpen}
      <div
        class="flex flex-col bg-jb-panel border-r border-jb-border flex-shrink-0 min-h-0 relative"
        style:width="{ws.leftWidth}px"
      >

        {#if ws.activeTool === "project"}
          <Sidebar
            expandedFolders={ws.expandedFolders}
            onToggleFolder={(key) => {
              const updated = { ...ws.expandedFolders, [key]: !ws.expandedFolders[key] };
              onUpdate({ expandedFolders: updated });
            }}
            activeRoute={ws.activeRoute}
            activeTabPath={activeTab?.path ?? ""}
            onClose={() => onUpdate({ leftPanelOpen: false })}
            onFileOpen={(path, name, icon, content) =>
              workspaceStore.openFile(ws.id, path, name, icon, content)
            }
            onFolderOpen={(path) => {
              // Use the path from the store (which should be absolute after Sidebar update)
              const storePath = ws.project?.rootPath;
              const targetPath = storePath && (storePath.startsWith('/') || /^[A-Za-z]:/.test(storePath)) 
                ? storePath 
                : path;
              
              gitOpenRepo(targetPath);
              // Send root path to backend for auto-cd when terminal is created
              if (targetPath && (targetPath.startsWith('/') || /^[A-Za-z]:/.test(targetPath))) {
                termRpc.send["workspace:setRootPath"]({ workspaceId: ws.id, path: targetPath });
                console.log(`[EditorLayout] Sent workspace:setRootPath for ${ws.id}: ${targetPath}`);
              }
            }}
            workspaceId={ws.id}
            projectRootName={ws.project.rootName}
            projectFileNodes={ws.project.fileNodes}
          />

        {:else}
          <!-- ── Generic header for non-project tools ── -->
          <div class="flex items-center justify-between px-2 h-[30px] bg-jb-panel2 border-b border-jb-border flex-shrink-0">
            <div class="flex items-center gap-2">
              {#if ws.activeTool === "structure"}
                <span class="text-[12px] font-semibold text-jb-text2">Structure</span>
              {:else if ws.activeTool === "git"}
                <span class="text-[12px] font-semibold text-jb-text2">Git</span>
              {:else}
                <span class="text-[12px] font-semibold text-jb-text2">Bookmarks</span>
              {/if}
            </div>
            <div class="flex items-center gap-0.5">
              <button title="Expand All" class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]">⊞</button>
              <button title="Collapse All" class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]">⊟</button>
              <button
                title="Hide"
                onclick={() => onUpdate({ leftPanelOpen: false })}
                class="w-5 h-5 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]"
              >✕</button>
            </div>
          </div>

          <!-- Tool window body -->
          <div class="flex-1 overflow-y-auto overflow-x-hidden min-h-0 py-1">

          {#if ws.activeTool === "structure"}
            <div class="px-3 py-2 text-[12px] text-jb-muted">
              <div class="mb-2 font-semibold text-jb-text">index.svelte</div>
              {#each [
                { indent:0, icon:"C", color:"#9876aa", label:"script" },
                { indent:1, icon:"f", color:"#ffc66d", label:"onMount()" },
                { indent:0, icon:"H", color:"#4e9ede", label:"template" },
                { indent:1, icon:"d", color:"#a9b7c6", label:"div.flex" },
                { indent:2, icon:"h", color:"#cc7832", label:"h1" },
                { indent:2, icon:"a", color:"#4e9ede", label:"a[href]" },
              ] as item}
                <div class="flex items-center gap-1.5 h-[20px] cursor-pointer hover:bg-jb-hover rounded px-1" style="margin-left:{item.indent * 14}px">
                  <span class="text-[10px] font-bold w-3.5 text-center flex-shrink-0" style="color:{item.color}">{item.icon}</span>
                  <span class="text-jb-text">{item.label}</span>
                </div>
              {/each}
            </div>

          {:else if ws.activeTool === "git"}
            <div class="px-2 py-2 flex flex-col h-full">
              {#if !gitIsRepo}
                <div class="flex flex-col items-center justify-center h-full text-jb-muted text-[12px] gap-2">
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
                    <path d="M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
                  </svg>
                  <span class="text-center">Open a folder to see Git changes</span>
                </div>
              {:else}
                <div class="flex items-center justify-between mb-2 px-1">
                  <span class="text-[11px] font-semibold text-jb-muted">{gitBranch}</span>
                  <button
                    onclick={() => gitRefresh()}
                    class="text-[10px] px-1.5 py-0.5 rounded bg-jb-border/50 text-jb-muted hover:bg-jb-border hover:text-jb-text border-none cursor-pointer"
                    title="Refresh"
                  >↻</button>
                </div>
                
                <div class="text-[11px] font-semibold text-jb-muted mb-1 px-1">CHANGES ({gitChanges.length})</div>
                {#if gitChanges.length === 0}
                  <div class="text-[11px] text-jb-muted px-1 py-2 italic">No changes</div>
                {:else}
                  <div class="flex-1 overflow-y-auto">
                    {#each gitChanges as change (change.path)}
                      <button
                        onclick={() => {
                          if (selectedDiffFile === change.path) {
                            selectedDiffFile = null;
                          } else {
                            selectedDiffFile = change.path;
                            gitGetDiff(change.path);
                          }
                        }}
                        class="w-full flex items-center gap-2 h-[22px] px-2 rounded text-[12px] hover:bg-jb-hover cursor-pointer text-left"
                      >
                        <span class="font-bold text-[11px] w-3 text-center" style="color:{gitStatusColor(change.status)}">
                          {gitStatusLetter(change.status)}
                        </span>
                        <span class="text-jb-text flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{change.path}</span>
                        {#if selectedDiffFile === change.path}
                          <span class="text-jb-muted text-[10px]">▼</span>
                        {:else}
                          <span class="text-jb-muted text-[10px]">▶</span>
                        {/if}
                      </button>
                      {#if selectedDiffFile === change.path}
                        <div class="ml-4 mr-1 mb-1 text-[11px] font-mono bg-jb-panel rounded border border-jb-border overflow-x-auto">
                          {#if gitDiffs.get(change.path)}
                            <pre class="p-2 whitespace-pre-wrap break-all text-[10px] leading-relaxed">{gitDiffs.get(change.path)}</pre>
                          {:else}
                            <div class="p-2 text-jb-muted italic">Loading diff...</div>
                          {/if}
                        </div>
                      {/if}
                    {/each}
                  </div>
                {/if}

                <div class="mt-3 pt-2 border-t border-jb-border">
                  <div class="text-[11px] font-semibold text-jb-muted mb-1 px-1">COMMIT LOG</div>
                  <div class="max-h-[180px] overflow-y-auto">
                    {#if gitCommits.length === 0}
                      <div class="text-[11px] text-jb-muted px-1 py-2 italic">No commits</div>
                    {:else}
                      {#each gitCommits.slice(0, 20) as commit}
                        <div class="flex flex-col px-2 py-1 hover:bg-jb-hover rounded cursor-pointer">
                          <div class="flex items-center gap-2 text-[12px]">
                            <span class="text-jb-blue font-mono text-[10px]">{commit.hash}</span>
                            <span class="text-jb-text flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{commit.message}</span>
                          </div>
                          <div class="text-[11px] text-jb-muted">{commit.author_name} · {formatTimeAgo(commit.date)}</div>
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>
              {/if}
            </div>

          {:else if ws.activeTool === "database"}
            <div class="px-2 py-2 text-[12px]">
              <div class="text-[11px] font-semibold text-jb-muted mb-2 px-1">CONNECTIONS</div>
              <div class="flex items-center gap-2 h-[22px] px-2 rounded text-jb-muted hover:bg-jb-hover cursor-pointer italic">
                <span>+ New connection</span>
              </div>
              <div class="mt-4 flex flex-col items-center gap-2 text-jb-muted py-6">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.4">
                  <ellipse cx="12" cy="5" rx="9" ry="3"/>
                  <path d="M3 5v4c0 1.657 4.03 3 9 3s9-1.343 9-3V5"/>
                  <path d="M3 9v4c0 1.657 4.03 3 9 3s9-1.343 9-3V9"/>
                  <path d="M3 13v4c0 1.657 4.03 3 9 3s9-1.343 9-3v-4"/>
                </svg>
                <span class="text-[11px] text-center">No database connections</span>
              </div>
            </div>

          {:else}
            <div class="flex items-center justify-center h-20 text-jb-muted text-[12px]">No bookmarks yet.</div>
          {/if}

          </div><!-- /tool window body -->
        {/if}<!-- /activeTool === project -->

        <!-- Left panel resize handle -->
        <div
          class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-jb-blue"
          role="slider"
          aria-orientation="vertical"
          aria-label="Resize left panel"
          aria-valuenow={ws.leftWidth}
          aria-valuemin={150}
          aria-valuemax={550}
          tabindex="0"
          onmousedown={(e) => { resizingLeft = true; e.preventDefault(); }}
          style="right:-2px; position:absolute; top:0; bottom:0; width:4px;"
        ></div>
      </div>
    {/if}

    <!-- ── CENTER: editor or agent ── -->
    <div class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
    {#if mode === "editor"}

      <!-- Navigation Bar (breadcrumb) -->
      <div class="flex items-center h-[26px] bg-jb-panel border-b border-jb-border flex-shrink-0 px-3 gap-1 text-[12px] overflow-hidden">
        <svg viewBox="0 0 12 12" width="12" height="12" fill="#4e9ede" class="flex-shrink-0">
          <rect x="0.5" y="1.5" width="11" height="9" rx="1"/><rect x="0.5" y="1.5" width="5" height="3" rx="1" fill="#6aaddc"/>
        </svg>
        {#if activeTab}
          {#each activeTab.path.split("/") as part, i}
            {#if i < activeTab.path.split("/").length - 1}
              <span class="text-jb-muted whitespace-nowrap">{part}</span>
              <span class="text-jb-dim flex-shrink-0">›</span>
            {:else}
              <span class="text-jb-text font-medium whitespace-nowrap">{part}</span>
            {/if}
          {/each}
        {:else}
          <span class="text-jb-muted">ultimate_editor</span>
        {/if}
      </div>

      <!-- ── EDITOR TABS (from workspaceStore) ── -->
      <div class="flex items-end bg-jb-panel border-b border-jb-border flex-shrink-0 overflow-x-auto min-h-[32px]">
        {#each ws.openTabs as tab (tab.id)}
          <div
            role="tab"
            tabindex="0"
            class="group flex items-center gap-1.5 px-3 h-[32px] text-[13px] border-r border-jb-border flex-shrink-0 whitespace-nowrap relative transition-colors duration-100 cursor-pointer select-none
              {tab.id === ws.activeTabId
                ? 'bg-jb-bg text-jb-text2 border-t-2 border-t-jb-blue'
                : 'bg-jb-panel text-jb-muted hover:bg-jb-hover hover:text-jb-text'}"
            onclick={() => workspaceStore.setActiveTab(tab.id)}
            onkeydown={(e) => e.key === "Enter" && workspaceStore.setActiveTab(tab.id)}
          >
            <!-- File type dot / unsaved indicator -->
            {#if tab.modified}
              <span class="w-2 h-2 rounded-full bg-[#e2c08d] flex-shrink-0" title="Unsaved changes"></span>
            {:else}
              <span class="text-[9px] font-bold flex-shrink-0" style="color:{iconColor(tab.icon)}">●</span>
            {/if}
            <span>{tab.name}</span>
            <!-- Save hint when modified -->
            {#if tab.modified}
              <span class="text-[10px] text-jb-muted ml-0.5" title="Ctrl+S to save">*</span>
            {/if}
            <!-- Close button -->
            <button
              class="ml-1 text-[13px] leading-none bg-transparent border-none cursor-pointer px-0.5 rounded text-transparent group-hover:text-jb-muted hover:!text-jb-text hover:bg-jb-hover"
              title="Close tab"
              onclick={(e) => { e.stopPropagation(); workspaceStore.closeTab(tab.id); }}
            >×</button>
          </div>
        {/each}
        <div class="flex-1 bg-jb-panel"></div>
        <!-- Editor actions -->
        <div class="flex items-center px-2 gap-1 flex-shrink-0 h-[32px]">
          {#if activeTab}
            <button
              title="Save file (Ctrl+S)"
              class="flex items-center gap-1 px-2 h-[22px] text-[11px] rounded bg-transparent border-none cursor-pointer text-jb-muted hover:bg-jb-hover hover:text-jb-text"
              class:text-jb-green={activeTab.modified}
              onclick={saveCurrentFile}
            >
              <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3">
                <rect x="2" y="1" width="10" height="12" rx="1"/>
                <rect x="4" y="1" width="6" height="4" rx="0.5" fill="currentColor"/>
                <rect x="3" y="7" width="8" height="5" rx="0.5" fill="currentColor" opacity="0.4"/>
              </svg>
            </button>
          {/if}
          <button title="Split Vertically" class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer">
            <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.2">
              <rect x="1" y="1" width="12" height="12"/><line x1="7" y1="1" x2="7" y2="13"/>
            </svg>
          </button>
          <button title="Recent Files (⌘E)" class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]">⊠</button>
        </div>
      </div>

      <!-- ── EDITOR AREA ── -->
        <div class="flex-1 flex min-h-0 overflow-hidden bg-jb-bg relative">
          {#if activeTab}
            {#key activeTab.id}
              <CodeEditor
                tabId={activeTab.id}
                content={activeTab.content}
                icon={activeTab.icon}
                onContentChange={(newContent) => workspaceStore.updateTabContent(activeTab!.id, newContent)}
                onSave={saveCurrentFile}
              />
            {/key}
          {:else if hasProject}
            <div class="flex-1 bg-jb-bg"></div>
          {:else}
            <div class="flex-1 bg-jb-bg flex flex-col items-center justify-center gap-4 select-none pointer-events-none">
              <svg viewBox="0 0 48 48" width="52" height="52" fill="none" stroke="#4c5052" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="opacity-60">
                <path d="M6 10h12l4 5h20a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3z"/>
              </svg>
              <p class="text-[14px] font-medium" style="color:#5a5d5f">No project open</p>
              <p class="text-[12px]" style="color:#46494a">Open a project or file to start editing</p>
            </div>
          {/if}
        </div><!-- end editor area -->

    {:else}
    <!-- ── AGENT CHAT CENTER ── -->
    <div class="flex-1 flex flex-col min-h-0 overflow-hidden bg-jb-bg">

      <!-- Messages -->
      <div bind:this={agentEl} class="flex-1 overflow-y-auto min-h-0 px-8 py-6 space-y-6">
        {#if agentMessages.length === 0}
          <div class="flex flex-col items-center justify-center h-full text-center gap-3 py-16">
            <div class="w-10 h-10 rounded-xl bg-jb-blue/20 flex items-center justify-center">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#4e9ede" stroke-width="1.5">
                <path d="M12 2a10 10 0 0 1 10 10c0 5.5-4.5 10-10 10S2 17.5 2 12 6.5 2 12 2z"/>
                <path d="M8 12h8M12 8v8" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="text-[15px] font-semibold text-jb-text">What can I help you with?</div>
            <div class="text-[12px] text-jb-muted max-w-[320px] leading-relaxed">
              Ask me to write code, fix bugs, refactor, explain concepts, or make changes across your project.
            </div>
            <div class="flex flex-wrap gap-2 justify-center mt-2">
              {#each ["Fix a bug", "Write a function", "Explain this code", "Refactor for readability"] as chip}
                <button
                  onclick={() => { agentInput = chip; }}
                  class="px-3 py-1.5 rounded-full text-[11px] bg-jb-panel border border-jb-border text-jb-muted hover:text-jb-text hover:border-jb-blue/50 cursor-pointer transition-colors"
                >{chip}</button>
              {/each}
            </div>
          </div>
        {:else}
          {#each agentMessages as msg (msg.id)}
            {#if msg.role === "user"}
              <div class="flex justify-end">
                <div class="max-w-[75%] bg-jb-blue/20 border border-jb-blue/30 rounded-2xl rounded-tr-sm px-4 py-3">
                  <p class="text-[13px] text-jb-text leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            {:else}
              <div class="flex gap-3">
                <div class="w-7 h-7 rounded-lg bg-jb-green/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="#629755" stroke-width="1.3">
                    <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1z"/>
                    <path d="M5 8l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-[11px] text-jb-muted mb-1 font-medium">Agent</div>
                  <p class="text-[13px] text-jb-text leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            {/if}
          {/each}
          {#if agentStreaming}
            <div class="flex gap-3">
              <div class="w-7 h-7 rounded-lg bg-jb-green/20 flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="#629755" stroke-width="1.3">
                  <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1z"/>
                  <path d="M5 8l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <div class="flex items-center gap-1 pt-2">
                <span class="w-2 h-2 rounded-full bg-jb-blue/60 agent-dot"></span>
                <span class="w-2 h-2 rounded-full bg-jb-blue/60 agent-dot" style="animation-delay:0.2s"></span>
                <span class="w-2 h-2 rounded-full bg-jb-blue/60 agent-dot" style="animation-delay:0.4s"></span>
              </div>
            </div>
          {/if}
        {/if}
      </div>

      <!-- Input area -->
      <div class="flex-shrink-0 px-8 pb-4">
        <div class="border border-jb-border rounded-xl bg-jb-panel overflow-hidden focus-within:border-jb-blue/50 transition-colors">
          <textarea
            bind:value={agentInput}
            onkeydown={agentKeydown}
            placeholder="Ask for changes or follow-up…"
            rows="3"
            class="w-full px-4 pt-3 pb-2 text-[13px] bg-transparent border-none resize-none text-jb-text placeholder:text-jb-muted focus:outline-none leading-relaxed"
          ></textarea>
          <div class="flex items-center justify-between px-3 pb-2.5">
            <div class="flex items-center gap-3 text-[11px] text-jb-muted">
              <button class="flex items-center gap-1 hover:text-jb-text cursor-pointer bg-transparent border-none font-[inherit]">
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6"/><path d="M5.5 8.5c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5"/></svg>
                Claude Sonnet
                <svg viewBox="0 0 10 6" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1 1l4 4 4-4"/></svg>
              </button>
              <span class="text-jb-border">|</span>
              <button class="hover:text-jb-text cursor-pointer bg-transparent border-none font-[inherit]">Chat</button>
              {#if ws.project.rootName}
                <span class="text-jb-border">|</span>
                <span class="flex items-center gap-1">
                  <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="1" y="3" width="10" height="8" rx="1"/><path d="M4 3V1.5h4V3"/></svg>
                  {ws.project.rootName}
                </span>
              {/if}
            </div>
            <button
              onclick={agentSend}
              disabled={!agentInput.trim() || agentStreaming}
              title="Send (Enter)"
              class="w-8 h-8 rounded-lg flex items-center justify-center bg-jb-blue text-white border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-jb-blue/80 transition-colors"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M3 8h10M9 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

    </div><!-- end agent chat center -->
    {/if}

        <!-- Bottom panel resize handle -->
        {#if ws.bottomPanelOpen}
          <div
            class="h-1 flex-shrink-0 cursor-row-resize bg-jb-border hover:bg-jb-blue transition-colors"
            role="slider"
            aria-orientation="horizontal"
            aria-label="Resize bottom panel"
            aria-valuenow={ws.bottomHeight}
            aria-valuemin={60}
            aria-valuemax={550}
            tabindex="0"
            onmousedown={(e) => { resizingBottom = true; e.preventDefault(); }}
          ></div>
        {/if}

        <!-- Bottom panel content (always mounted — terminal stays alive in background) -->
        <div
          class="bg-jb-bg border-t border-jb-border flex flex-col overflow-hidden flex-shrink-0"
          style:height={ws.bottomPanelOpen ? (bottomMaximized ? '100%' : `${ws.bottomHeight}px`) : '0px'}
        >
            <!-- Panel tab bar -->
            <div class="flex items-center bg-jb-panel2 h-[30px] flex-shrink-0 border-b border-jb-border px-1 gap-0">
              {#each bottomTabs as pt}
                <button
                  class="flex items-center gap-1.5 px-3 h-full text-[12px] font-medium border-none bg-transparent cursor-pointer border-t-2 transition-colors
                    {ws.activeBottom === pt.id
                      ? 'text-jb-text2 border-t-jb-blue'
                      : 'text-jb-muted border-t-transparent hover:text-jb-text hover:bg-jb-hover'}"
                  onclick={() => toggleBottom(pt.id)}
                >
                  <span class="text-[11px]">{pt.icon}</span>
                  {pt.label}
                  {#if pt.badge !== undefined}
                    <span class="bg-jb-border rounded-full px-1.5 text-[10px]">{pt.badge}</span>
                  {/if}
                </button>
              {/each}
              <div class="flex-1"></div>
              <button
                title={bottomMaximized ? "Restore size" : "Maximize panel"}
                onclick={togglePanelMaximize}
                class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]"
              >{bottomMaximized ? "⊡" : "⤢"}</button>
              <button
                title="Restore default size"
                onclick={restorePanelSize}
                class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]"
              >⊟</button>
              <button title="Close panel" onclick={() => onUpdate({ bottomPanelOpen: false })}
                class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]">✕</button>
            </div>

            <!-- Panel body -->
            <div class="flex-1 flex flex-col min-h-0 overflow-hidden">

              <!--
                Terminal: ALWAYS mounted so PTY sessions survive tab switches.
                Hidden via CSS only (display:none) when another bottom tab is active.
              -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="flex flex-col h-full"
                class:hidden={ws.activeBottom !== "terminal" && !termFullscreen}
                class:fixed={termFullscreen}
                class:inset-0={termFullscreen}
                class:z-50={termFullscreen}
                class:bg-jb-bg={termFullscreen}
              >
                <!-- ── Terminal tab bar ── -->
                <div class="flex items-center bg-jb-panel h-[26px] border-b border-jb-border flex-shrink-0 px-1 gap-0 text-[11px]">

                  <!-- Terminal tabs -->
                  {#each tiling.terminals as term (term.id)}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="flex items-center group h-full flex-shrink-0">
                      <button
                        class="flex items-center gap-1 px-2 h-full bg-transparent border-none cursor-pointer text-[11px] border-b-2 transition-colors
                          {tiling.activeTerminalId === term.id
                            ? 'text-jb-text border-b-jb-blue'
                            : 'text-jb-muted border-b-transparent hover:text-jb-text hover:bg-jb-hover'}"
                        onclick={() => tiling.setActive(term.id)}
                      >{term.label}</button>
                      {#if tiling.count > 1}
                        <button
                          class="w-4 h-4 flex items-center justify-center rounded bg-transparent border-none cursor-pointer text-jb-muted hover:text-jb-text hover:bg-jb-hover text-[11px] leading-none -ml-1 mr-0.5 flex-shrink-0"
                          title="Close terminal"
                          onclick={(e) => { e.stopPropagation(); handleCloseTerm(term.id); }}
                        >×</button>
                      {/if}
                    </div>
                  {/each}

                  <!-- Action buttons -->
                  <div class="flex items-center ml-auto flex-shrink-0 gap-0">
                    <!-- New terminal -->
                    <button
                      title={hasProject ? "New terminal" : "Open a project to use the terminal"}
                      disabled={!hasProject}
                      onclick={() => { if (tiling.activeTerminal) handleSplit(tiling.activeTerminal.id, "vertical"); }}
                      class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[13px] disabled:opacity-40 disabled:cursor-not-allowed"
                    >＋</button>
                    <!-- Split vertical -->
                    <button
                      title={hasProject ? "Split vertically" : "Open a project to use the terminal"}
                      disabled={!hasProject}
                      onclick={() => { if (tiling.activeTerminal) handleSplit(tiling.activeTerminal.id, "vertical"); }}
                      class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
                        <rect x="1" y="1" width="12" height="12" rx="1"/><line x1="7" y1="1" x2="7" y2="13"/>
                      </svg>
                    </button>
                    <!-- Split horizontal -->
                    <button
                      title={hasProject ? "Split horizontally" : "Open a project to use the terminal"}
                      disabled={!hasProject}
                      onclick={() => { if (tiling.activeTerminal) handleSplit(tiling.activeTerminal.id, "horizontal"); }}
                      class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
                        <rect x="1" y="1" width="12" height="12" rx="1"/><line x1="1" y1="7" x2="13" y2="7"/>
                      </svg>
                    </button>
                    <!-- Fullscreen -->
                    <button
                      title={termFullscreen ? "Exit fullscreen" : "Fullscreen"}
                      disabled={!hasProject}
                      onclick={() => (termFullscreen = !termFullscreen)}
                      class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
                    >{termFullscreen ? "⊡" : "⤢"}</button>
                  </div>
                </div>

                <!-- ── Tiling pane area ── -->
                <div class="flex-1 min-h-0 overflow-hidden relative">
                  {#if !hasProject}
                    <div class="flex-1 flex flex-col items-center justify-center h-full text-jb-muted gap-3">
                      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                        <rect x="4" y="4" width="16" height="16" rx="2"/>
                        <path d="M4 8h16"/>
                        <path d="M8 4v4"/>
                      </svg>
                      <span class="text-[13px]">Please open a project to start using the terminal</span>
                    </div>
                  {:else if tiling.root}
                    <TerminalLayout
                      node={tiling.root}
                      terminalIds={allTerminalIds}
                      {tiling}
                      onActivate={handleActivateTerm}
                    >
                      {#snippet children(termId)}
                        <div class="relative w-full h-full group/pane">
                          <Terminal
                            id={termId}
                            onInput={(b64) => handleTermInput(termId, b64)}
                            onResize={(cols, rows) => handleTermResize(termId, cols, rows)}
                            onMounted={(writeFn) => handleTermMounted(termId, writeFn)}
                          />
                          {#if tiling.count > 1}
                            <button
                              class="group/closebtn absolute top-1.5 right-3 z-50 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-[#3c3f41] hover:bg-[#4c5052] opacity-0 group-hover/pane:opacity-100 transition-opacity cursor-pointer border-none pointer-events-auto shadow-sm"
                              title="Close terminal"
                              onclick={(e) => { e.stopPropagation(); handleCloseTerm(termId); }}
                            >
                              <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" class="group-hover/closebtn:[stroke:#ff5f57]">
                                <line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/>
                              </svg>
                            </button>
                          {/if}
                        </div>
                      {/snippet}
                    </TerminalLayout>
                  {/if}
                </div>
              </div>

              {#if runEditOpen}
                <div class="flex-1 flex flex-col min-h-0 overflow-hidden bg-jb-bg z-50">
                  <div class="flex items-center gap-2 bg-jb-panel h-[26px] border-b border-jb-border flex-shrink-0 px-3 text-[11px] text-jb-muted">
                    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1v10M1 6h10"/></svg>
                    <span class="text-jb-text">Edit Run Configurations</span>
                    <button
                      onclick={() => runEditOpen = false}
                      class="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-jb-border/50 text-jb-muted hover:bg-jb-border hover:text-jb-text border-none cursor-pointer"
                    >Close</button>
                  </div>
                  <div class="flex-1 overflow-y-auto px-3 py-3">
                    <div class="text-[12px] text-jb-text mb-3">Current configurations:</div>
                    <div class="space-y-2">
                      {#each runConfigs as cfg, i}
                        <div class="flex items-center gap-2">
                          <svg viewBox="0 0 12 12" width="10" height="10" fill="#629755"><polygon points="2,1 10,6 2,11"/></svg>
                          <span class="flex-1 text-[12px] text-jb-text font-mono">{cfg}</span>
                          <button
                            onclick={() => { runConfigs = runConfigs.filter((_, idx) => idx !== i); }}
                            class="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30 border-none cursor-pointer"
                          >Remove</button>
                        </div>
                      {/each}
                    </div>
                    <div class="mt-4 pt-3 border-t border-jb-border">
                      <div class="text-[12px] text-jb-text mb-2">Add new configuration:</div>
                      <div class="flex items-center gap-2">
                        <input
                          bind:value={newConfig}
                          placeholder="e.g., bun run dev"
                          class="flex-1 px-2 py-1 text-[12px] bg-jb-panel border border-jb-border rounded text-jb-text placeholder:text-jb-muted focus:outline-none focus:border-jb-blue"
                        />
                        <button
                          onclick={() => { if (newConfig.trim()) { runConfigs = [...runConfigs, newConfig.trim()]; newConfig = ""; } }}
                          class="px-2 py-1 rounded text-[11px] bg-jb-green/20 text-jb-green hover:bg-jb-green/30 border-none cursor-pointer"
                        >Add</button>
                      </div>
                    </div>
                  </div>
                </div>

              {:else if ws.activeBottom === "problems"}
                <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div class="flex items-center bg-jb-panel h-[26px] border-b border-jb-border flex-shrink-0 px-3 gap-2 text-[11px] text-jb-muted">
                    <span>Scope: Current File</span>
                    <span class="text-jb-green ml-auto">✓ No problems</span>
                  </div>
                  <div class="flex items-center justify-center h-full text-jb-muted text-[12px] gap-2">
                    <svg viewBox="0 0 16 16" width="18" height="18" fill="#629755"><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm3.5 4.5l-5 5-2-2-.7.7 2.7 2.7 5.7-5.7z"/></svg>
                    No problems found.
                  </div>
                </div>

              {:else if ws.activeBottom === "git"}
                <div class="flex-1 overflow-y-auto px-3 py-2 text-[12px]">
                  {#if !gitIsRepo}
                    <div class="flex items-center justify-center h-full text-jb-muted text-[12px]">
                      Not a git repository
                    </div>
                  {:else}
                    <div class="text-jb-muted text-[11px] font-semibold mb-2">CURRENT BRANCH</div>
                    <div class="flex items-center gap-2 h-[22px] px-1 rounded bg-jb-hover">
                      <span class="text-[9px] text-jb-green">●</span>
                      <span class="text-jb-text font-medium">{gitBranch}</span>
                    </div>
                    <div class="mt-3 text-[11px] font-semibold text-jb-muted mb-2">STAGED CHANGES</div>
                    {#if gitChanges.filter(c => c.status !== "untracked" && c.index !== "?").length === 0}
                      <div class="text-[11px] text-jb-muted italic px-1">No staged changes</div>
                    {:else}
                      {#each gitChanges.filter(c => c.status !== "untracked" && c.index !== "?") as change}
                        <div class="flex items-center gap-2 h-[22px] px-1 rounded hover:bg-jb-hover">
                          <span class="font-bold text-[10px] w-3 text-center" style="color:{gitStatusColor(change.status)}">{gitStatusLetter(change.status)}</span>
                          <span class="text-jb-text text-[12px]">{change.path}</span>
                        </div>
                      {/each}
                    {/if}
                    <div class="mt-3 pt-2 border-t border-jb-border">
                      <div class="text-[11px] font-semibold text-jb-muted mb-2">UNSTAGED CHANGES</div>
                      {#if gitChanges.filter(c => c.status === "untracked" || c.workingTree === "?").length === 0}
                        <div class="text-[11px] text-jb-muted italic px-1">No unstaged changes</div>
                      {:else}
                        {#each gitChanges.filter(c => c.status === "untracked" || c.workingTree === "?") as change}
                          <div class="flex items-center gap-2 h-[22px] px-1 rounded hover:bg-jb-hover">
                            <span class="font-bold text-[10px] w-3 text-center" style="color:{gitStatusColor(change.status)}">{gitStatusLetter(change.status)}</span>
                            <span class="text-jb-text text-[12px]">{change.path}</span>
                          </div>
                        {/each}
                      {/if}
                    </div>
                  {/if}
                </div>

              {:else if ws.activeBottom === "run"}
                <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div class="flex items-center gap-2 bg-jb-panel h-[26px] border-b border-jb-border flex-shrink-0 px-3 text-[11px] text-jb-muted">
                    <svg viewBox="0 0 12 12" width="10" height="10" fill="#629755"><polygon points="2,1 10,6 2,11"/></svg>
                    <span class="text-jb-text">{ws.selectedConfig}</span>
                    <button
                      onclick={() => { runOutput = []; handleRunExecute(ws.selectedConfig); }}
                      class="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-jb-green/20 text-jb-green hover:bg-jb-green/30 border-none cursor-pointer"
                    >Run Again</button>
                    <button
                      onclick={() => { onUpdate({ activeBottom: "terminal" }); }}
                      class="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-jb-border/50 text-jb-muted hover:bg-jb-border hover:text-jb-text border-none cursor-pointer"
                    >Go to Terminal</button>
                  </div>
                  <div class="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed bg-jb-bg">
                    {#if runOutput.length > 0}
                      {#each runOutput as line}
                        <div class="text-jb-text whitespace-pre-wrap">{line}</div>
                      {/each}
                    {:else}
                      <div class="text-jb-muted text-[12px] italic">
                        Click "Run" or "Run Again" to execute: <span class="text-jb-text">{ws.selectedConfig}</span>
                      </div>
                      <div class="mt-3 text-jb-muted text-[11px]">
                        Configure run commands in the toolbar dropdown.
                      </div>
                    {/if}
                  </div>
                </div>

                            {:else if ws.activeBottom !== "terminal"}
                <div class="flex items-center justify-center h-full text-jb-muted text-[12px]">No services configured.</div>
              {/if}

            </div>
          </div><!-- end bottom panel -->

    </div><!-- end center column -->

    <!-- ── RIGHT TOOL WINDOW (AI Chat) ── -->
    {#if ws.rightPanelOpen}
      <div
        class="flex flex-col bg-jb-panel border-l border-jb-border flex-shrink-0 min-h-0 relative"
        style:width="{ws.rightWidth}px"
      >
        <ChatPanel
          onClose={() => onUpdate({ rightPanelOpen: false })}
          activeTab={activeTab ? { path: activeTab.path, name: activeTab.name, content: activeTab.content } : null}
          onApplyDiff={(diff) => {
            console.log("Apply diff:", diff);
          }}
          onRejectDiff={(diff) => {
            console.log("Reject diff:", diff);
          }}
        />
        <div
          class="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-jb-blue"
          role="slider"
          aria-orientation="vertical"
          aria-label="Resize right panel"
          aria-valuenow={ws.rightWidth}
          aria-valuemin={150}
          aria-valuemax={550}
          tabindex="0"
          onmousedown={(e) => { resizingRight = true; e.preventDefault(); }}
          style="left:-2px; position:absolute; top:0; bottom:0; width:4px;"
        ></div>
      </div>
    {/if}

    <!-- ── RIGHT TOOL STRIP ── -->
    <div class="flex flex-col justify-between bg-jb-panel border-l border-jb-border flex-shrink-0 w-[25px]">
      <div class="flex flex-col items-center pt-1">
        {#each [
          { id:"chat",      num:"5", label:"AI Chat" },
          { id:"npm",       num:"6", label:"npm" },
          { id:"endpoints", num:"7", label:"Endpoints" },
        ] as rt}
          <button
            title={rt.label}
            onclick={() => {
              if (ws.rightPanelOpen) {
                onUpdate({ rightPanelOpen: false });
              } else {
                onUpdate({ rightPanelOpen: true });
              }
            }}
            class="flex items-center justify-center px-1 py-2.5 text-[11px] cursor-pointer border-none bg-transparent w-full
              {rt.id === 'chat' && ws.rightPanelOpen
                ? 'text-jb-text2 bg-jb-active'
                : 'text-jb-muted hover:text-jb-text hover:bg-jb-hover'}"
          >
            <span class="[writing-mode:vertical-rl] font-medium tracking-wide whitespace-nowrap leading-none text-[11px]">
              {rt.num}: {rt.label}
            </span>
          </button>
        {/each}
      </div>
    </div>

  </div><!-- end body -->

  <!-- ══ BOTTOM TOOL STRIP ════════════════════════════════════ -->
  <div class="relative flex items-center h-[27px] bg-jb-panel border-t border-jb-border flex-shrink-0 px-1">
    <div class="flex items-center gap-0.5">
      <button
        title={ws.leftPanelOpen ? "Hide left sidebar" : "Show left sidebar"}
        class="flex items-center justify-center w-[26px] h-[22px] text-[12px] font-medium border-none bg-transparent cursor-pointer transition-colors rounded
          {ws.leftPanelOpen
            ? 'text-jb-text2 bg-jb-hover'
            : 'text-jb-muted hover:text-jb-text hover:bg-jb-hover'}"
        onclick={() => onUpdate({ leftPanelOpen: !ws.leftPanelOpen })}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="1.5" y="1.5" width="13" height="13" rx="1.5"/>
          <line x1="5" y1="1.5" x2="5" y2="14.5"/>
        </svg>
      </button>
      <!-- Toolbar toggle — placed before the bottom panel toggle -->
      <button
        title={toolbarOpen ? "Hide toolbar" : "Show toolbar"}
        class="flex items-center justify-center w-[26px] h-[22px] border-none bg-transparent cursor-pointer transition-colors rounded
          {toolbarOpen ? 'text-jb-text2 bg-jb-hover' : 'text-jb-muted hover:text-jb-text hover:bg-jb-hover'}"
        onclick={() => toolbarOpen = !toolbarOpen}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="1.5" y="1.5" width="13" height="13" rx="1.5"/>
          <line x1="1.5" y1="5.5" x2="14.5" y2="5.5"/>
        </svg>
      </button>
      <button
        title={ws.bottomPanelOpen ? "Hide bottom panel" : "Show bottom panel"}
        class="flex items-center justify-center w-[26px] h-[22px] text-[12px] font-medium border-none bg-transparent cursor-pointer transition-colors rounded
          {ws.bottomPanelOpen
            ? 'text-jb-text2 bg-jb-hover'
            : 'text-jb-muted hover:text-jb-text hover:bg-jb-hover'}"
        onclick={() => onUpdate({ bottomPanelOpen: !ws.bottomPanelOpen })}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="1.5" y="1.5" width="13" height="13" rx="1.5"/>
          <line x1="1.5" y1="10" x2="14.5" y2="10"/>
        </svg>
      </button>
      <button
        title={ws.rightPanelOpen ? "Hide right sidebar" : "Show right sidebar"}
        class="flex items-center justify-center w-[26px] h-[22px] text-[12px] font-medium border-none bg-transparent cursor-pointer transition-colors rounded
          {ws.rightPanelOpen
            ? 'text-jb-text2 bg-jb-hover'
            : 'text-jb-muted hover:text-jb-text hover:bg-jb-hover'}"
        onclick={() => onUpdate({ rightPanelOpen: !ws.rightPanelOpen })}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="1.5" y="1.5" width="13" height="13" rx="1.5"/>
          <line x1="11" y1="1.5" x2="11" y2="14.5"/>
        </svg>
      </button>
    </div>

    <!-- Center: mode tabs -->
    <div class="absolute left-1/2 -translate-x-1/2 flex items-center">
      <div class="flex items-center bg-jb-panel2 rounded-md p-0.5 gap-0.5 border border-jb-border">
        {#each [{ id: "editor", label: "Editor" }, { id: "agent", label: "Agent" }] as tab}
          <button
            onclick={() => workspaceStore.mode = tab.id as "editor" | "agent"}
            class="px-3 h-[20px] text-[11px] font-medium rounded cursor-pointer border-none transition-colors
              {mode === tab.id
                ? 'text-jb-text bg-jb-active'
                : 'text-jb-muted hover:text-jb-text bg-transparent'}"
          >{tab.label}</button>
        {/each}
      </div>
    </div>

    <div class="flex-1"></div>
  </div>

  <!-- ══ STATUS BAR ══════════════════════════════════════════ -->
  <footer class="flex items-center justify-between h-[22px] bg-jb-panel2 border-t border-jb-border flex-shrink-0 px-2 text-[11px]">
    <!-- Left -->
    <div class="flex items-center gap-0">
      <button title="Git Branch" class="flex items-center gap-1.5 px-2 h-[22px] text-jb-text hover:bg-jb-hover rounded cursor-pointer bg-transparent border-none font-[inherit] text-[11px]">
        <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="3.5" cy="3.5" r="1.5"/><circle cx="10.5" cy="3.5" r="1.5"/>
          <circle cx="3.5" cy="10.5" r="1.5"/>
          <path d="M3.5 5v3.5M5 3.5h3.5a2 2 0 0 1 2 2v1.5"/>
        </svg>
        main
      </button>
      <button title="Fetch" class="flex items-center px-1.5 h-[22px] text-jb-muted hover:bg-jb-hover rounded cursor-pointer bg-transparent border-none text-[10px]">
        ↕ 0↑ 0↓
      </button>

      <div class="w-px h-3.5 bg-jb-border mx-1"></div>

      <span class="px-2 text-jb-muted flex items-center gap-1">
        <svg viewBox="0 0 12 12" width="10" height="10" fill="#629755"><path d="M6 1a5 5 0 1 1 0 10A5 5 0 0 1 6 1zm2.5 3l-3.5 3.5-1.5-1.5-.7.7 2.2 2.2 4.2-4.2z"/></svg>
        Svelte · No problems
      </span>
    </div>
    <!-- Right -->
    <div class="flex items-center gap-0">
      {#each [
        { label:"1:1", title:"Go to Line" },
        { label:"LF", title:"Line Separator" },
        { label:"UTF-8", title:"File Encoding" },
        { label:"2 spaces", title:"Indent" },
      ] as si}
        <button title={si.title} class="px-2 h-[22px] text-jb-muted hover:bg-jb-hover hover:text-jb-text rounded cursor-pointer bg-transparent border-none font-[inherit] text-[11px] whitespace-nowrap">
          {si.label}
        </button>
      {/each}
      <div class="w-px h-3.5 bg-jb-border mx-1"></div>
      <button title="Svelte" class="flex items-center gap-1 px-2 h-[22px] text-jb-muted hover:bg-jb-hover hover:text-jb-text rounded cursor-pointer bg-transparent border-none font-[inherit] text-[11px]">
        <span style="color:#ff6b6b; font-weight:bold;">S</span> Svelte
      </button>
      <button title="Code Style: Prettier" class="px-2 h-[22px] text-jb-muted hover:bg-jb-hover hover:text-jb-text rounded cursor-pointer bg-transparent border-none font-[inherit] text-[11px]">
        Prettier
      </button>
      <button title="Inspections: No errors" class="flex items-center gap-1 px-2 h-[22px] text-jb-green hover:bg-jb-hover rounded cursor-pointer bg-transparent border-none font-[inherit] text-[11px]">
        <svg viewBox="0 0 12 12" width="11" height="11" fill="currentColor">
          <path d="M6 1a5 5 0 1 1 0 10A5 5 0 0 1 6 1zm2.5 3l-3.5 3.5-1.5-1.5-.7.7 2.2 2.2 4.2-4.2z"/>
        </svg>
        0
      </button>
    </div>
  </footer>

</div>

<style>
  /* Electron drag regions */
  .titlebar { -webkit-app-region: drag; }
  .no-drag  { -webkit-app-region: no-drag; }

  /* Toolbar & strip buttons don't drag */
  button { -webkit-app-region: no-drag; }

  /* Agent streaming dots */
  @keyframes agent-pulse {
    0%, 100% { opacity: 0.3; transform: scale(0.8); }
    50%       { opacity: 1;   transform: scale(1); }
  }
  .agent-dot {
    animation: agent-pulse 1.2s ease-in-out infinite;
  }
</style>
