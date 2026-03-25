<script lang="ts">
  import { onMount } from "svelte";
  import FileTree from "./FileTree.svelte";
  import type { WorkspaceState } from "../stores/workspaceStore.svelte";

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

  // ── File tree ────────────────────────────────────────────────
  const fileTree = [
    { name:"ultimate_editor", type:"folder" as const, key:"src", children:[
      { name:"src", type:"folder" as const, key:"mainview", children:[
        { name:"mainview", type:"folder" as const, key:"mw", children:[
          { name:"pages", type:"folder" as const, key:"pages", children:[
            { name:"index.svelte",    type:"file" as const, icon:"svelte", route:"/" },
            { name:"triangle.svelte", type:"file" as const, icon:"svelte", route:"/triangle" },
          ]},
          { name:"components", type:"folder" as const, key:"components", children:[
            { name:"EditorLayout.svelte", type:"file" as const, icon:"svelte", route:null },
            { name:"FileTree.svelte",     type:"file" as const, icon:"svelte", route:null },
          ]},
          { name:"App.svelte", type:"file" as const, icon:"svelte", route:null },
          { name:"app.css",    type:"file" as const, icon:"css",    route:null },
          { name:"main.ts",    type:"file" as const, icon:"ts",     route:null },
        ]},
        { name:"bun", type:"folder" as const, key:"bun", children:[
          { name:"index.ts",           type:"file" as const, icon:"ts", route:null },
          { name:"webgpu-renderer.ts", type:"file" as const, icon:"ts", route:null },
        ]},
      ]},
      { name:"External Libraries", type:"folder" as const, key:"ext", children:[
        { name:"svelte 5.14.1",          type:"file" as const, icon:"svelte", route:null },
        { name:"tailwindcss 4.2.2",      type:"file" as const, icon:"css",   route:null },
        { name:"vite 6.0.3",             type:"file" as const, icon:"ts",    route:null },
      ]},
    ]},
    { name:"package.json",     type:"file" as const, icon:"json", route:null },
    { name:"vite.config.ts",   type:"file" as const, icon:"ts",   route:null },
    { name:"svelte.config.js", type:"file" as const, icon:"js",   route:null },
    { name:"tsconfig.json",    type:"file" as const, icon:"json", route:null },
  ];

  // ── Tabs ─────────────────────────────────────────────────────
  const tabs = [
    { name:"index.svelte",    icon:"svelte", route:"/" },
    { name:"triangle.svelte", icon:"svelte", route:"/triangle" },
  ];
  let activeTabName = $derived(
    tabs.find(t => t.route === ws.activeRoute)?.name ?? tabs[0].name
  );
  function iconColor(icon: string) {
    return ({ svelte:"#ff6b6b", ts:"#4e9ede", js:"#ffc66d", css:"#9876aa", json:"#aed9b8" } as Record<string,string>)[icon] ?? "#a9b7c6";
  }

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

  // ── Terminal output ───────────────────────────────────────
  const termLines = [
    { t: "$ bun run dev",                          c: "#a9b7c6" },
    { t: "  ➜  Electrobun v1.16.0 starting...",    c: "#629755" },
    { t: "  ➜  Local:   http://localhost:5173/",   c: "#4e9ede" },
    { t: "  ➜  Network: use --host to expose",     c: "#808080" },
    { t: "  ➜  watching for file changes...",      c: "#629755" },
    { t: "",                                       c: "" },
    { t: "Process finished with exit code 0",      c: "#808080" },
    { t: "",                                       c: "" },
    { t: "$ ▌",                                    c: "#a9b7c6" },
  ];
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

    <!-- LEFT: nav wrapper (flex-1, overflow-hidden) -->
    <div bind:this={navWrapEl} class="no-drag flex items-center flex-1 min-w-0 overflow-hidden pl-1 relative">
      {#if navOverflows}
        <!-- Hamburger -->
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
      {:else}
        <!-- Full nav — hidden via overflow-hidden if it grows past its container -->
        <nav bind:this={navEl} class="flex items-center gap-0">
          {#each ["File","Edit","View","Navigate","Code","Refactor","Build","Run","Tools","Git","Window","Help"] as m}
            <span class="px-2 py-0.5 text-[12px] text-jb-text cursor-pointer rounded hover:bg-jb-hover whitespace-nowrap">
              {m}
            </span>
          {/each}
        </nav>
      {/if}
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
        <!-- Tool window header -->
        <div class="flex items-center justify-between px-2 h-[30px] bg-jb-panel2 border-b border-jb-border flex-shrink-0">
          <div class="flex items-center gap-2">
            {#if ws.activeTool === "project"}
              <span class="text-[12px] font-semibold text-jb-text2">Project</span>
            {:else if ws.activeTool === "structure"}
              <span class="text-[12px] font-semibold text-jb-text2">Structure</span>
            {:else if ws.activeTool === "git"}
              <span class="text-[12px] font-semibold text-jb-text2">Git</span>
            {:else}
              <span class="text-[12px] font-semibold text-jb-text2">Bookmarks</span>
            {/if}
          </div>
          <!-- Header actions -->
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

          {#if ws.activeTool === "project"}
            <!-- Project tree -->
            <div class="flex items-center gap-1 px-2 py-0.5 text-[11px] text-jb-muted">
              <svg viewBox="0 0 12 12" width="12" height="12" fill="#4e9ede" opacity="0.7">
                <rect x="0.5" y="1.5" width="11" height="9" rx="1"/>
                <rect x="0.5" y="1.5" width="5" height="3" rx="1" fill="#6aaddc"/>
              </svg>
              <span class="font-semibold text-jb-text">ultimate_editor</span>
              <span class="ml-auto text-jb-dim text-[10px]">~/Documents</span>
            </div>
            <FileTree
              nodes={fileTree}
              expandedFolders={ws.expandedFolders}
              onToggleFolder={(key) => {
                const updated = { ...ws.expandedFolders, [key]: !ws.expandedFolders[key] };
                onUpdate({ expandedFolders: updated });
              }}
              activeRoute={ws.activeRoute}
            />
            <!-- Scratches section -->
            <div class="flex items-center gap-1 px-2 py-0.5 text-[11px] text-jb-muted cursor-pointer hover:bg-jb-hover mt-1">
              <span class="text-[11px] text-jb-muted w-3 text-center">▶</span>
              <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="#808080" stroke-width="1">
                <path d="M2 2h10v10H2z"/><path d="M5 5h4M5 8h3"/>
              </svg>
              <span>Scratches and Consoles</span>
            </div>

          {:else if ws.activeTool === "structure"}
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

        </div>

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
      <div class="flex items-center h-[26px] bg-jb-panel border-b border-jb-border flex-shrink-0 px-3 gap-1 text-[12px]">
        <svg viewBox="0 0 12 12" width="12" height="12" fill="#4e9ede" class="flex-shrink-0">
          <rect x="0.5" y="1.5" width="11" height="9" rx="1"/><rect x="0.5" y="1.5" width="5" height="3" rx="1" fill="#6aaddc"/>
        </svg>
        <span class="text-jb-muted cursor-pointer hover:text-jb-text hover:underline">ultimate_editor</span>
        <span class="text-jb-dim">›</span>
        <span class="text-jb-muted cursor-pointer hover:text-jb-text hover:underline">src</span>
        <span class="text-jb-dim">›</span>
        <span class="text-jb-muted cursor-pointer hover:text-jb-text hover:underline">mainview</span>
        <span class="text-jb-dim">›</span>
        <span class="text-jb-muted cursor-pointer hover:text-jb-text hover:underline">pages</span>
        <span class="text-jb-dim">›</span>
        <span class="text-jb-text font-medium">{activeTabName}</span>
      </div>

      <!-- ── EDITOR TABS ── -->
      <div class="flex items-end bg-jb-panel border-b border-jb-border flex-shrink-0 overflow-x-auto min-h-[32px]">
        {#each tabs as tab}
          <a
            href="#{tab.route}"
            class="group flex items-center gap-1.5 px-3 h-[32px] text-[13px] no-underline border-r border-jb-border flex-shrink-0 whitespace-nowrap relative transition-colors duration-100
              {activeTabName === tab.name
                ? 'bg-jb-bg text-jb-text2 border-t-2 border-t-jb-blue'
                : 'bg-jb-panel text-jb-muted hover:bg-jb-hover hover:text-jb-text'}"
          >
            <span class="text-[9px] font-bold" style="color:{iconColor(tab.icon)}">●</span>
            <span>{tab.name}</span>
            <button
              class="ml-1 text-[13px] leading-none bg-transparent border-none cursor-pointer px-0.5 rounded text-transparent group-hover:text-jb-muted hover:!text-jb-text hover:bg-jb-hover"
              onclick={(e) => e.preventDefault()}
            >×</button>
          </a>
        {/each}
        <div class="flex-1 bg-jb-panel"></div>
        <!-- Editor actions -->
        <div class="flex items-center px-2 gap-1 flex-shrink-0 h-[32px]">
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

        <!-- Editor area -->
        <div class="flex-1 flex min-h-0 overflow-hidden bg-jb-bg">

          <!-- Gutter: breakpoints + line numbers + folding + git diff -->
          <div
            aria-hidden="true"
            class="flex-shrink-0 bg-jb-bg border-r border-jb-border2 select-none overflow-hidden flex"
          >
            <!-- Breakpoint area -->
            <div class="w-[14px] bg-jb-bg flex flex-col pt-2">
              {#each {length: 60} as _, i}
                <div class="h-[20.8px] flex items-center justify-center">
                  {#if i === 4 || i === 11}
                    <span class="w-2.5 h-2.5 rounded-full bg-[#ff6b68] inline-block"></span>
                  {/if}
                </div>
              {/each}
            </div>
            <!-- Line numbers -->
            <div class="w-[38px] text-right pr-2 pt-2 text-[12px] font-mono text-jb-dim leading-[1.6]">
              {#each {length: 60} as _, i}
                <div class="h-[20.8px]">{i + 1}</div>
              {/each}
            </div>
            <!-- Git diff markers -->
            <div class="w-[3px] flex flex-col pt-2">
              {#each {length: 60} as _, i}
                <div class="h-[20.8px]">
                  {#if i >= 2 && i <= 5}
                    <div class="h-full bg-[#629755] w-full opacity-80"></div>
                  {:else if i === 9}
                    <div class="h-full bg-[#ffc66d] w-full opacity-80"></div>
                  {/if}
                </div>
              {/each}
            </div>
            <!-- Folding area -->
            <div class="w-[14px] flex flex-col pt-2 text-jb-dim text-[10px]">
              {#each {length: 60} as _, i}
                <div class="h-[20.8px] flex items-center justify-center cursor-pointer hover:text-jb-text">
                  {#if i === 0 || i === 7 || i === 20}
                    <span>−</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>

          <!-- Editor content -->
          <div class="flex-1 overflow-auto p-2 pl-3 text-[13px] leading-relaxed select-text font-[inherit]">
            {@render children()}
          </div>

          <!-- Right error stripe -->
          <div class="w-[14px] bg-jb-panel flex-shrink-0 flex flex-col border-l border-jb-border relative">
            {#each [{pct: 12, c:"#629755"},{pct: 45, c:"#ffc66d"},{pct: 70, c:"#ff6b68"}] as mark}
              <div
                class="absolute w-full h-[3px] rounded-sm"
                style="top:{mark.pct}%; background:{mark.c}; opacity:0.7"
              ></div>
            {/each}
            <div class="absolute top-[8%] w-full h-[5%] bg-[#4e9ede] opacity-40 rounded-sm"></div>
          </div>

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
            class="bg-jb-bg border-t border-jb-border flex flex-col flex-shrink-0 overflow-hidden"
            style:height="{ws.bottomHeight}px"
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
              <button title="Maximize" class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]">⤢</button>
              <button title="Restore layout" class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]">⊟</button>
              <button title="Close" onclick={() => onUpdate({ bottomPanelOpen: false })}
                class="w-6 h-6 flex items-center justify-center rounded text-jb-muted hover:bg-jb-hover hover:text-jb-text bg-transparent border-none cursor-pointer text-[11px]">✕</button>
            </div>

            <!-- Panel body -->
            <div class="flex-1 flex flex-col min-h-0 overflow-hidden">

              {#if ws.activeBottom === "terminal"}
                <div class="flex flex-col h-full">
                  <div class="flex items-center bg-jb-panel h-[26px] border-b border-jb-border flex-shrink-0 px-2 gap-1 text-[11px]">
                    <span class="text-jb-text font-medium border-b border-jb-blue pb-px px-1">Local</span>
                    <span class="text-jb-muted ml-1">— zsh</span>
                    <button class="ml-auto bg-transparent border-none text-jb-muted cursor-pointer hover:text-jb-text px-1 text-[13px]">＋</button>
                    <button class="bg-transparent border-none text-jb-muted cursor-pointer hover:text-jb-text px-1">⊟</button>
                  </div>
                  <div class="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed bg-jb-bg">
                    {#each termLines as line}
                      <div class="whitespace-pre" style:color={line.c || "#a9b7c6"}>{line.t}</div>
                    {/each}
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
                    {#each termLines.slice(0,5) as line}
                      <div class="whitespace-pre" style:color={line.c || "#a9b7c6"}>{line.t}</div>
                    {/each}
                  </div>
                </div>

              {:else}
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
