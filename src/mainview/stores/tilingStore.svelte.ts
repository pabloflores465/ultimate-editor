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
  writeFn: ((b64: string) => void) | null;
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
  return { type: "terminal", id, label, writeFn: null };
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

export function updateWriteFn(
  root: TilingNode | null,
  terminalId: string,
  writeFn: (b64: string) => void
): TilingNode | null {
  if (!root) return null;
  if (root.type === "terminal") {
    if (root.id === terminalId) {
      return { ...root, writeFn };
    }
    return root;
  }
  return {
    ...root,
    first: updateWriteFn(root.first, terminalId, writeFn) ?? root.first,
    second: updateWriteFn(root.second, terminalId, writeFn) ?? root.second,
  };
}

export function countTerminals(root: TilingNode | null): number {
  if (!root) return 0;
  if (root.type === "terminal") return 1;
  return countTerminals(root.first) + countTerminals(root.second);
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
    return this.closingIds.has(id);
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
    if (!this.root) return { closedId: null, newTerminalId: null };
    if (this.closingIds.has(terminalId)) return { closedId: null, newTerminalId: null };

    const terminalsBefore = countTerminals(this.root);

    if (terminalsBefore === 1) {
      const oldNode = this.root as TerminalNode;
      const oldId = oldNode.id;
      
      this.closingIds.add(oldId);
      
      const newId = generateTermId(prefix);
      this.root = createTerminal(newId);
      this.activeTerminalId = newId;
      
      this.closingIds.delete(oldId);
      return { closedId: oldId, newTerminalId: newId };
    }

    const result = closeNode(this.root, terminalId);
    
    if (!result.removed) {
      return { closedId: null, newTerminalId: null };
    }

    this.closingIds.add(terminalId);

    const remaining = result.node ? countTerminals(result.node) : 0;

    if (remaining === 0) {
      const newId = generateTermId(prefix);
      this.root = createTerminal(newId);
      this.activeTerminalId = newId;
      this.closingIds.delete(terminalId);
      return { closedId: terminalId, newTerminalId: newId };
    }

    this.root = result.node!;

    if (this.activeTerminalId === terminalId) {
      const terminals = findAllTerminals(this.root);
      this.activeTerminalId = terminals[0]?.id ?? "";
    }

    this.closingIds.delete(terminalId);
    return { closedId: terminalId, newTerminalId: null };
  }

  setActive(terminalId: string): void {
    this.activeTerminalId = terminalId;
  }

  setWriteFn(terminalId: string, writeFn: (b64: string) => void): void {
    if (this.closingIds.has(terminalId)) return;
    this.root = updateWriteFn(this.root, terminalId, writeFn);
  }

  reset(prefix: string): string {
    const id = generateTermId(prefix);
    this.root = createTerminal(id);
    this.activeTerminalId = id;
    this.closingIds.clear();
    return id;
  }
}
