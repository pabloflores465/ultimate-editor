import { push } from "svelte-spa-router";

// ── Types ──────────────────────────────────────────────────────
export interface WorkspaceState {
  id: string;
  name: string;
  leftPanelOpen: boolean;
  bottomPanelOpen: boolean;
  activeTool: string;
  activeBottom: string;
  leftWidth: number;
  bottomHeight: number;
  expandedFolders: Record<string, boolean>;
  activeRoute: string;
  selectedConfig: string;
}

// ── Factory ────────────────────────────────────────────────────
function createWorkspace(name: string): WorkspaceState {
  return {
    id: crypto.randomUUID(),
    name,
    leftPanelOpen: true,
    bottomPanelOpen: true,
    activeTool: "project",
    activeBottom: "terminal",
    leftWidth: 248,
    bottomHeight: 190,
    expandedFolders: {
      src: true, mainview: true, pages: true, components: false, bun: false,
    },
    activeRoute: "/",
    selectedConfig: "bun run dev",
  };
}

// ── Store ──────────────────────────────────────────────────────
class WorkspaceStore {
  workspaces = $state<WorkspaceState[]>([createWorkspace("Workspace 1")]);
  activeIndex = $state(0);
  overviewOpen = $state(false);
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
      // Active shifted left by one
      this.activeIndex = Math.max(0, this.activeIndex - 1);
      this.transitionKey++;
    }
  }

  renameWorkspace(id: string, name: string) {
    const ws = this.workspaces.find((w) => w.id === id);
    if (ws) ws.name = name;
  }

  updateActive(patch: Partial<WorkspaceState>) {
    Object.assign(this.workspaces[this.activeIndex], patch);
  }

  toggleOverview() {
    this.overviewOpen = !this.overviewOpen;
  }
}

export const workspaceStore = new WorkspaceStore();
