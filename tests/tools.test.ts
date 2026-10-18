import { beforeEach, describe, expect, test } from "bun:test";
import { BoardStore } from "../src/board/store";
import { runTool, seedTools, type ToolContext } from "../src/board/tools";
import { stripEmoji } from "../src/shared/text";

let board: BoardStore;
let reactions: string[];
let ctx: ToolContext;
const signal = new AbortController().signal;

beforeEach(() => {
  seedTools(42);
  board = new BoardStore();
  reactions = [];
  ctx = {
    board,
    takeNotebookPhoto: async () => ({ dataUrl: "data:image/jpeg;base64,AAAA", base64: "AAAA" }),
    react: (e, g) => reactions.push(`${e}/${g}`),
    onBoardChange: () => {},
    locate: async () => [210, 50, 260, 740],
  };
});

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await runTool({ id: "c1", name, args }, ctx, signal);
  return { ...res, response: res.response ?? {} };
};

describe("board tools", () => {
  test("write_on_board adds lines and strips emojis", async () => {
    const res = await call("write_on_board", {
      lines: [
        { kind: "title", content: "Probability 🎲" },
        { kind: "math", content: "P = \\frac{1}{6}" },
        { kind: "weird", content: "falls back to text" },
        { kind: "text", content: "   " },
      ],
    });
    expect(res.response).toEqual({ written: 3 });
    expect(board.snapshot().map((i) => (i.kind === "line" ? `${i.line}:${i.content}` : i.kind))).toEqual([
      "title:Probability",
      "math:P = \\frac{1}{6}",
      "text:falls back to text",
    ]);
  });

  test("clear_first wipes before writing", async () => {
    await call("write_on_board", { lines: [{ kind: "text", content: "old" }] });
    await call("write_on_board", { clear_first: true, lines: [{ kind: "text", content: "new" }] });
    expect(board.snapshot()).toHaveLength(1);
  });

  test("calculate returns exact values and fractions", async () => {
    const res = await call("calculate", { expression: "6/36" });
    expect(res.response).toEqual({ expression: "6/36", result: "0.1666666667", fraction: "1/6" });
    expect(board.latest("calc")?.fraction).toBe("1/6");
  });

  test("errors go back to the model as data", async () => {
    expect((await call("calculate", { expression: "2 +" })).response.error).toBeString();
    expect((await call("nope")).response.error).toContain("no tool called nope");
    expect((await call("plot_function", { expression: "x + q", x_min: 0, x_max: 1 })).response.error).toContain(
      'Unknown name "q"',
    );
  });

  test("monty hall full game", async () => {
    expect((await call("monty_hall", { action: "pick", door: 1 })).response.error).toContain("start");
    await call("monty_hall", { action: "start" });
    const pick = (await call("monty_hall", { action: "pick", door: 2 })).response;
    expect(pick.picked).toBe(2);
    expect([1, 3]).toContain(pick.host_opened as number);
    const end = (await call("monty_hall", { action: "switch" })).response;
    expect(end.switched).toBe(true);
    expect(end.final_door).not.toBe(2);
    expect(end.final_door).not.toBe(pick.host_opened);
    const sim = (await call("monty_hall", { action: "simulate", games: 3000 })).response;
    expect(sim.switch_win_rate as number).toBeGreaterThan(0.6);
    expect(board.snapshot().filter((i) => i.kind === "monty")).toHaveLength(1);
  });

  test("distribution returns the shaded probability", async () => {
    const res = (await call("show_distribution", { family: "binomial", n: 10, p: 0.5, from: 3, to: 3 })).response;
    expect(res.probability).toBeCloseTo(0.1171875, 8);
    expect(res.mean).toBe(5);
    const bad = (await call("show_distribution", { family: "binomial", n: 10, p: 1.5 })).response;
    expect(bad.error).toContain("p must be");
  });

  test("coins clamp the flip count", async () => {
    const res = (await call("flip_coins", { flips: 999999 })).response;
    expect(res.flips).toBe(10000);
  });

  test("notebook photo goes back as an image part, then can be marked", async () => {
    expect((await call("mark_notebook", { box_2d: [1, 1, 2, 2], label: "x" })).response.error).toContain(
      "look_at_notebook",
    );
    const res = await call("look_at_notebook");
    expect(res.parts?.[0]?.inlineData?.mimeType).toBe("image/jpeg");
    const res2 = await call("mark_notebook", {
      step_text: "favourable = (1,6), (2,5)",
      box_2d: [150, 178, 212, 586],
      label: "missed (6,1)",
      verdict: "mistake",
    });
    expect(res2.response).toEqual({ marked: true });
    // The rough box shows at once, then moves to the precise one.
    await new Promise((r) => setTimeout(r, 0));
    const marks = board.latest("notebook")?.marks ?? [];
    expect(marks).toHaveLength(1);
    expect(marks[0].box).toEqual([210, 50, 260, 740]);
    expect(marks[0].refined).toBe(true);
    // No usable box and no text is an error the model can fix.
    expect((await call("mark_notebook", { box_2d: [300, 50, 200, 900], label: "bad" })).response.error).toBeString();
    // A bad box with text stays hidden until it's located.
    ctx.locate = async () => null;
    await call("mark_notebook", { step_text: "P = 5/36", box_2d: [1, 2], label: "x" });
    expect(board.latest("notebook")?.marks.at(-1)?.hidden).toBe(true);
  });

  test("no camera means a spoken fallback", async () => {
    ctx.takeNotebookPhoto = async () => null;
    expect((await call("look_at_notebook")).response.error).toContain("No camera");
  });

  test("react validates its enums", async () => {
    await call("react", { emotion: "evil", gesture: "cheer" });
    expect(reactions).toEqual(["happy/cheer"]);
  });
});

describe("stripEmoji", () => {
  test("removes pictographs and joiners but keeps Hindi", () => {
    expect(stripEmoji("Shabaash! 🎉👍🏽 बहुत बढ़िया")).toBe("Shabaash! बहुत बढ़िया");
    expect(stripEmoji("P(A) = 1/2")).toBe("P(A) = 1/2");
  });
});
