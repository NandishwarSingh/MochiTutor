import type { TreeSpec } from "../store";
import { RichText } from "../Tex";
import { Appear, Label, Stroke } from "./ink";

// A probability tree growing left to right, one level at a time. A highlighted
// path is drawn in yellow with its product at the end.

const W = 560;
const PAD = 24;
const LEAF_SPACE = 150;
const ROW = 50;
/** Rough width of a chalk label, so a node's children start after its name. */
const labelWidth = (label: string) => label.length * 9 + 14;

interface Node {
  key: string;
  path: string[];
  label: string;
  probability: string;
  depth: number;
  x: number;
  y: number;
  children: Node[];
}

const keyOf = (path: string[]) => path.join(" > ");

export function Tree({ spec }: { spec: TreeSpec }) {
  // Build the tree from the flat branch list.
  const root: Node = { key: "", path: [], label: "", probability: "", depth: 0, x: 0, y: 0, children: [] };
  const byKey = new Map<string, Node>([["", root]]);
  for (const b of spec.branches) {
    const parent = byKey.get(keyOf(b.path));
    if (!parent) continue;
    const path = [...b.path, b.label];
    const node: Node = {
      key: keyOf(path),
      path,
      label: b.label,
      probability: b.probability,
      depth: path.length,
      x: 0,
      y: 0,
      children: [],
    };
    parent.children.push(node);
    byKey.set(node.key, node);
  }
  const depth = Math.max(1, ...[...byKey.values()].map((n) => n.depth));
  const leaves: Node[] = [];
  const collect = (n: Node) => {
    if (!n.children.length && n !== root) leaves.push(n);
    for (const c of n.children) collect(c);
  };
  collect(root);
  const H = Math.max(160, leaves.length * ROW + 2 * PAD);
  const col = (W - 2 * PAD - LEAF_SPACE) / depth;
  leaves.forEach((l, i) => {
    l.y = leaves.length === 1 ? H / 2 : PAD + ROW / 2 + (i * (H - 2 * PAD - ROW)) / (leaves.length - 1);
  });
  const place = (n: Node): number => {
    n.x = PAD + n.depth * col;
    if (n.children.length) n.y = n.children.map(place).reduce((a, b) => a + b, 0) / n.children.length;
    return n.y;
  };
  place(root);

  const lit = new Set<string>();
  if (spec.highlight?.length)
    for (let i = 1; i <= spec.highlight.length; i++) lit.add(keyOf(spec.highlight.slice(0, i)));
  const litLeaf = spec.highlight?.length ? byKey.get(keyOf(spec.highlight)) : undefined;

  const branches: Array<{ from: Node; to: Node }> = [];
  for (const n of byKey.values()) for (const c of n.children) branches.push({ from: n, to: c });
  const levelStart = (d: number) => 0.25 + (d - 1) * 0.75;

  return (
    <div className="widget tree">
      {spec.title && (
        <p className="widget-title">
          <RichText text={spec.title} />
        </p>
      )}
      <svg className="chart ink" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img">
        <Appear delay={0}>
          <circle cx={root.x} cy={root.y} r={5} fill="var(--chalk)" />
        </Appear>
        {branches.map(({ from, to }) => {
          const on = lit.has(to.key);
          const start = levelStart(to.depth);
          const mx = (from.x + to.x) / 2;
          const my = (from.y + to.y) / 2;
          return (
            <g key={to.key}>
              <Stroke
                d={`M${from === root ? from.x : from.x + labelWidth(from.label)},${from.y} L${to.x - 6},${to.y}`}
                color={on ? "yellow" : "chalk"}
                width={on ? 3.2 : 2}
                delay={start}
                duration={0.5}
              />
              <Appear delay={start + 0.35}>
                <Label
                  x={mx + labelWidth(from.label) / 2}
                  y={my - 14}
                  text={to.probability}
                  color={on ? "yellow" : "blue"}
                  size={16}
                />
                <Label x={to.x} y={to.y} text={to.label} color={on ? "yellow" : "chalk"} anchor="start" size={17} />
              </Appear>
            </g>
          );
        })}
        {litLeaf && spec.product && (
          <Appear delay={levelStart(depth) + 0.9}>
            <Label
              x={litLeaf.x + labelWidth(litLeaf.label)}
              y={litLeaf.y}
              text={`= ${spec.product.value}`}
              color="yellow"
              anchor="start"
              size={17}
            />
          </Appear>
        )}
      </svg>
      {litLeaf && spec.product && (
        <p className="widget-caption">
          P({spec.highlight?.join(", then ")}) = {spec.product.expression} = <strong>{spec.product.value}</strong>
        </p>
      )}
    </div>
  );
}
