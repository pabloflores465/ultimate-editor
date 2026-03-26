<script lang="ts">
  import { onMount } from "svelte";
  import FileTree from "./FileTree.svelte";
  import Sidebar from "./Sidebar.svelte";
  import Terminal from "./Terminal.svelte";
  import CodeEditor from "./CodeEditor.svelte";
  import type { WorkspaceState } from "../stores/workspaceStore.svelte";
  import { workspaceStore } from "../stores/workspaceStore.svelte";
  import { Electroview } from "electrobun/view";

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
  let resizingBottom = $state(false);
  let runConfigOpen  = $state(false);
  let hamburgerOpen  = $state(false);
  let hasProject     = $state(false);

  // (file tree is now managed by Sidebar.svelte)

  // ── Editor icon colors ────────────────────────────────────────
  function iconColor(icon: string) {
    return ({ svelte:"#ff6b6b", ts:"#4e9ede", tsx:"#4e9ede", js:"#ffc66d", jsx:"#ffc66d", css:"#9876aa", scss:"#9876aa", json:"#aed9b8", html:"#cc7832", md:"#a9b7c6" } as Record<string,string>)[icon] ?? "#a9b7c6";
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
  const runConfigs = ["bun run dev", "bun run build", "bun run hmr"];

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
      if (resizingBottom) {
        const root = document.getElementById("jb-root");
        if (!root) return;
        const newH = root.getBoundingClientRect().bottom - e.clientY - 50;
        if (newH > 60 && newH < 550) onUpdate({ bottomHeight: newH });
      }
    };
    const onUp = () => { resizingLeft = false; resizingBottom = false; };
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
      };
    };
    webview: {
      requests: Record<string, never>;
      messages: {
        "terminal:output": { data: string; workspaceId: string };
        "menu:open-settings": Record<string, never>;
        "menu:new-file": Record<string, never>;
        "menu:open-file": Record<string, never>;
        "menu:save-file": Record<string, never>;
      };
    };
  };

  // ── Multi-terminal state ──────────────────────────────────────────────────
  interface TermPane {
    id: string;
    label: string;
    writeFn: ((b64: string) => void) | null;
  }

  let termCounter = 0;
  function newTermId() { return `${ws.id}_t${termCounter++}`; }

  const _initId = newTermId();
  let termTabs  = $state<TermPane[]>([{ id: _initId, label: "zsh", writeFn: null }]);
  let activeTermId = $state(_initId);

  // Split pane: shown alongside the active tab
  let splitPane = $state<TermPane | null>(null);
  let splitDir  = $state<"vertical" | "horizontal">("vertical");

  // Bottom panel maximize
  let bottomMaximized = $state(false);
  let termFullscreen  = $state(false);

  const termRpc = Electroview.defineRPC<AppSchema>({
    handlers: {
      messages: {
        "terminal:output": ({ data, workspaceId: termId }) => {
          const tab = termTabs.find(t => t.id === termId);
          if (tab?.writeFn) { tab.writeFn(data); return; }
          if (splitPane?.id === termId) splitPane.writeFn?.(data);
        },
        "menu:open-settings": () => { /* TODO */ },
        "menu:new-file":      () => { /* TODO */ },
        "menu:open-file":     () => { /* TODO */ },
        "menu:save-file":     () => { saveCurrentFile(); },
      },
    },
  });

  new Electroview({ rpc: termRpc });

  // ── Per-terminal RPC helpers ──────────────────────────────────────────────
  function makeTermInput(termId: string) {
    return (b64: string) =>
      termRpc.send["terminal:input"]({ data: b64, workspaceId: termId });
  }
  function makeTermResize(termId: string) {
    return (cols: number, rows: number) =>
      termRpc.send["terminal:resize"]({ cols, rows, workspaceId: termId });
  }
  function makeTermMounted(pane: TermPane) {
    return (writeFn: (b64: string) => void) => {
      pane.writeFn = writeFn;
      termRpc.send["terminal:ready"]({ workspaceId: pane.id });
    };
  }

  // ── Terminal tab management ───────────────────────────────────────────────
  function addTermTab() {
    const id = newTermId();
    const pane: TermPane = { id, label: "zsh", writeFn: null };
    termTabs = [...termTabs, pane];
    activeTermId = id;
  }

  function closeTermTab(id: string) {
    const idx = termTabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    const next = termTabs.filter(t => t.id !== id);
    if (next.length === 0) {
      onUpdate({ bottomPanelOpen: false });
      return;
    }
    termTabs = next;
    if (activeTermId === id) {
      activeTermId = next[Math.max(0, idx - 1)].id;
    }
  }

  // ── Split management ──────────────────────────────────────────────────────
  function doSplit(dir: "vertical" | "horizontal") {
    if (splitPane !== null && splitDir === dir) {
      // Same direction → close split
      splitPane = null;
      return;
    }
    if (splitPane === null) {
      // Create new split terminal
      const id = newTermId();
      splitPane = { id, label: "zsh", writeFn: null };
    }
    splitDir = dir;
  }

  function closeSplit() {
    splitPane = null;
  }

  // ── Panel maximize ────────────────────────────────────────────────────────
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
  class="flex flex-col w-screen h-screen bg-jb-bg text-jb-text overflow-hidden text-[13px]"
  style:cursor={resizingLeft ? "col-resize" : resizingBottom ? "row-resize" : "default"}
>

  <!-- ══ TITLE BAR ══════════════════════════════════════════ -->
  <!-- 3-column layout: [left nav] [title] [right spacer]
       Left and right are flex-1 so the title stays centered.
       overflow-hidden on the left column prevents any nav bleed. -->
  <header class="titlebar flex items-center h-[28px] bg-jb-panel flex-shrink-0 border-b border-jb-border">

    <!-- LEFT: nav wrapper (flex-1, overflow-hidden)
         The nav is ALWAYS in the DOM so the ResizeObserver can measure it.
         We toggle visibility between the nav and the hamburger. -->
    <div bind:this={navWrapEl} class="no-drag flex items-center flex-1 min-w-0 overflow-hidden pl-1 relative">

      <!-- Hamburger (visible only when nav overflows) -->
      {#if navOverflows}
        <button
          onclick={() => hamburgerOpen = !hamburgerOpen}
          class="flex flex-col justify-center items-center w-[22px] h-[22px] gap-[4px] rounded hover:bg-jb-hover flex-shrink-0"
          title="Menu"
        >
          <span class="block w-[13px] h-[1.5px] bg-jb-muted rounded"></span>
          <span class="block w-[13px] h-[1.5px] bg-jb-muted rounded"></span>
          <span class="block w-[13px] h-[1.5px] bg-jb-muted rounded"></span>
        </button>
        <!-- Dropdown -->
        {#if hamburgerOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-40" onclick={() => hamburgerOpen = false}></div>
          <div class="absolute top-full left-0 mt-px bg-jb-panel border border-jb-border rounded shadow-lg z-50 py-1 min-w-[160px]">
            {#each ["File","Edit","View","Navigate","Code","Refactor","Build","Run","Tools","Git","Window","Help"] as m}
              <span class="block px-4 py-1.5 text-[12px] text-jb-text cursor-pointer hover:bg-jb-select whitespace-nowrap">
                {m}
              </span>
            {/each}
          </div>
        {/if}
      {/if}

      <!-- Full nav — always in DOM for measurement, hidden when hamburger is active -->
      <nav
        bind:this={navEl}
        class="flex items-center gap-0"
        style:visibility={navOverflows ? "hidden" : "visible"}
        style:position={navOverflows ? "absolute" : "static"}
        style:pointer-events={navOverflows ? "none" : "auto"}
      >
        {#each ["File","Edit","View","Navigate","Code","Refactor","Build","Run","Tools","Git","Window","Help"] as m}
          <span class="px-2 py-0.5 text-[12px] text-jb-text cursor-pointer rounded hover:bg-jb-hover whitespace-nowrap">
            {m}
          </span>
        {/each}
      </nav>

    </div>

    <!-- CENTER: title -->
    <div class="flex-shrink-0 text-[12px] text-jb-muted font-medium pointer-events-none px-4">
      ultimate_editor — WebStorm
    </div>

    <!-- RIGHT: mirror spacer to keep title centered -->
    <div class="flex-1 min-w-0"></div>

  </header>

  <!-- ══ MAIN TOOLBAR ══════════════════════════════════════ -->
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
        </div>
      {/if}
    </div>

    <!-- Run -->
    <button title="Run '{ws.selectedConfig}' (⌘R)" class="flex items-center justify-center w-[28px] h-[28px] rounded hover:bg-jb-hover">
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

    <!-- Right-side: workspace switcher button + notifications -->
    <div class="ml-auto flex items-center gap-1">
      <!-- Workspace overview button -->
      <button
        title="Workspace Overview (Ctrl+Shift+`)"
        onclick={onOpenOverview}
        class="ws-indicator no-drag"
      >
        <!-- 2×2 grid icon -->
        <svg viewBox="0 0 14 14" width="13" height="13" fill="currentColor">
          <rect x="1" y="1" width="5" height="5" rx="0.7" opacity="0.95"/>
          <rect x="8" y="1" width="5" height="5" rx="0.7" opacity="0.5"/>
          <rect x="1" y="8" width="5" height="5" rx="0.7" opacity="0.5"/>
          <rect x="8" y="8" width="5" height="5" rx="0.7" opacity="0.5"/>
        </svg>
        <span>{ws.name}</span>
      </button>

      <div class="w-px h-4 bg-jb-border mx-0.5"></div>

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
          <!-- ── SIDEBAR (self-contained: owns its header + file dialog) ── -->
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
              workspaceStore.openFile(path, name, icon, content)
            }
            onProjectChange={(v) => (hasProject = v)}
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
            <div class="px-2 py-2">
              <div class="text-[11px] font-semibold text-jb-muted mb-2 px-1">LOCAL CHANGES</div>
              {#each [
                { s:"M", n:"App.svelte",         color:"#e2c08d" },
                { s:"M", n:"app.css",             color:"#e2c08d" },
                { s:"A", n:"EditorLayout.svelte", color:"#629755" },
                { s:"A", n:"FileTree.svelte",     color:"#629755" },
              ] as f}
                <div class="flex items-center gap-2 h-[22px] px-2 rounded text-[12px] hover:bg-jb-hover cursor-pointer">
                  <span class="font-bold text-[11px] w-3 text-center" style="color:{f.color}">{f.s}</span>
                  <span class="text-jb-text">{f.n}</span>
                </div>
              {/each}
              <div class="mt-3 text-[11px] font-semibold text-jb-muted px-1">LOG</div>
              {#each [
                { hash:"a3f2e1b", msg:"Initial commit",         author:"Pablo",  time:"2 hours ago" },
                { hash:"c891d3a", msg:"Add WebGL triangle page", author:"Pablo",  time:"1 day ago" },
              ] as commit}
                <div class="flex flex-col px-2 py-1 hover:bg-jb-hover rounded cursor-pointer">
                  <div class="flex items-center gap-2 text-[12px]">
                    <span class="text-jb-blue font-mono text-[10px]">{commit.hash}</span>
                    <span class="text-jb-text flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{commit.msg}</span>
                  </div>
                  <div class="text-[11px] text-jb-muted">{commit.author} · {commit.time}</div>
                </div>
              {/each}
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

    <!-- ── EDITOR COLUMN ── -->
    <div class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">

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

      <!-- ── EDITOR + BOTTOM PANEL ── -->
      <div class="flex-1 flex flex-col min-h-0 overflow-hidden">

        <!-- ── EDITOR AREA ── -->
        <div class="flex-1 flex min-h-0 overflow-hidden bg-jb-bg relative">

          {#if activeTab}
            <!-- ── Real CodeMirror editor ── -->
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
            <!-- ── Project open, no file selected: plain dark background ── -->
            <div class="flex-1 bg-jb-bg"></div>

          {:else}
            <!-- ── No project open: empty state message ── -->
            <div class="flex-1 bg-jb-bg flex flex-col items-center justify-center gap-4 select-none pointer-events-none">
              <!-- Folder icon -->
              <svg viewBox="0 0 48 48" width="52" height="52" fill="none" stroke="#4c5052" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="opacity-60">
                <path d="M6 10h12l4 5h20a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3z"/>
              </svg>
              <p class="text-[14px] font-medium" style="color:#5a5d5f">No project open</p>
              <p class="text-[12px]" style="color:#46494a">Open a project or file to start editing</p>
            </div>
          {/if}

        </div><!-- end editor area -->

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

        <!-- Bottom panel content -->
        {#if ws.bottomPanelOpen}
          <div
            class="bg-jb-bg border-t border-jb-border flex flex-col overflow-hidden"
            class:flex-1={bottomMaximized}
            class:flex-shrink-0={!bottomMaximized}
            style:height={bottomMaximized ? undefined : `${ws.bottomHeight}px`}
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
                Tabs use absolute+inset-0+invisible so xterm always has correct size.
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
                <div class="flex items-center bg-jb-panel h-[26px] border-b border-jb-border flex-shrink-0 px-1 gap-0 text-[11px] min-w-0 overflow-hidden">

                  <!-- Terminal tabs -->
                  {#each termTabs as tab}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="flex items-center group h-full flex-shrink-0">
                      <button
                        class="flex items-center gap-1 px-2 h-full bg-transparent border-none cursor-pointer text-[11px] border-b-2 transition-colors
                          {activeTermId === tab.id
                            ? 'text-jb-text border-b-jb-blue'
                            : 'text-jb-muted border-b-transparent hover:text-jb-text hover:bg-jb-hover'}"
                        onclick={() => (activeTermId = tab.id)}
                      >{tab.label}</button>
                      {#if termTabs.length > 1}
                        <button
                          class="w-[14px] h-[14px] flex items-center justify-center rounded bg-transparent border-none cursor-pointer text-jb-muted hover:text-jb-text hover:bg-jb-hover opacity-0 group-hover:opacity-100 text-[9px] -ml-1 mr-1 flex-shrink-0"
                          title="Close terminal"
                          onclick={(e) => { e.stopPropagation(); closeTermTab(tab.id); }}
                        >✕</button>
                      {/if}
                    </div>
                  {/each}

                  <!-- Action buttons -->
                  <div class="flex items-center ml-auto flex-shrink-0 gap-0">
                    <!-- New terminal -->
                    <button
                      title="New terminal"
                      onclick={addTermTab}
                      class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[13px]"
                    >＋</button>
                    <!-- Split vertical (side by side) -->
                    <button
                      title={splitPane && splitDir === "vertical" ? "Close split" : "Split vertically"}
                      onclick={() => doSplit("vertical")}
                      class="w-6 h-6 flex items-center justify-center rounded hover:bg-jb-hover bg-transparent border-none cursor-pointer
                        {splitPane && splitDir === 'vertical' ? 'text-jb-blue' : 'text-jb-muted hover:text-jb-text'}"
                    >
                      <svg viewBox="0 0 14 12" width="13" height="11">
                        <rect x="0.5" y="0.5" width="5.5" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>
                        <rect x="8" y="0.5" width="5.5" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>
                      </svg>
                    </button>
                    <!-- Split horizontal (stacked) -->
                    <button
                      title={splitPane && splitDir === "horizontal" ? "Close split" : "Split horizontally"}
                      onclick={() => doSplit("horizontal")}
                      class="w-6 h-6 flex items-center justify-center rounded hover:bg-jb-hover bg-transparent border-none cursor-pointer
                        {splitPane && splitDir === 'horizontal' ? 'text-jb-blue' : 'text-jb-muted hover:text-jb-text'}"
                    >
                      <svg viewBox="0 0 14 12" width="13" height="11">
                        <rect x="0.5" y="0.5" width="13" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>
                        <rect x="0.5" y="7" width="13" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>
                      </svg>
                    </button>
                    <!-- Fullscreen -->
                    <button
                      title={termFullscreen ? "Exit fullscreen" : "Fullscreen"}
                      onclick={() => (termFullscreen = !termFullscreen)}
                      class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]"
                    >{termFullscreen ? "⊡" : "⤢"}</button>
                  </div>
                </div>

                <!-- ── Pane area: split or single ── -->
                <div
                  class="flex-1 min-h-0 overflow-hidden"
                  class:flex={splitPane !== null}
                  class:flex-row={splitPane !== null && splitDir === "vertical"}
                  class:flex-col={splitPane !== null && splitDir === "horizontal"}
                >
                  <!-- All tab panes: always in DOM, switch via visibility -->
                  <div class="flex-1 min-h-0 min-w-0 overflow-hidden relative">
                    {#each termTabs as tab}
                      <div
                        class="absolute inset-0"
                        class:invisible={tab.id !== activeTermId}
                        class:pointer-events-none={tab.id !== activeTermId}
                      >
                        <Terminal
                          onInput={makeTermInput(tab.id)}
                          onResize={makeTermResize(tab.id)}
                          onMounted={makeTermMounted(tab)}
                        />
                      </div>
                    {/each}
                  </div>

                  <!-- Split pane (mounted only when active) -->
                  {#if splitPane}
                    <!-- Divider -->
                    <div
                      class="flex-shrink-0 bg-jb-border hover:bg-jb-blue transition-colors"
                      class:w-[3px]={splitDir === "vertical"}
                      class:h-[3px]={splitDir === "horizontal"}
                      class:cursor-col-resize={splitDir === "vertical"}
                      class:cursor-row-resize={splitDir === "horizontal"}
                    ></div>
                    <!-- Split terminal -->
                    <div class="flex-1 min-h-0 min-w-0 overflow-hidden relative">
                      <!-- Close split button -->
                      <button
                        title="Close split"
                        onclick={closeSplit}
                        class="absolute top-1 right-1 z-10 w-5 h-5 flex items-center justify-center rounded bg-jb-panel border-none cursor-pointer text-jb-muted hover:text-jb-text hover:bg-jb-hover text-[10px] opacity-0 hover:opacity-100 transition-opacity"
                        style="opacity: 0"
                        onmouseenter={(e) => (e.currentTarget as HTMLElement).style.opacity = "1"}
                        onmouseleave={(e) => (e.currentTarget as HTMLElement).style.opacity = "0"}
                      >✕</button>
                      <Terminal
                        onInput={makeTermInput(splitPane.id)}
                        onResize={makeTermResize(splitPane.id)}
                        onMounted={makeTermMounted(splitPane)}
                      />
                    </div>
                  {/if}
                </div>
              </div>

              {#if ws.activeBottom === "problems"}
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
                  <div class="text-jb-muted text-[11px] font-semibold mb-2">BRANCHES</div>
                  {#each [{ name:"main", active:true },{ name:"feature/jb-layout", active:false }] as br}
                    <div class="flex items-center gap-2 h-[22px] px-1 rounded hover:bg-jb-hover cursor-pointer">
                      {#if br.active}
                        <span class="text-[9px] text-jb-green">●</span>
                      {:else}
                        <span class="text-[9px] text-jb-muted">○</span>
                      {/if}
                      <span class="{br.active ? 'text-jb-text font-medium' : 'text-jb-muted'}">{br.name}</span>
                    </div>
                  {/each}
                </div>

              {:else if ws.activeBottom === "run"}
                <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div class="flex items-center gap-2 bg-jb-panel h-[26px] border-b border-jb-border flex-shrink-0 px-3 text-[11px] text-jb-muted">
                    <svg viewBox="0 0 12 12" width="10" height="10" fill="#629755"><polygon points="2,1 10,6 2,11"/></svg>
                    <span class="text-jb-text">bun run dev</span>
                    <span class="ml-auto text-jb-green">● Running</span>
                  </div>
                  <div class="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed bg-jb-bg">
                    <div class="text-jb-muted text-[12px] italic">No run output yet.</div>
                  </div>
                </div>

              {:else if ws.activeBottom !== "terminal"}
                <div class="flex items-center justify-center h-full text-jb-muted text-[12px]">No services configured.</div>
              {/if}

            </div>
          </div><!-- end bottom panel -->
        {/if}

      </div><!-- end editor + bottom panel -->
    </div><!-- end editor column -->

    <!-- ── RIGHT TOOL STRIP ── -->
    <div class="flex flex-col justify-between bg-jb-panel border-l border-jb-border flex-shrink-0 w-[25px]">
      <div class="flex flex-col items-center pt-1">
        {#each [
          { id:"database",  num:"5", label:"Database" },
          { id:"gradle",    num:"6", label:"npm" },
          { id:"endpoints", num:"7", label:"Endpoints" },
        ] as rt}
          <button
            title={rt.label}
            class="flex items-center justify-center px-1 py-2.5 text-[11px] cursor-pointer border-none bg-transparent w-full text-jb-muted hover:text-jb-text hover:bg-jb-hover"
          >
            <span class="[writing-mode:vertical-rl] font-medium tracking-wide whitespace-nowrap leading-none text-[11px]">
              {rt.num}: {rt.label}
            </span>
          </button>
        {/each}
      </div>
    </div>

  </div><!-- end body -->

  <!-- ══ BOTTOM TOOL STRIP ══════════════════════════════════ -->
  <div class="flex items-center h-[27px] bg-jb-panel border-t border-jb-border flex-shrink-0 px-1">
    {#each bottomTabs as pt}
      <button
        class="flex items-center gap-1.5 px-2.5 h-full text-[12px] font-medium border-none bg-transparent cursor-pointer border-t-2 transition-colors
          {ws.activeBottom === pt.id && ws.bottomPanelOpen
            ? 'text-jb-text2 border-t-jb-blue'
            : 'text-jb-muted border-t-transparent hover:text-jb-text hover:bg-jb-hover'}"
        onclick={() => toggleBottom(pt.id)}
      >
        <span class="text-[11px]">{pt.icon}</span>
        {pt.label}
        {#if pt.badge !== undefined && pt.badge > 0}
          <span class="bg-jb-border rounded-full px-1.5 text-[10px]">{pt.badge}</span>
        {/if}
      </button>
    {/each}
    <div class="flex-1"></div>
    <button title="Event Log" class="flex items-center gap-1 px-2 h-full text-jb-muted hover:text-jb-text text-[11px] border-none bg-transparent cursor-pointer hover:bg-jb-hover">
      <span class="text-jb-green text-[10px]">●</span> Event Log
    </button>
    <button title="Power Save Mode" class="flex items-center gap-1 px-2 h-full text-jb-muted hover:text-jb-text text-[11px] border-none bg-transparent cursor-pointer hover:bg-jb-hover">
      <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
        <circle cx="7" cy="7" r="5.5"/><path d="M7 3v4l2.5 2"/>
      </svg>
    </button>
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
  a      { -webkit-app-region: no-drag; }
</style>
