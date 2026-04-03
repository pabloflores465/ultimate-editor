import { push } from "svelte-spa-router";

// ── Tiling layout type ────────────────────────────────────────
export type TilingLayout = "single" | "vsplit" | "hsplit" | "triple" | "quarter";

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
  runConfigs: string[];
  isRunning: boolean;
  isLoadingProject: boolean;
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
    selectedConfig: "",
    runConfigs: [],
    isRunning: false,
    isLoadingProject: false,
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
  workspaces = $state<WorkspaceState[]>([]);
  activeIndex = $state(-1);
  overviewOpen = $state(false);
  mode = $state<"editor" | "agent">("editor");
  /** 1 = new workspace is to the right (slide left), -1 = to the left (slide right) */
  slideDirection = $state<1 | -1>(1);
  /** Incrementing this key forces the {#key} block to re-render with animation */
  transitionKey = $state(0);
  /** Most-recently-used workspace indices (front = most recent) for tiling assignment */
  mruIndices = $state<number[]>([]);

  get active(): WorkspaceState | null {
    return this.activeIndex >= 0 ? this.workspaces[this.activeIndex] : null;
  }

  /** Push a workspace index to the front of the MRU list */
  private touchMru(index: number) {
    this.mruIndices = [index, ...this.mruIndices.filter(i => i !== index)];
  }

  switchTo(index: number) {
    if (index < 0 || index >= this.workspaces.length) return;

    // ── Tiling-aware: if already tiled, just focus that tile ─
    if (this.tilingLayout !== "single") {
      const existingTile = this.tiledIndices.indexOf(index);
      if (existingTile !== -1) {
        this.focusTile(existingTile);
      }
      // Non-tiled tab clicked → ignore (don't swap)
      return;
    }

    // ── Single mode ─────────────────────────────────────────
    if (index === this.activeIndex) return;
    this.touchMru(index);
    this.slideDirection = index > this.activeIndex ? 1 : -1;
    this.activeIndex = index;
    this.transitionKey++;
    this.overviewOpen = false;
    push(this.workspaces[index].activeRoute);
  }

  next() {
    if (this.workspaces.length === 0) return;
    this.switchTo((this.activeIndex + 1) % this.workspaces.length);
  }

  prev() {
    if (this.workspaces.length === 0) return;
    this.switchTo(
      (this.activeIndex - 1 + this.workspaces.length) % this.workspaces.length
    );
  }

  addWorkspace() {
    const ws = createWorkspace(`Workspace ${this.workspaces.length + 1}`);
    this.workspaces.push(ws);
    this.activeIndex = this.workspaces.length - 1;
    this.touchMru(this.activeIndex);
    this.slideDirection = 1;
    this.transitionKey++;
    this.overviewOpen = false;
    push(ws.activeRoute);
  }

  removeWorkspace(id: string) {
    const idx = this.workspaces.findIndex((w) => w.id === id);
    if (idx === -1) return;
    this.workspaces.splice(idx, 1);
    // Update MRU: remove the deleted index, shift indices above it down by 1
    this.mruIndices = this.mruIndices
      .filter(i => i !== idx)
      .map(i => i > idx ? i - 1 : i);

    // If no workspaces left, reset to empty state
    if (this.workspaces.length === 0) {
      this.activeIndex = -1;
      this.tilingLayout = "single";
      this.tiledIndices = [0];
      this.tiledFocus = 0;
      this.transitionKey++;
      return;
    }

    // Fall back to single if not enough workspaces for current layout
    if (!this.canTile(this.tilingLayout)) {
      this.tilingLayout = "single";
      this.tiledIndices = [0];
      this.tiledFocus = 0;
    } else {
      // Rebuild tiledIndices — clamp any out-of-bounds indices
      this.tiledIndices = this.tiledIndices
        .map(i => i >= this.workspaces.length ? this.workspaces.length - 1 : (i > idx ? i - 1 : i))
        .filter((v, i, arr) => arr.indexOf(v) === i); // deduplicate
      const count = WorkspaceStore.layoutCount(this.tilingLayout);
      while (this.tiledIndices.length < count) {
        // Fill with first available index not already tiled
        for (let j = 0; j < this.workspaces.length; j++) {
          if (!this.tiledIndices.includes(j)) { this.tiledIndices.push(j); break; }
        }
      }
      if (this.tiledFocus >= this.tiledIndices.length) this.tiledFocus = 0;
    }

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
    if (ws) {
      ws.project = { ...ws.project, ...project };
    }
  }

  updateActive(patch: Partial<WorkspaceState>) {
    if (this.activeIndex >= 0 && this.activeIndex < this.workspaces.length) {
      Object.assign(this.workspaces[this.activeIndex], patch);
    }
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
  tilingLayout    = $state<TilingLayout>("single");
  tiledIndices    = $state<number[]>([0]);
  tiledFocus      = $state(0);
  /** Index of the workspace tab currently being dragged for tile-drop (null = not dragging) */
  tilingDragWsIdx = $state<number | null>(null);
  /** Split ratio for 2-way splits (0–1, first tile gets this fraction). For quarter: [col, row]. */
  tilingSplitRatio = $state<[number, number]>([0.5, 0.5]);

  /** How many workspaces a layout requires */
  static layoutCount(layout: TilingLayout): number {
    if (layout === "quarter") return 4;
    if (layout === "triple") return 3;
    if (layout === "single") return 1;
    return 2;
  }

  /** Whether the user has enough workspaces to activate a given layout */
  canTile(layout: TilingLayout): boolean {
    return this.workspaces.length >= WorkspaceStore.layoutCount(layout);
  }

  /** How many MORE workspaces are needed for a layout (0 = ready) */
  tilingDeficit(layout: TilingLayout): number {
    return Math.max(0, WorkspaceStore.layoutCount(layout) - this.workspaces.length);
  }

  setTilingLayout(layout: TilingLayout) {
    // Block if not enough workspaces — never auto-create
    if (!this.canTile(layout)) return;
    const count = WorkspaceStore.layoutCount(layout);
    this.tilingLayout = layout;
    this.tilingSplitRatio = [0.5, 0.5];

    // Build tiledIndices from MRU (most recently visited first)
    // Ensure the current active is at the front of MRU
    const active = Math.max(0, this.activeIndex);
    this.touchMru(active);
    const indices: number[] = [];
    for (const mruIdx of this.mruIndices) {
      if (mruIdx < this.workspaces.length && !indices.includes(mruIdx)) {
        indices.push(mruIdx);
      }
      if (indices.length >= count) break;
    }
    // Fill remaining slots if MRU doesn't have enough
    for (let i = 0; i < this.workspaces.length && indices.length < count; i++) {
      if (!indices.includes(i)) indices.push(i);
    }
    this.tiledIndices = indices;
    this.tiledFocus = 0;
    this.activeIndex = active;
  }

  /**
   * Called when a workspace tab is dropped onto a directional zone.
   * Creates a 2-way split between the dragged workspace and the currently
   * focused workspace. Requires at least 2 existing workspaces — never auto-creates.
   */
  placeTiledWorkspace(draggedIdx: number, zone: "left" | "right" | "top" | "bottom") {
    const baseIdx = this.activeIndex;
    // Validate: both workspaces must already exist, and must be different
    if (draggedIdx >= this.workspaces.length || draggedIdx === baseIdx) {
      this.tilingDragWsIdx = null;
      return;
    }
    // Update MRU: base is most recent (focused), dragged is second
    this.touchMru(draggedIdx);
    this.touchMru(baseIdx);
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
    this.touchMru(this.tiledIndices[tileIdx]);
  }

  /**
   * Remove a tile from the current layout and downgrade:
   *   quarter → pick the best 2-split (or single if only 2 left)
   *   vsplit/hsplit → single
   * The removed tile's workspace is NOT deleted — just untiled.
   */
  removeTile(tileIdx: number) {
    if (this.tilingLayout === "single") return;

    // Remove the tile
    this.tiledIndices.splice(tileIdx, 1);
    const remaining = this.tiledIndices;

    if (remaining.length <= 1) {
      this.tilingLayout = "single";
      this.tiledIndices = remaining.length ? [remaining[0]] : [0];
      this.tiledFocus = 0;
      this.activeIndex = this.tiledIndices[0];
    } else if (remaining.length === 2) {
      this.tilingLayout = "vsplit";
      this.tiledIndices = remaining;
      this.tilingSplitRatio = [0.5, 0.5];
      if (this.tiledFocus >= remaining.length) this.tiledFocus = 0;
      this.activeIndex = this.tiledIndices[this.tiledFocus];
    } else if (remaining.length === 3) {
      this.tilingLayout = "triple";
      this.tiledIndices = remaining;
      this.tilingSplitRatio = [0.5, 0.5];
      if (this.tiledFocus >= remaining.length) this.tiledFocus = 0;
      this.activeIndex = this.tiledIndices[this.tiledFocus];
    }
    // Update MRU so badges reflect the new focus
    this.touchMru(this.activeIndex);
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
    if (this.activeIndex < 0 || this.activeIndex >= this.workspaces.length) return;
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
    if (this.activeIndex < 0 || this.activeIndex >= this.workspaces.length) return [];
    return this.workspaces[this.activeIndex].breakpoints[path] ?? [];
  }
}

export const workspaceStore = new WorkspaceStore();
