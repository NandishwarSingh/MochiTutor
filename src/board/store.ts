import { useSyncExternalStore } from "react";
import type { CoinRun, MontyGame, MontySimulation } from "../lib/simulations";
import type { DistributionFamily, DistributionParams } from "../lib/stats";

export type LineKind = "title" | "text" | "math" | "step";

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
  | { id: number; kind: "line"; line: LineKind; content: string }
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
  | { id: number; kind: "notebook"; image: string; marks: NotebookMark[] };

type NewItem = BoardItem extends infer T ? (T extends BoardItem ? Omit<T, "id"> : never) : never;

const MAX_ITEMS = 40;

/** Everything on the board. A tiny external store so tool handlers can write to it outside React. */
export class BoardStore {
  private items: BoardItem[] = [];
  private nextId = 1;
  private readonly listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = () => this.items;

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

  clear(): void {
    this.items = [];
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

export function useBoardItems(store: BoardStore): BoardItem[] {
  return useSyncExternalStore(store.subscribe, store.snapshot);
}
