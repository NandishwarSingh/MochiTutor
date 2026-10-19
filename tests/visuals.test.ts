import { beforeEach, describe, expect, test } from "bun:test";
import { BoardStore } from "../src/board/store";
import { runTool, type ToolContext } from "../src/board/tools";
import { niceStep, vennRegions } from "../src/board/visual-tools";

let board: BoardStore;
let ctx: ToolContext;
const signal = new AbortController().signal;

beforeEach(() => {
  board = new BoardStore();
  ctx = {
    board,
    takeNotebookPhoto: async () => null,
    react: () => {},
    onBoardChange: () => {},
    findImage: async (q) =>
      q === "ludo dice"
        ? { id: "abc123", title: "Ludo game", credit: "Someone, CC BY-SA 4.0, via Wikimedia Commons" }
        : null,
  };
});

const call = async (name: string, args: Record<string, unknown>) =>
  (await runTool({ id: "t", name, args }, ctx, signal)).response ?? {};

describe("vennRegions", () => {
  const two = ["Cricket", "Football"];
  const three = ["A", "B", "C"];
  test("unions, intersections, only and neither", () => {
    expect(vennRegions("A or B", two).sort()).toEqual(["01", "10", "11"]);
    expect(vennRegions("A and B", two)).toEqual(["11"]);
    expect(vennRegions("A only", two)).toEqual(["10"]);
    expect(vennRegions("only B", two)).toEqual(["01"]);
    expect(vennRegions("neither", two)).toEqual(["00"]);
    expect(vennRegions("cricket and not football", two)).toEqual(["10"]);
    expect(vennRegions("A ∩ B", two)).toEqual(["11"]);
    expect(vennRegions("A'", two).sort()).toEqual(["00", "01"]);
  });
  test("three sets", () => {
    expect(vennRegions("A and B only", three)).toEqual(["110"]);
    expect(vennRegions("A and B", three).sort()).toEqual(["110", "111"]);
    expect(vennRegions("A and not C", three).sort()).toEqual(["100", "110"]);
    expect(vennRegions("A and B and C", three)).toEqual(["111"]);
    expect(() => vennRegions("D", three)).toThrow();
  });
});

describe("visual tools", () => {
  test("probability_tree multiplies along the highlighted path", async () => {
    const res = await call("probability_tree", {
      branches: [
        { from: "", label: "Red", probability: "3/5" },
        { from: "", label: "Blue", probability: "2/5" },
        { from: "Red", label: "Red", probability: "2/4" },
        { from: "Red", label: "Blue", probability: "2/4" },
        { from: "Green", label: "Orphan", probability: "1" },
      ],
      highlight: "Red > Blue",
    });
    expect(res).toEqual({ branches: 4, highlighted_probability: "3/10" });
    const bad = await call("probability_tree", {
      branches: [{ from: "", label: "H", probability: "1/2" }],
      highlight: "T",
    });
    expect(String(bad.error)).toContain("isn't a path");
  });

  test("draw_diagram fills in ranges, keeps geometry square and reports bad items", async () => {
    const res = await call("draw_diagram", {
      items: [
        {
          type: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 0, y: 3 },
          ],
        },
        { type: "circle", x: 0, y: 0 },
        { type: "function", expression: "x^^2" },
      ],
    });
    expect(res.drawn).toBe(1);
    expect((res.skipped as string[]).length).toBe(2);
    const [x0, x1] = res.x_range as number[];
    const [y0, y1] = res.y_range as number[];
    expect(x0).toBeLessThan(0);
    expect(x1).toBeGreaterThan(4);
    expect(y1 - y0).toBeGreaterThan(3);
    const spec = board.latest("diagram")?.spec;
    expect(spec?.equal).toBe(true);
  });

  test("graphs get a y range from the curve", async () => {
    const res = await call("draw_diagram", {
      x_min: -3,
      x_max: 3,
      items: [
        { type: "function", expression: "x^2" },
        { type: "tangent", expression: "x^2", from: 2, to: -2 },
      ],
    });
    const [y0, y1] = res.y_range as number[];
    expect(y0).toBeLessThan(0);
    expect(y1).toBeGreaterThan(9);
    const tangent = board.latest("diagram")?.spec.shapes[1];
    expect(tangent?.type === "tangent" && [tangent.from, tangent.to]).toEqual([-2, 2]);
  });

  test("number_line picks a tick step and keeps open ends", async () => {
    const res = await call("number_line", {
      from: -10,
      to: 10,
      intervals: [{ from: 1, from_open: true }],
      jumps: [{ from: -3, to: 2, label: "+5" }],
    });
    expect(res.step).toBe(2);
    const spec = board.latest("numberline")?.spec;
    expect(spec?.intervals[0]).toMatchObject({ from: 1, to: null, fromOpen: true });
    expect(niceStep(7)).toBe(1);
  });

  test("venn_diagram places values only in single regions", async () => {
    const res = await call("venn_diagram", {
      sets: ["A", "B", "C"],
      values: [
        { region: "A and B only", value: "4" },
        { region: "A and B", value: "9" },
      ],
      shade: "A or C",
    });
    expect(res.values).toBe(1);
    expect((res.skipped as string[])[0]).toContain("covers 2 parts");
    expect(board.latest("venn")?.spec.shaded.length).toBe(6);
  });

  test("bar_chart returns the statistics it drew", async () => {
    const res = await call("bar_chart", {
      bars: [
        { label: "a", value: 6 },
        { label: "b", value: 10 },
        { label: "c", value: 4 },
        { label: "d", value: 12 },
      ],
      show_mean: true,
    });
    expect(res).toEqual({ bars: 4, total: 32, mean: 8, median: 8 });
    expect(board.latest("bars")?.spec.mean).toBe(8);
  });

  test("show_image pins the picture with its credit, or says nothing was found", async () => {
    const res = await call("show_image", { query: "ludo dice", caption: "One die" });
    expect(res).toEqual({ showing: "Ludo game", credit: "Someone, CC BY-SA 4.0, via Wikimedia Commons" });
    expect(board.latest("image")).toMatchObject({ src: "/api/images/abc123", caption: "One die" });
    const none = await call("show_image", { query: "unicorn ticket" });
    expect(String(none.error)).toContain("No free picture");
  });
});
