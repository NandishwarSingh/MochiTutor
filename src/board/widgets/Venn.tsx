import { useId } from "react";
import type { VennSpec } from "../store";
import { RichText } from "../Tex";
import { Appear, CHALK_FILL, Label, Stroke } from "./ink";

// Two or three overlapping sets. Regions are addressed by membership masks:
// for sets A, B, C the region "110" is in A and B but not C. Any mix of
// regions can be shaded, which covers "A or B", "only B", "neither" and so on.

interface Layout {
  W: number;
  H: number;
  circles: Array<{ cx: number; cy: number; r: number; lx: number; ly: number }>;
  centroids: Record<string, { x: number; y: number }>;
}

const TWO: Layout = {
  W: 520,
  H: 300,
  circles: [
    { cx: 205, cy: 150, r: 108, lx: 120, ly: 36 },
    { cx: 315, cy: 150, r: 108, lx: 400, ly: 36 },
  ],
  centroids: { "10": { x: 150, y: 150 }, "01": { x: 370, y: 150 }, "11": { x: 260, y: 150 }, "00": { x: 52, y: 272 } },
};

const THREE: Layout = {
  W: 520,
  H: 350,
  circles: [
    { cx: 210, cy: 140, r: 98, lx: 112, ly: 40 },
    { cx: 310, cy: 140, r: 98, lx: 408, ly: 40 },
    { cx: 260, cy: 222, r: 98, lx: 420, ly: 300 },
  ],
  centroids: {
    "100": { x: 168, y: 112 },
    "010": { x: 352, y: 112 },
    "001": { x: 260, y: 268 },
    "110": { x: 260, y: 96 },
    "101": { x: 202, y: 206 },
    "011": { x: 318, y: 206 },
    "111": { x: 260, y: 168 },
    "000": { x: 50, y: 330 },
  },
};

const NAMES = ["A", "B", "C"];

export function Venn({ spec }: { spec: VennSpec }) {
  const uid = useId().replace(/:/g, "");
  const L = spec.sets.length === 3 ? THREE : TWO;
  const n = L.circles.length;
  const universe = { x: 14, y: 14, w: L.W - 28, h: L.H - 28 };
  const drawn = 0.25 + n * 0.55;

  const region = (mask: string) => {
    const inside = [...mask].flatMap((b, i) => (b === "1" ? [i] : []));
    const outside = [...mask].flatMap((b, i) => (b === "0" ? [i] : []));
    let shape: React.ReactNode =
      inside.length === 0 ? (
        <rect x={universe.x} y={universe.y} width={universe.w} height={universe.h} fill={CHALK_FILL.yellow} />
      ) : (
        <circle
          cx={L.circles[inside[0]].cx}
          cy={L.circles[inside[0]].cy}
          r={L.circles[inside[0]].r}
          fill={CHALK_FILL.yellow}
        />
      );
    // Intersect with every other set the region is in.
    for (const i of inside.slice(1)) shape = <g clipPath={`url(#${uid}-c${i})`}>{shape}</g>;
    return (
      <g key={mask} mask={outside.length ? `url(#${uid}-out-${mask})` : undefined}>
        {shape}
      </g>
    );
  };

  return (
    <div className="widget venn">
      {spec.title && (
        <p className="widget-title">
          <RichText text={spec.title} />
        </p>
      )}
      <svg className="chart ink" viewBox={`0 0 ${L.W} ${L.H}`} width="100%" style={{ maxWidth: L.W }} role="img">
        <defs>
          {L.circles.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed layout
            <clipPath key={i} id={`${uid}-c${i}`}>
              <circle cx={c.cx} cy={c.cy} r={c.r} />
            </clipPath>
          ))}
          {spec.shaded.map((mask) => (
            <mask key={mask} id={`${uid}-out-${mask}`} maskUnits="userSpaceOnUse" x={0} y={0} width={L.W} height={L.H}>
              <rect x={0} y={0} width={L.W} height={L.H} fill="white" />
              {[...mask].map((b, i) =>
                b === "0" ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: one per set
                  <circle key={i} cx={L.circles[i].cx} cy={L.circles[i].cy} r={L.circles[i].r} fill="black" />
                ) : null,
              )}
            </mask>
          ))}
        </defs>
        <Stroke
          d={`M${universe.x},${universe.y} h${universe.w} v${universe.h} h${-universe.w} Z`}
          color="chalk"
          width={1.6}
          duration={0.6}
        />
        <Appear delay={drawn + 0.1}>{spec.shaded.map(region)}</Appear>
        {L.circles.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed layout
          <g key={i}>
            <Stroke
              d={`M${c.cx + c.r},${c.cy} A${c.r},${c.r} 0 1 1 ${c.cx - c.r},${c.cy} A${c.r},${c.r} 0 1 1 ${c.cx + c.r},${c.cy}`}
              color={(["blue", "pink", "green"] as const)[i]}
              width={2.6}
              delay={0.25 + i * 0.55}
              duration={0.7}
            />
            <Appear delay={0.6 + i * 0.55}>
              <Label
                x={c.lx}
                y={c.ly}
                text={`${NAMES[i]}: ${spec.sets[i]}`}
                color={(["blue", "pink", "green"] as const)[i]}
                size={16}
              />
            </Appear>
          </g>
        ))}
        {Object.entries(spec.values).map(([mask, value], k) => {
          const p = L.centroids[mask];
          if (!p) return null;
          return (
            <Appear key={mask} delay={drawn + 0.2 + k * 0.2} pop>
              <Label x={p.x} y={p.y} text={value} color="chalk" size={19} />
            </Appear>
          );
        })}
      </svg>
      {spec.caption && (
        <p className="widget-caption">
          Shaded: <strong>{spec.caption}</strong>
        </p>
      )}
    </div>
  );
}
