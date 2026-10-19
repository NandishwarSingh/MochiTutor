import { useSyncExternalStore } from "react";
import type { CoinRun, MontyGame, MontySimulation } from "../lib/simulations";
import type { DistributionFamily, DistributionParams } from "../lib/stats";

export type LineKind = "title" | "text" | "math" | "step" | "given" | "answer" | "note";
export const LINE_KINDS: readonly LineKind[] = ["title", "text", "math", "step", "given", "answer", "note"];

/** Chalk marks Mochi can put on a line: around it, under it, behind it, or beside it. */
export type MarkStyle = "circle" | "underline" | "box" | "highlight" | "tick" | "cross" | "star";
export const MARK_STYLES: readonly MarkStyle[] = ["circle", "underline", "box", "highlight", "tick", "cross", "star"];

export interface LineMark {
  id: number;
  style: MarkStyle;
  label?: string;
  /** seconds to wait before drawing, so a mark can follow the writing it belongs to */
  delay?: number;
}

export interface NotebookMark {
  id: number;
  box: [number, number, number, number];
  label: string;
  verdict: "mistake" | "correct" | "note";
  /** true once a vision model has placed the box precisely */
  refined: boolean;
  /** no usable rough box yet, so don't draw it until it's refined */
  hidden: boolean;
}

export type BoardItem =
  | { id: number; kind: "line"; line: LineKind; content: string; marks?: LineMark[] }
  | { id: number; kind: "plot"; expression: string; xMin: number; xMax: number; label?: string }
  | { id: number; kind: "coins"; run: CoinRun }
  | { id: number; kind: "monty"; game: MontyGame | null; sim: MontySimulation | null }
  | {
      id: number;
      kind: "distribution";
      family: DistributionFamily;
      params: DistributionParams;
      from?: number;
      to?: number;
    }
  | { id: number; kind: "calc"; expression: string; text: string; fraction?: string }
  | { id: number; kind: "notebook"; image: string; marks: NotebookMark[] }
  | { id: number; kind: "diagram"; spec: DiagramSpec }
  | { id: number; kind: "tree"; spec: TreeSpec }
  | { id: number; kind: "numberline"; spec: NumberLineSpec }
  | { id: number; kind: "venn"; spec: VennSpec }
  | { id: number; kind: "bars"; spec: BarSpec }
  | { id: number; kind: "image"; src: string; title: string; credit: string; caption?: string };

export type ChalkColor = "chalk" | "yellow" | "blue" | "pink" | "green";
export interface XY {
  x: number;
  y: number;
}

/** One thing drawn in a diagram, in the diagram's own x/y units. */
export type DiagramShape =
  | { type: "function"; expression: string; color: ChalkColor; dashed?: boolean; label?: string }
  | { type: "point"; at: XY; color: ChalkColor; label?: string }
  | { type: "segment" | "arrow"; from: XY; to: XY; color: ChalkColor; dashed?: boolean; label?: string }
  | { type: "polygon"; points: XY[]; color: ChalkColor; fill?: boolean; vertexLabels?: string[]; label?: string }
  | { type: "circle"; at: XY; radius: number; color: ChalkColor; label?: string }
  | { type: "angle"; at: XY; from: XY; to: XY; color: ChalkColor; label?: string }
  | { type: "label"; at: XY; text: string; color: ChalkColor }
  | { type: "area"; expression: string; from: number; to: number; color: ChalkColor; label?: string }
  | { type: "tangent"; expression: string; from: number; to: number; color: ChalkColor; settle?: number }
  | { type: "moving_point"; expression: string; from: number; to: number; color: ChalkColor; label?: string };

export interface DiagramSpec {
  title?: string;
  xRange: [number, number];
  yRange: [number, number];
  axes: boolean;
  grid: boolean;
  /** same scale on both axes, for geometry */
  equal: boolean;
  shapes: DiagramShape[];
}

export interface TreeBranch {
  /** labels from the root to this branch's parent, "" for the first level */
  path: string[];
  label: string;
  probability: string;
}

export interface TreeSpec {
  title?: string;
  branches: TreeBranch[];
  /** the path to light up, root to leaf */
  highlight?: string[];
  /** P(highlighted path) as written and as a fraction, worked out by the calculator */
  product?: { expression: string; value: string };
}

export interface NumberLineSpec {
  from: number;
  to: number;
  step: number;
  points: Array<{ value: number; label?: string; open?: boolean; color: ChalkColor }>;
  intervals: Array<{
    from: number | null;
    to: number | null;
    fromOpen: boolean;
    toOpen: boolean;
    color: ChalkColor;
    label?: string;
  }>;
  jumps: Array<{ from: number; to: number; label?: string }>;
}

export interface VennSpec {
  title?: string;
  /** two or three set names, drawn as A, B and C */
  sets: string[];
  /** a value written in an atomic region; keys are membership masks like "110" */
  values: Record<string, string>;
  /** atomic regions to shade */
  shaded: string[];
  /** what the shading shows, like "A or B" */
  caption?: string;
}

export interface BarSpec {
  title?: string;
  bars: Array<{ label: string; value: number; highlight?: boolean }>;
  mean?: number;
  yLabel?: string;
}

type NewItem = BoardItem extends infer T ? (T extends BoardItem ? Omit<T, "id"> : never) : never;

// The board keeps old pages so the student can flip back.
const MAX_ITEMS = 160;

/** Everything on the board. A tiny external store so tool handlers can write to it outside React. */
export class BoardStore {
  private items: BoardItem[] = [];
  private nextId = 1;
  private nextMarkId = 1;
  private focusedId: number | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = () => this.items;

  /** The line Mochi is talking about right now, if the board could tell. */
  focusSnapshot = () => this.focusedId;

  add(item: NewItem): number {
    const id = this.nextId++;
    this.items = [...this.items, { ...item, id } as BoardItem].slice(-MAX_ITEMS);
    this.emit();
    return id;
  }

  update<K extends BoardItem["kind"]>(id: number, kind: K, patch: Partial<Extract<BoardItem, { kind: K }>>): boolean {
    let found = false;
    this.items = this.items.map((it) => {
      if (it.id !== id || it.kind !== kind) return it;
      found = true;
      return { ...it, ...patch } as BoardItem;
    });
    if (found) this.emit();
    return found;
  }

  find<K extends BoardItem["kind"]>(id: number, kind: K): Extract<BoardItem, { kind: K }> | undefined {
    const it = this.items.find((i) => i.id === id && i.kind === kind);
    return it as Extract<BoardItem, { kind: K }> | undefined;
  }

  latest<K extends BoardItem["kind"]>(kind: K): Extract<BoardItem, { kind: K }> | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].kind === kind) return this.items[i] as Extract<BoardItem, { kind: K }>;
    }
    return undefined;
  }

  /** Put a chalk mark on a line. */
  mark(id: number, style: MarkStyle, label?: string): boolean {
    const line = this.find(id, "line");
    if (!line) return false;
    const marks = [...(line.marks ?? []).filter((m) => m.style !== style), { id: this.nextMarkId++, style, label }];
    return this.update(id, "line", { marks });
  }

  /** Take over another board's items, as the phone does with the laptop's snapshots. */
  replace(items: BoardItem[], focus: number | null): void {
    this.items = items;
    this.nextId = Math.max(this.nextId, ...items.map((i) => i.id + 1));
    this.focusedId = focus;
    this.emit();
  }

  focus(id: number | null): void {
    if (id === this.focusedId) return;
    this.focusedId = id;
    this.emit();
  }

  clear(): void {
    this.items = [];
    this.focusedId = null;
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

export function useBoardItems(store: BoardStore): BoardItem[] {
  return useSyncExternalStore(store.subscribe, store.snapshot);
}

export function useBoardFocus(store: BoardStore): number | null {
  return useSyncExternalStore(store.subscribe, store.focusSnapshot);
}
