import { push } from "svelte-spa-router";

// ── Types ──────────────────────────────────────────────────────
export interface EditorTab {
  id: string;
  path: string;
  name: string;
  icon: string;
  content: string;
  modified: boolean;
}

export interface FileNode {
  name: string;
  type: "file" | "folder";
  key?: string;
  icon?: string;
  route?: string | null;
  path?: string;
  children?: FileNode[];
}

export interface ProjectState {
  rootName: string;
  fileNodes: FileNode[];
  rootPath: string;
}

export interface WorkspaceState {
  id: string;
  name: string;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  bottomPanelOpen: boolean;
  activeTool: string;
  activeBottom: string;
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  expandedFolders: Record<string, boolean>;
  activeRoute: string;
  selectedConfig: string;
  openTabs: EditorTab[];
  activeTabId: string | null;
  breakpoints: Record<string, number[]>;
  project: ProjectState;
}

// ── Factory ────────────────────────────────────────────────────
function createWorkspace(name: string): WorkspaceState {
  return {
    id: crypto.randomUUID(),
    name,
    leftPanelOpen: true,
    rightPanelOpen: true,
    bottomPanelOpen: true,
    activeTool: "project",
    activeBottom: "terminal",
    leftWidth: 248,
    rightWidth: 250,
    bottomHeight: 190,
    expandedFolders: {
      src: true, mainview: true, pages: true, components: false, bun: false,
    },
    activeRoute: "/",
    selectedConfig: "bun run dev",
    openTabs: [],
    activeTabId: null,
    breakpoints: {},
    project: {
      rootName: "No folder open",
      fileNodes: [],
      rootPath: "",
    },
  };
}

// ── Store ──────────────────────────────────────────────────────
class WorkspaceStore {
  workspaces = $state<WorkspaceState[]>([createWorkspace("Workspace 1")]);
  activeIndex = $state(0);
  overviewOpen = $state(false);
  mode = $state<"editor" | "agent">("editor");
  /** 1 = new workspace is to the right (slide left), -1 = to the left (slide right) */
  slideDirection = $state<1 | -1>(1);
  /** Incrementing this key forces the {#key} block to re-render with animation */
  transitionKey = $state(0);

  get active(): WorkspaceState {
    return this.workspaces[this.activeIndex];
  }

  switchTo(index: number) {
    if (index === this.activeIndex) return;
    this.slideDirection = index > this.activeIndex ? 1 : -1;
    this.activeIndex = index;
    this.transitionKey++;
    this.overviewOpen = false;
    // Restore the target workspace's route
    push(this.workspaces[index].activeRoute);
  }

  next() {
    this.switchTo((this.activeIndex + 1) % this.workspaces.length);
  }

  prev() {
    this.switchTo(
      (this.activeIndex - 1 + this.workspaces.length) % this.workspaces.length
    );
  }

  addWorkspace() {
    const ws = createWorkspace(`Workspace ${this.workspaces.length + 1}`);
    this.workspaces.push(ws);
    this.switchTo(this.workspaces.length - 1);
  }

  removeWorkspace(id: string) {
    if (this.workspaces.length === 1) return; // always keep at least one
    const idx = this.workspaces.findIndex((w) => w.id === id);
    if (idx === -1) return;
    this.workspaces.splice(idx, 1);
    // Keep active index in bounds
    const newIdx = Math.min(this.activeIndex, this.workspaces.length - 1);
    if (this.activeIndex !== newIdx) {
      this.activeIndex = newIdx;
      this.transitionKey++;
    } else if (idx <= this.activeIndex) {
      this.activeIndex = Math.max(0, this.activeIndex - 1);
      this.transitionKey++;
    }
  }

  renameWorkspace(id: string, name: string) {
    const ws = this.workspaces.find((w) => w.id === id);
    if (ws) ws.name = name;
  }

  reorderWorkspace(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    const activeId = this.workspaces[this.activeIndex].id;
    const items = this.workspaces.splice(fromIdx, 1);
    this.workspaces.splice(toIdx, 0, items[0]);
    // Keep activeIndex pointing to the same workspace
    this.activeIndex = this.workspaces.findIndex((w) => w.id === activeId);
  }

  setRootPath(id: string, path: string) {
    const ws = this.workspaces.find((w) => w.id === id);
    if (ws) ws.project.rootPath = path;
  }

  updateProject(id: string, project: Partial<ProjectState>) {
    const ws = this.workspaces.find((w) => w.id === id);
    if (ws) Object.assign(ws.project, project);
  }

  updateActive(patch: Partial<WorkspaceState>) {
    Object.assign(this.workspaces[this.activeIndex], patch);
  }

  toggleOverview() {
    this.overviewOpen = !this.overviewOpen;
  }

  // ── Tab management ──────────────────────────────────────────

  // Find the workspace that owns a given tab (by ID)
  private wsForTab(tabId: string): WorkspaceState | null {
    return this.workspaces.find(w => w.openTabs.some(t => t.id === tabId)) ?? null;
  }

  // When a tile workspace is identified, sync focus/activeIndex
  private focusByWs(ws: WorkspaceState) {
    const wsIdx = this.workspaces.indexOf(ws);
    if (wsIdx === -1) return;
    const tileIdx = this.tiledIndices.indexOf(wsIdx);
    if (tileIdx !== -1) {
      this.tiledFocus = tileIdx;
    }
    this.activeIndex = wsIdx;
  }

  openFile(wsId: string, path: string, name: string, icon: string, content: string) {
    const ws = this.workspaces.find(w => w.id === wsId);
    if (!ws) return;
    this.focusByWs(ws);
    const existing = ws.openTabs.find(t => t.path === path);
    if (existing) {
      ws.activeTabId = existing.id;
      return;
    }
    const tab: EditorTab = {
      id: crypto.randomUUID(), path, name, icon, content, modified: false,
    };
    ws.openTabs.push(tab);
    ws.activeTabId = tab.id;
  }

  closeTab(tabId: string) {
    const ws = this.wsForTab(tabId);
    if (!ws) return;
    const idx = ws.openTabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;
    ws.openTabs.splice(idx, 1);
    if (ws.activeTabId === tabId) {
      ws.activeTabId = ws.openTabs.length > 0
        ? ws.openTabs[Math.min(idx, ws.openTabs.length - 1)].id
        : null;
    }
  }

  setActiveTab(tabId: string) {
    const ws = this.wsForTab(tabId);
    if (!ws) return;
    this.focusByWs(ws);
    ws.activeTabId = tabId;
  }

  // ── Workspace tiling ─────────────────────────────────────────
  tilingLayout    = $state<"single" | "vsplit" | "hsplit" | "quarter">("single");
  tiledIndices    = $state<number[]>([0]);
  tiledFocus      = $state(0);
  /** Index of the workspace tab currently being dragged for tile-drop (null = not dragging) */
  tilingDragWsIdx = $state<number | null>(null);

  setTilingLayout(layout: "single" | "vsplit" | "hsplit" | "quarter") {
    const count = layout === "quarter" ? 4 : layout === "single" ? 1 : 2;
    // Auto-create workspaces if needed
    while (this.workspaces.length < count) {
      this.workspaces.push(createWorkspace(`Workspace ${this.workspaces.length + 1}`));
    }
    this.tilingLayout = layout;
    this.tiledIndices = Array.from({ length: count }, (_, i) => i);
    if (this.tiledFocus >= count) this.tiledFocus = 0;
    this.activeIndex = this.tiledIndices[this.tiledFocus];
  }

  /**
   * Called when a workspace tab is dropped onto a directional zone.
   * Creates a 2-way split between the dragged workspace and the currently
   * focused workspace, regardless of the previous tiling state.
   */
  placeTiledWorkspace(draggedIdx: number, zone: "left" | "right" | "top" | "bottom") {
    const baseIdx = this.activeIndex;
    // Ensure the dragged workspace exists
    while (this.workspaces.length <= draggedIdx) {
      this.workspaces.push(createWorkspace(`Workspace ${this.workspaces.length + 1}`));
    }
    if (zone === "left" || zone === "right") {
      this.tilingLayout = "vsplit";
      this.tiledIndices = zone === "left" ? [draggedIdx, baseIdx] : [baseIdx, draggedIdx];
    } else {
      this.tilingLayout = "hsplit";
      this.tiledIndices = zone === "top" ? [draggedIdx, baseIdx] : [baseIdx, draggedIdx];
    }
    // Keep focus on the base (original) workspace
    this.tiledFocus   = this.tiledIndices.indexOf(baseIdx);
    this.activeIndex  = baseIdx;
    this.tilingDragWsIdx = null;
  }

  focusTile(tileIdx: number) {
    this.tiledFocus = tileIdx;
    this.activeIndex = this.tiledIndices[tileIdx];
  }

  updateWorkspace(wsIndex: number, patch: Partial<WorkspaceState>) {
    Object.assign(this.workspaces[wsIndex], patch);
  }

  updateTabContent(tabId: string, content: string) {
    const ws = this.wsForTab(tabId);
    const tab = ws?.openTabs.find(t => t.id === tabId);
    if (tab) { tab.content = content; tab.modified = true; }
  }

  saveTab(tabId: string) {
    const ws = this.wsForTab(tabId);
    const tab = ws?.openTabs.find(t => t.id === tabId);
    if (tab) tab.modified = false;
  }

  // ── Breakpoints ─────────────────────────────────────────────

  toggleBreakpoint(path: string, line: number) {
    const ws = this.workspaces[this.activeIndex];
    if (!ws.breakpoints[path]) {
      ws.breakpoints[path] = [line];
      return;
    }
    const lines = ws.breakpoints[path];
    const idx = lines.indexOf(line);
    if (idx === -1) {
      lines.push(line);
    } else {
      lines.splice(idx, 1);
    }
    // Trigger reactivity by reassigning
    ws.breakpoints = { ...ws.breakpoints };
  }

  getBreakpoints(path: string): number[] {
    return this.workspaces[this.activeIndex].breakpoints[path] ?? [];
  }
}

export const workspaceStore = new WorkspaceStore();
