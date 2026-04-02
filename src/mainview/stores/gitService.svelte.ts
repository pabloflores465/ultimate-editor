import { Electroview } from "electrobun/view";

export interface GitChange {
  path: string;
  index: string;
  workingTree: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
}

export interface GitCommit {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  author_email: string;
}

export interface GitState {
  isRepo: boolean;
  branch: string;
  changes: GitChange[];
  diffs: Map<string, string>;
  commits: GitCommit[];
  loading: boolean;
  currentPath: string;
}

class GitService {
  state = $state<GitState>({
    isRepo: false,
    branch: "",
    changes: [],
    diffs: new Map(),
    commits: [],
    loading: false,
    currentPath: "",
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rpc: any = (Electroview.defineRPC as any)({
    handlers: {
      messages: {
        "git:status": (data: { isRepo: boolean; branch: string; changes: GitChange[] }) => {
          this.state.isRepo = data.isRepo;
          this.state.branch = data.branch;
          this.state.changes = data.changes;
          this.state.loading = false;
        },
        "git:diff": (data: { filePath: string; diff: string }) => {
          this.state.diffs.set(data.filePath, data.diff);
          this.state.diffs = new Map(this.state.diffs);
        },
        "git:log": (data: { commits: GitCommit[] }) => {
          this.state.commits = data.commits;
        },
        "git:error": (data: { message: string }) => {
          console.error("Git error:", data.message);
          this.state.loading = false;
        },
      },
    },
  });

  constructor() {
    new Electroview({ rpc: this.rpc });
  }

  async openRepository(path: string) {
    if (path === this.state.currentPath) return;
    this.state.currentPath = path;
    this.state.loading = true;
    this.rpc.send["git:open"]({ path });
  }

  async refresh() {
    if (!this.state.currentPath) return;
    this.state.loading = true;
    this.rpc.send["git:status"]({ path: this.state.currentPath });
  }

  async getDiff(filePath: string) {
    if (!this.state.currentPath) return "";
    if (this.state.diffs.has(filePath)) {
      return this.state.diffs.get(filePath)!;
    }
    this.rpc.send["git:diff"]({ path: this.state.currentPath, filePath });
    return "";
  }

  async stageFile(filePath: string) {
    if (!this.state.currentPath) return;
    this.state.loading = true;
    this.rpc.send["git:stage"]({ path: this.state.currentPath, filePath });
  }

  async stageAll() {
    if (!this.state.currentPath) return;
    this.state.loading = true;
    this.rpc.send["git:stage"]({ path: this.state.currentPath });
  }

  async commit(message: string) {
    if (!this.state.currentPath) return;
    this.state.loading = true;
    this.rpc.send["git:commit"]({ path: this.state.currentPath, message });
  }

  getStatusColor(status: GitChange["status"]): string {
    switch (status) {
      case "modified": return "#e2c08d";
      case "added": return "#629755";
      case "deleted": return "#f14c4c";
      case "renamed": return "#4e9ede";
      case "untracked": return "#9876aa";
      default: return "#a9b7c6";
    }
  }

  getStatusLetter(status: GitChange["status"]): string {
    switch (status) {
      case "modified": return "M";
      case "added": return "A";
      case "deleted": return "D";
      case "renamed": return "R";
      case "untracked": return "U";
      default: return "?";
    }
  }
}

export const gitService = new GitService();
