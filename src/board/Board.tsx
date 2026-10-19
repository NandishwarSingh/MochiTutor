import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { plainText } from "./follow";
import { Marks } from "./Marks";
import { type BoardItem, type BoardStore, useBoardFocus, useBoardItems } from "./store";
import { RichText, Tex } from "./Tex";
import { BarChart } from "./widgets/BarChart";
import { CoinFlips } from "./widgets/CoinFlips";
import { Diagram } from "./widgets/Diagram";
import { Distribution } from "./widgets/Distribution";
import { MontyHall } from "./widgets/MontyHall";
import { NumberLine } from "./widgets/NumberLine";
import { Picture } from "./widgets/Picture";
import { Plot } from "./widgets/Plot";
import { Tree } from "./widgets/Tree";
import { Venn } from "./widgets/Venn";

/** How far behind the newest writing may start, in ms. */
const MAX_BACKLOG_MS = 2500;

/** How long writing an item takes, in seconds: chalk speed for text, a short pop for pictures. */
export function writeSeconds(item: BoardItem): number {
  if (item.kind === "line") return Math.min(1.6, Math.max(0.5, 0.35 + plainText(item.content).length * 0.026));
  if (item.kind === "calc") return Math.min(1.4, 0.35 + (item.expression.length + item.text.length) * 0.025);
  // Pictures that draw themselves in hold the queue for about as long as they take.
  if (item.kind === "diagram") return Math.min(4, 0.6 + item.spec.shapes.length * 0.45);
  if (item.kind === "tree")
    return Math.min(3.5, 0.8 + Math.max(...item.spec.branches.map((b) => b.path.length + 1)) * 0.75);
  if (item.kind === "venn") return 2.4;
  if (item.kind === "numberline")
    return Math.min(3.5, 1 + item.spec.jumps.length * 0.9 + item.spec.intervals.length * 0.6);
  if (item.kind === "bars") return Math.min(3, 0.8 + item.spec.bars.length * 0.18);
  return 0.5;
}

/** Mounts its children only when their turn comes, so their own draw-in animations start then. */
function Later({ delay, children }: { delay: number; children: React.ReactNode }) {
  const [ready, setReady] = useState(delay <= 0);
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setReady(true), delay * 1000);
    return () => clearTimeout(t);
  }, [delay, ready]);
  return ready ? children : null;
}

/** Lines appear left to right, like they're being written in chalk. */
function Written({ children, delay, seconds }: { children: React.ReactNode; delay: number; seconds: number }) {
  return (
    <motion.div
      initial={{ clipPath: "inset(-30% 100% -30% -10%)", opacity: 0.5 }}
      // The end state reaches well past the line so chalk marks around it aren't clipped.
      animate={{ clipPath: "inset(-100% -100% -100% -100%)", opacity: 1 }}
      transition={{ delay, duration: seconds, ease: [0.35, 0.1, 0.35, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Pop({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

function Pointer() {
  return (
    <motion.span
      className="pointer"
      layoutId="chalk-pointer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      aria-hidden="true"
    />
  );
}

function Line({
  item,
  focused,
  after,
}: {
  item: Extract<BoardItem, { kind: "line" }>;
  focused: boolean;
  after: number;
}) {
  const body =
    item.line === "math" ? (
      <Tex tex={item.content} display />
    ) : (
      <>
        {item.line === "step" && <span className="step-dot">→</span>}
        <span>
          <RichText text={item.content} />
        </span>
      </>
    );
  // The final answer always gets a chalk box around it.
  const marks =
    item.line === "answer"
      ? [{ id: -item.id, style: "box" as const, delay: after }, ...(item.marks ?? [])]
      : item.marks;
  return (
    <div className={`line line-${item.line}`} data-focused={focused || undefined}>
      {focused && <Pointer />}
      <span className="line-ink">
        {body}
        <Marks marks={marks} />
      </span>
    </div>
  );
}

function Item({ item, delay, focused }: { item: BoardItem; delay: number; focused: boolean }) {
  const seconds = writeSeconds(item);
  switch (item.kind) {
    case "line":
      return (
        <Written delay={delay} seconds={seconds}>
          <Line item={item} focused={focused} after={delay + seconds} />
        </Written>
      );
    case "calc":
      return (
        <Written delay={delay} seconds={seconds}>
          <div className="line calc">
            {item.expression}{" "}
            {item.fraction && item.fraction !== item.expression ? (
              <span className="eq">
                = {item.fraction} <span className="approx">≈ {Number(item.text).toPrecision(4)}</span>
              </span>
            ) : (
              <span className="eq">= {item.text}</span>
            )}
          </div>
        </Written>
      );
    case "coins":
      return (
        <Pop delay={delay}>
          <CoinFlips run={item.run} />
        </Pop>
      );
    case "monty":
      return (
        <Pop delay={delay}>
          <MontyHall game={item.game} sim={item.sim} />
        </Pop>
      );
    case "distribution":
      return (
        <Pop delay={delay}>
          <Distribution family={item.family} params={item.params} from={item.from} to={item.to} />
        </Pop>
      );
    case "plot":
      return (
        <Pop delay={delay}>
          <Plot expression={item.expression} xMin={item.xMin} xMax={item.xMax} label={item.label} />
        </Pop>
      );
    case "diagram":
      return (
        <Later delay={delay}>
          <Diagram spec={item.spec} />
        </Later>
      );
    case "tree":
      return (
        <Later delay={delay}>
          <Tree spec={item.spec} />
        </Later>
      );
    case "numberline":
      return (
        <Later delay={delay}>
          <NumberLine spec={item.spec} />
        </Later>
      );
    case "venn":
      return (
        <Later delay={delay}>
          <Venn spec={item.spec} />
        </Later>
      );
    case "bars":
      return (
        <Later delay={delay}>
          <BarChart spec={item.spec} />
        </Later>
      );
    case "image":
      return (
        <Pop delay={delay}>
          <Picture src={item.src} title={item.title} credit={item.credit} caption={item.caption} />
        </Pop>
      );
    case "notebook":
      return (
        <Pop delay={delay}>
          <div className="notebook">
            <div className="notebook-photo">
              {item.image ? (
                <img src={item.image} alt="The student's notebook" />
              ) : (
                <div className="notebook-wait">Photo on its way</div>
              )}
              {item.marks
                .filter((m) => !m.hidden)
                .map((m) => (
                  <motion.div
                    key={m.id}
                    className="mark"
                    data-verdict={m.verdict}
                    initial={{ opacity: 0, scale: 1.15 }}
                    animate={{
                      opacity: 1,
                      scale: 1,
                      top: `${m.box[0] / 10}%`,
                      left: `${m.box[1] / 10}%`,
                      height: `${(m.box[2] - m.box[0]) / 10}%`,
                      width: `${(m.box[3] - m.box[1]) / 10}%`,
                    }}
                    transition={{ duration: 0.45, ease: "easeOut" }}
                  >
                    {m.label && <span>{m.label}</span>}
                  </motion.div>
                ))}
            </div>
          </div>
        </Pop>
      );
  }
}

/** Split items into pages at the given first ids. */
function paginate(items: BoardItem[], starts: number[]): BoardItem[][] {
  const pages: BoardItem[][] = [[]];
  let next = 0;
  for (const it of items) {
    while (next < starts.length && it.id >= starts[next]) {
      pages.push([]);
      next++;
    }
    pages[pages.length - 1].push(it);
  }
  return pages.filter((p, i) => p.length || i === pages.length - 1);
}

export function Board({ store }: { store: BoardStore }) {
  const items = useBoardItems(store);
  const focused = useBoardFocus(store);
  const page = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<number>());
  const delays = useRef(new Map<number, number>());
  const busyUntil = useRef(0);
  /** First item id of every page after the first. */
  const [starts, setStarts] = useState<number[]>([]);
  /** A page the student flipped back to, or null for the newest. */
  const [viewing, setViewing] = useState<number | null>(null);
  const lastId = items.at(-1)?.id ?? 0;
  // Pictures mount when their turn comes and grow the page after it was measured, so watch sizes too.
  const [, remeasure] = useReducer((n: number) => n + 1, 0);
  const sizes = useRef<ResizeObserver | null>(null);
  useEffect(() => () => sizes.current?.disconnect(), []);

  // Items that arrive together are written one after another, and a new batch
  // waits for the previous one to finish, the way a teacher writes.
  // The queue never runs more than a few seconds behind, or the board would lag what she says.
  const now = performance.now();
  let cursor = Math.min(Math.max(now, busyUntil.current), now + MAX_BACKLOG_MS);
  for (const it of items) {
    if (seen.current.has(it.id)) continue;
    seen.current.add(it.id);
    delays.current.set(it.id, (cursor - now) / 1000);
    cursor += (writeSeconds(it) + 0.12) * 1000;
  }
  busyUntil.current = cursor;

  const pages = paginate(
    items,
    starts.filter((s) => items.some((i) => i.id <= s)),
  );
  const current = viewing === null ? pages.length - 1 : Math.min(viewing, pages.length - 1);
  const shown = pages[current] ?? [];

  // A new item always brings the student back to the newest page.
  const lastSeenId = useRef(lastId);
  if (lastSeenId.current !== lastId) {
    lastSeenId.current = lastId;
    if (viewing !== null) setViewing(null);
  }

  // A cleared board starts over at page one.
  if (!items.length && starts.length) setStarts([]);

  // When the newest page overflows its columns, start a new page at the first item that didn't fit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure after every change to what is shown
  useLayoutEffect(() => {
    const el = page.current;
    if (el && typeof ResizeObserver !== "undefined") {
      sizes.current ??= new ResizeObserver(() => remeasure());
      for (const k of el.children) sizes.current.observe(k);
    }
    if (!el || current !== pages.length - 1 || el.scrollWidth <= el.clientWidth + 4) return;
    const kids = [...el.children] as HTMLElement[];
    const first = kids.findIndex(
      (k) => k.offsetLeft >= el.clientWidth - 4 || k.offsetTop + k.offsetHeight > el.clientHeight + 4,
    );
    if (first <= 0) return;
    const id = Number(kids[first].dataset.id);
    if (id && !starts.includes(id)) setStarts((s) => [...s, id]);
  }, [shown, current, pages.length]);

  return (
    <div className="board-pages">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={shown[0]?.id ?? `empty-${current}`}
          // The page leaving would clear a plain ref as it unmounts, after the new page has set it.
          ref={(node: HTMLDivElement | null) => {
            if (node) page.current = node;
          }}
          className="board-page"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          {shown.map((it) => (
            <div key={it.id} className="board-item" data-id={it.id}>
              <Item item={it} delay={delays.current.get(it.id) ?? 0} focused={focused === it.id} />
            </div>
          ))}
        </motion.div>
      </AnimatePresence>
      {pages.length > 1 && (
        <nav className="pager" aria-label="Board pages">
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setViewing(Math.max(0, current - 1))}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span>
            Page {current + 1} of {pages.length}
          </span>
          <button
            type="button"
            disabled={current === pages.length - 1}
            onClick={() => setViewing(current + 1 >= pages.length - 1 ? null : current + 1)}
            aria-label="Next page"
          >
            ›
          </button>
        </nav>
      )}
    </div>
  );
}
