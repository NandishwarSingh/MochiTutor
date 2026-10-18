import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { type BoardItem, type BoardStore, useBoardItems } from "./store";
import { RichText, Tex } from "./Tex";
import { CoinFlips } from "./widgets/CoinFlips";
import { Distribution } from "./widgets/Distribution";
import { MontyHall } from "./widgets/MontyHall";
import { Plot } from "./widgets/Plot";

/** Lines appear left to right, like they're being written in chalk. */
function Written({ children, delay, length }: { children: React.ReactNode; delay: number; length: number }) {
  return (
    <motion.div
      initial={{ clipPath: "inset(-20% 100% -20% 0)", opacity: 0.4 }}
      animate={{ clipPath: "inset(-20% 0% -20% 0)", opacity: 1 }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.25 } }}
      transition={{ delay, duration: Math.min(1.3, 0.35 + length * 0.018), ease: [0.3, 0.1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Item({ item, delay }: { item: BoardItem; delay: number }) {
  switch (item.kind) {
    case "line":
      if (item.line === "math") {
        return (
          <Written delay={delay} length={item.content.length}>
            <div className="line line-math">
              <Tex tex={item.content} display />
            </div>
          </Written>
        );
      }
      return (
        <Written delay={delay} length={item.content.length}>
          <div className={`line line-${item.line}`}>
            {item.line === "step" && <span className="step-dot">→</span>}
            <span>
              <RichText text={item.content} />
            </span>
          </div>
        </Written>
      );
    case "calc":
      return (
        <Written delay={delay} length={item.expression.length + item.text.length}>
          <div className="line calc">
            {item.expression} <span className="eq">= {item.text}</span>
            {item.fraction && <span className="eq"> = {item.fraction}</span>}
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
    case "notebook":
      return (
        <Pop delay={delay}>
          <div className="notebook">
            <div className="notebook-photo">
              <img src={item.image} alt="The student's notebook" />
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

function Pop({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      transition={{ delay, duration: 0.35, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function Board({ store }: { store: BoardStore }) {
  const items = useBoardItems(store);
  const scroller = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<number>());
  const delays = useRef(new Map<number, number>());

  // Items that arrive together are written one after another.
  let batch = 0;
  for (const it of items) {
    if (!seen.current.has(it.id)) {
      seen.current.add(it.id);
      delays.current.set(it.id, batch * 0.32);
      batch++;
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the item list changes
  useEffect(() => {
    const el = scroller.current;
    if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }));
  }, [items]);

  return (
    <div className="board-scroll" ref={scroller}>
      <div className="board-items">
        <AnimatePresence initial={false}>
          {items.map((it) => (
            <Item key={it.id} item={it} delay={delays.current.get(it.id) ?? 0} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
