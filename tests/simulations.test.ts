import { describe, expect, test } from "bun:test";
import { mulberry32 } from "../src/lib/rng";
import { decide, flipCoins, newMontyGame, pickDoor, simulateMonty } from "../src/lib/simulations";

describe("coin flips", () => {
  test("counts add up and the share converges", () => {
    const run = flipCoins(20000, 0.5, mulberry32(7));
    expect(run.heads + run.tails).toBe(20000);
    expect(run.heads / 20000).toBeGreaterThan(0.48);
    expect(run.heads / 20000).toBeLessThan(0.52);
    expect(run.firstResults).toHaveLength(12);
    expect(run.running.at(-1)?.[0]).toBe(20000);
    expect(run.running.length).toBeLessThan(300);
  });

  test("a biased coin", () => {
    const run = flipCoins(10000, 0.8, mulberry32(3));
    expect(run.heads / 10000).toBeGreaterThan(0.77);
  });

  test("a single flip", () => {
    const run = flipCoins(1, 0.5, mulberry32(1));
    expect(run.running).toHaveLength(1);
  });
});

describe("monty hall", () => {
  test("the host never opens the car or the picked door", () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 2000; i++) {
      const g = pickDoor(newMontyGame(rng), ((i % 3) + 1) as 1 | 2 | 3, rng);
      if (g.phase !== "decide") throw new Error("expected decide");
      expect(g.opened).not.toBe(g.car);
      expect(g.opened).not.toBe(g.picked);
    }
  });

  test("switching wins exactly when staying loses", () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 500; i++) {
      const g = pickDoor(newMontyGame(rng), 1, rng);
      const stay = decide(g, false);
      const sw = decide(g, true);
      if (stay.phase !== "done" || sw.phase !== "done") throw new Error("expected done");
      expect(stay.won).not.toBe(sw.won);
    }
  });

  test("game rules are enforced", () => {
    const rng = mulberry32(2);
    const g = newMontyGame(rng);
    expect(() => decide(g, true)).toThrow("Pick a door first");
    const picked = pickDoor(g, 2, rng);
    expect(() => pickDoor(picked, 3, rng)).toThrow("already picked");
  });

  test("simulation lands near two thirds", () => {
    const sim = simulateMonty(30000, mulberry32(9));
    expect(sim.switchWins + sim.stayWins).toBe(30000);
    expect(sim.switchWins / 30000).toBeGreaterThan(0.65);
    expect(sim.switchWins / 30000).toBeLessThan(0.68);
  });
});
