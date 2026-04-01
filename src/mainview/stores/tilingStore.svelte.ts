/**
 * tilingStore.svelte.ts — Manual tiling WM layout for terminals
 *
 * Model: Tree where each node is either:
 *   - TerminalNode: single terminal (leaf)
 *   - SplitNode: container with direction + two children
 *
 * Operations:
 *   - split(nodeId, direction): replace a terminal with a split
 *   - close(nodeId): remove terminal, collapse tree upward
 */

export type SplitDirection = "horizontal" | "vertical";

export interface TerminalNode {
  type: "terminal";
  id: string;
  label: string;
}

export interface SplitNode {
  type: "split";
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: TilingNode;
  second: TilingNode;
}

export type TilingNode = TerminalNode | SplitNode;

let globalCounter = 0;
export function generateTermId(prefix: string): string {
  return `${prefix}_t${globalCounter++}`;
}

export function createTerminal(id: string, label = "zsh"): TerminalNode {
  return { type: "terminal", id, label };
}

export function createSplit(
  first: TilingNode,
  second: TilingNode,
  direction: SplitDirection,
  ratio = 0.5
): SplitNode {
  return {
    type: "split",
    id: `split_${globalCounter++}`,
    direction,
    ratio,
    first,
    second,
  };
}

export function findNode(root: TilingNode | null, id: string): TilingNode | null {
  if (!root) return null;
  if (root.id === id) return root;
  if (root.type === "split") {
    return findNode(root.first, id) ?? findNode(root.second, id);
  }
  return null;
}

export function findAllTerminals(root: TilingNode | null): TerminalNode[] {
  if (!root) return [];
  if (root.type === "terminal") return [root];
  return [...findAllTerminals(root.first), ...findAllTerminals(root.second)];
}

export function splitNode(
  root: TilingNode,
  targetId: string,
  newTerminal: TerminalNode,
  direction: SplitDirection
): TilingNode {
  if (root.id === targetId && root.type === "terminal") {
    return createSplit(root, newTerminal, direction, 0.5);
  }
  if (root.type === "split") {
    if (findNode(root.first, targetId)) {
      return {
        ...root,
        first: splitNode(root.first, targetId, newTerminal, direction),
      };
    }
    if (findNode(root.second, targetId)) {
      return {
        ...root,
        second: splitNode(root.second, targetId, newTerminal, direction),
      };
    }
  }
  return root;
}

export function closeNode(root: TilingNode | null, targetId: string): { node: TilingNode | null; removed: boolean } {
  if (!root) return { node: null, removed: false };
  
  if (root.id === targetId) {
    return { node: null, removed: true };
  }

  if (root.type === "split") {
    if (root.first.id === targetId) {
      return { node: root.second, removed: true };
    }
    if (root.second.id === targetId) {
      return { node: root.first, removed: true };
    }

    const firstResult = closeNode(root.first, targetId);
    if (firstResult.removed) {
      if (!firstResult.node) return { node: root.second, removed: true };
      return { node: { ...root, first: firstResult.node }, removed: true };
    }

    const secondResult = closeNode(root.second, targetId);
    if (secondResult.removed) {
      if (!secondResult.node) return { node: root.first, removed: true };
      return { node: { ...root, second: secondResult.node }, removed: true };
    }
  }

  return { node: root, removed: false };
}

export function countTerminals(root: TilingNode | null): number {
  if (!root) return 0;
  if (root.type === "terminal") return 1;
  return countTerminals(root.first) + countTerminals(root.second);
}

export function updateRatio(root: TilingNode, splitId: string, newRatio: number): TilingNode {
  if (root.id === splitId && root.type === "split") {
    return { ...root, ratio: Math.max(0.1, Math.min(0.9, newRatio)) };
  }
  if (root.type === "split") {
    return {
      ...root,
      first: updateRatio(root.first, splitId, newRatio),
      second: updateRatio(root.second, splitId, newRatio),
    };
  }
  return root;
}

export interface CloseResult {
  closedId: string | null;
  newTerminalId: string | null;
}

export class TilingStore {
  root: TilingNode | null = $state(null);
  activeTerminalId: string = $state("");
  private closingIds = new Set<string>();

  get activeTerminal(): TerminalNode | null {
    return findNode(this.root, this.activeTerminalId) as TerminalNode | null;
  }

  get terminals(): TerminalNode[] {
    return findAllTerminals(this.root);
  }

  get count(): number {
    return countTerminals(this.root);
  }

  isClosing(id: string): boolean {
    const result = this.closingIds.has(id);
    if (result) {
      console.log(`[TilingStore] isClosing(${id}) = true, closingIds: ${Array.from(this.closingIds).join(', ')}`);
    }
    return result;
  }

  init(prefix: string): string {
    const id = generateTermId(prefix);
    this.root = createTerminal(id);
    this.activeTerminalId = id;
    return id;
  }

  split(terminalId: string, direction: SplitDirection, prefix: string): string | null {
    if (!this.root) return null;
    const target = findNode(this.root, terminalId);
    if (!target || target.type !== "terminal") return null;

    const newId = generateTermId(prefix);
    const newTerm = createTerminal(newId);
    this.root = splitNode(this.root, terminalId, newTerm, direction);
    this.activeTerminalId = newId;
    return newId;
  }

  close(terminalId: string, prefix: string): CloseResult {
    console.log(`[TilingStore] close called for ${terminalId}`);
    if (!this.root) return { closedId: null, newTerminalId: null };
    if (this.closingIds.has(terminalId)) {
      console.log(`[TilingStore] close for ${terminalId} already in closingIds, skipping`);
      return { closedId: null, newTerminalId: null };
    }

    this.closingIds.add(terminalId);

    const terminalsBefore = countTerminals(this.root);
    console.log(`[TilingStore] terminals before close: ${terminalsBefore}`);

    if (terminalsBefore === 1) {
      const oldNode = this.root as TerminalNode;
      const oldId = oldNode.id;
      
      const newId = generateTermId(prefix);
      this.root = createTerminal(newId);
      this.activeTerminalId = newId;
      console.log(`[TilingStore] was only terminal, created new ${newId}`);
      
      setTimeout(() => this.closingIds.delete(oldId), 100);
      return { closedId: oldId, newTerminalId: newId };
    }

    const result = closeNode(this.root, terminalId);
    
    if (!result.removed) {
      this.closingIds.delete(terminalId);
      return { closedId: null, newTerminalId: null };
    }

    const remaining = result.node ? countTerminals(result.node) : 0;
    console.log(`[TilingStore] terminals after close: ${remaining}`);

    if (remaining === 0) {
      const newId = generateTermId(prefix);
      this.root = createTerminal(newId);
      this.activeTerminalId = newId;
      setTimeout(() => this.closingIds.delete(terminalId), 100);
      return { closedId: terminalId, newTerminalId: newId };
    }

    this.root = result.node!;
    console.log(`[TilingStore] remaining terminal IDs: ${findAllTerminals(this.root).map(t => t.id).join(', ')}`);

    if (this.activeTerminalId === terminalId) {
      const terminals = findAllTerminals(this.root);
      this.activeTerminalId = terminals[0]?.id ?? "";
      console.log(`[TilingStore] set activeTerminalId to ${this.activeTerminalId}`);
    }

    setTimeout(() => this.closingIds.delete(terminalId), 100);
    return { closedId: terminalId, newTerminalId: null };
  }

  setActive(terminalId: string): void {
    this.activeTerminalId = terminalId;
  }

  setRatio(splitId: string, newRatio: number): void {
    if (!this.root) return;
    this.root = updateRatio(this.root, splitId, newRatio);
  }

  reset(prefix: string): string {
    const id = generateTermId(prefix);
    this.root = createTerminal(id);
    this.activeTerminalId = id;
    this.closingIds.clear();
    return id;
  }
}
