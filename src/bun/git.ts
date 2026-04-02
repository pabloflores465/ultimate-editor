import simpleGit, { type SimpleGit } from "simple-git";
import { resolve, isAbsolute, dirname } from "path";
import { existsSync } from "fs";

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
  commits: GitCommit[];
}

const gitInstances = new Map<string, SimpleGit>();

function findGitRoot(startPath: string): string | null {
  let currentPath = startPath;
  while (currentPath !== "/") {
    if (existsSync(resolve(currentPath, ".git"))) {
      return currentPath;
    }
    currentPath = dirname(currentPath);
  }
  return null;
}

function getGit(path: string): SimpleGit {
  console.log(`[git.ts] getGit called with: ${path}`);
  if (!gitInstances.has(path)) {
    console.log(`[git.ts] creating new simple-git instance for: ${path}`);
    // Use explicit baseDir option
    gitInstances.set(path, simpleGit({ baseDir: path }));
  }
  return gitInstances.get(path)!;
}

export async function openRepository(folderName: string): Promise<string | null> {
  try {
    console.log(`[git.ts] openRepository called with: ${folderName}`);
    
    const cwd = process.env.INITIAL_CWD || process.cwd();
    console.log(`[git.ts] cwd: ${cwd}`);
    
    let searchPath: string;
    if (isAbsolute(folderName)) {
      searchPath = folderName;
    } else {
      searchPath = resolve(cwd, folderName);
    }
    
    console.log(`[git.ts] searchPath: ${searchPath}`);
    
    const gitRoot = findGitRoot(searchPath);
    console.log(`[git.ts] gitRoot: ${gitRoot}`);
    
    if (gitRoot) {
      // Clear any cached instances to ensure clean state
      gitInstances.clear();
      gitInstances.set(gitRoot, simpleGit({ baseDir: gitRoot }));
      return gitRoot;
    }
  } catch (e) {
    console.error(`[git.ts] openRepository error:`, e);
  }
  return null;
}

export async function isRepo(path: string): Promise<boolean> {
  try {
    const git = getGit(path);
    return await git.checkIsRepo();
  } catch {
    return false;
  }
}

export async function getStatus(path: string): Promise<{ isRepo: boolean; branch: string; changes: GitChange[]; rootPath: string }> {
  const git = getGit(path);
  const isRepoResult = await git.checkIsRepo();
  
  if (!isRepoResult) {
    return { isRepo: false, branch: "", changes: [], rootPath: path };
  }

  const [status, branchResult] = await Promise.all([
    git.status(),
    git.branch(),
  ]);

  console.log(`[git.ts] getStatus - modified:`, status.modified);
  console.log(`[git.ts] getStatus - not_added:`, status.not_added);
  console.log(`[git.ts] getStatus - created:`, status.created);

  const changes: GitChange[] = [];

  for (const filePath of status.modified) {
    changes.push({ path: filePath, index: " ", workingTree: "M", status: "modified" });
  }
  for (const filePath of status.staged) {
    const isStagedAndModified = status.modified.includes(filePath);
    changes.push({ 
      path: filePath, 
      index: "A", 
      workingTree: isStagedAndModified ? "M" : " ", 
      status: isStagedAndModified ? "modified" : "added" 
    });
  }
  for (const filePath of status.deleted) {
    changes.push({ path: filePath, index: "D", workingTree: "D", status: "deleted" });
  }
  for (const rename of status.renamed) {
    changes.push({ path: rename.to, index: "R", workingTree: " ", status: "renamed" });
  }
  for (const filePath of status.not_added) {
    changes.push({ path: filePath, index: "?", workingTree: "?", status: "untracked" });
  }
  for (const filePath of status.created) {
    changes.push({ path: filePath, index: "A", workingTree: " ", status: "added" });
  }

  return {
    isRepo: true,
    branch: branchResult.current || "",
    changes,
    rootPath: path,
  };
}

export async function getDiff(path: string, filePath: string): Promise<string> {
  const git = getGit(path);
  try {
    console.log(`[git.ts] getDiff called with path=${path}, filePath=${filePath}`);
    
    // Check if file is untracked (not in git index)
    const status = await git.status([filePath]);
    const isUntracked = status.not_added.includes(filePath) || status.created.includes(filePath);
    
    if (isUntracked) {
      // For untracked files, show the entire file content with + prefix
      const fullPath = resolve(path, filePath);
      console.log(`[git.ts] untracked file, reading content from: ${fullPath}`);
      try {
        const content = await Bun.file(fullPath).text();
        const lines = content.split('\n');
        return lines.map(line => `+${line}`).join('\n');
      } catch (e) {
        console.error(`[git.ts] error reading untracked file:`, e);
        return `(New file - cannot read content)`;
      }
    }
    
    // For tracked files, get the diff
    let diff = await git.diff(["--", filePath]);
    console.log(`[git.ts] regular diff length: ${diff.length}`);
    
    // If no unstaged changes, try cached diff (staged changes)
    if (!diff) {
      diff = await git.diff(["--cached", "--", filePath]);
      console.log(`[git.ts] cached diff length: ${diff.length}`);
    }
    
    return diff;
  } catch (e) {
    console.error(`[git.ts] getDiff error:`, e);
    return "";
  }
}

export async function getLog(path: string, maxCount: number = 50): Promise<GitCommit[]> {
  const git = getGit(path);
  try {
    const log = await git.log({ maxCount });
    return log.all.map(c => ({
      hash: c.hash.substring(0, 7),
      date: c.date,
      message: c.message,
      author_name: c.author_name,
      author_email: c.author_email,
    }));
  } catch {
    return [];
  }
}

export async function stageFile(path: string, filePath: string): Promise<void> {
  const git = getGit(path);
  await git.add(filePath);
}

export async function stageAll(path: string): Promise<void> {
  const git = getGit(path);
  await git.add("-A");
}

export async function commit(path: string, message: string): Promise<void> {
  const git = getGit(path);
  await git.commit(message);
}

export function getStatusColor(status: GitChange["status"]): string {
  switch (status) {
    case "modified": return "#e2c08d";
    case "added": return "#629755";
    case "deleted": return "#f14c4c";
    case "renamed": return "#4e9ede";
    case "untracked": return "#9876aa";
    default: return "#a9b7c6";
  }
}

export function getStatusLetter(status: GitChange["status"]): string {
  switch (status) {
    case "modified": return "M";
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "untracked": return "U";
    default: return "?";
  }
}
