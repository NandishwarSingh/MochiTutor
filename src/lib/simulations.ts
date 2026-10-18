import type { Rng } from "./rng";

export interface CoinRun {
  flips: number;
  p: number;
  heads: number;
  tails: number;
  /** first few results, true = heads, for the animated coins */
  firstResults: boolean[];
  /** running share of heads, sampled at most `points` times, as [flipNumber, share] */
  running: Array<[number, number]>;
}

export function flipCoins(flips: number, p: number, rng: Rng, points = 240): CoinRun {
  const step = Math.max(1, Math.floor(flips / points));
  const running: Array<[number, number]> = [];
  const firstResults: boolean[] = [];
  let heads = 0;
  for (let i = 1; i <= flips; i++) {
    const h = rng() < p;
    if (h) heads++;
    if (i <= 12) firstResults.push(h);
    if (i % step === 0 || i === flips || i <= 20) running.push([i, heads / i]);
  }
  return { flips, p, heads, tails: flips - heads, firstResults, running };
}

export type Door = 1 | 2 | 3;
const DOORS: Door[] = [1, 2, 3];

export type MontyGame =
  | { phase: "choose"; car: Door }
  | { phase: "decide"; car: Door; picked: Door; opened: Door }
  | { phase: "done"; car: Door; picked: Door; opened: Door; final: Door; switched: boolean; won: boolean };

export function newMontyGame(rng: Rng): MontyGame {
  return { phase: "choose", car: DOORS[Math.floor(rng() * 3)] };
}

export function pickDoor(game: MontyGame, door: Door, rng: Rng): MontyGame {
  if (game.phase !== "choose") throw new Error("A door is already picked. Switch or stay, or start a new game.");
  const options = DOORS.filter((d) => d !== door && d !== game.car);
  const opened = options[Math.floor(rng() * options.length)];
  return { phase: "decide", car: game.car, picked: door, opened };
}

export function decide(game: MontyGame, switchDoor: boolean): MontyGame {
  if (game.phase !== "decide") throw new Error("Pick a door first.");
  const final = switchDoor ? (DOORS.find((d) => d !== game.picked && d !== game.opened) as Door) : game.picked;
  return { ...game, phase: "done", final, switched: switchDoor, won: final === game.car };
}

export interface MontySimulation {
  games: number;
  switchWins: number;
  stayWins: number;
  /** running win rates sampled for the chart, as [game, switchRate, stayRate] */
  running: Array<[number, number, number]>;
}

export function simulateMonty(games: number, rng: Rng, points = 200): MontySimulation {
  const step = Math.max(1, Math.floor(games / points));
  const running: Array<[number, number, number]> = [];
  let switchWins = 0;
  let stayWins = 0;
  for (let i = 1; i <= games; i++) {
    const game = newMontyGame(rng);
    // Staying wins exactly when the first pick was the car; otherwise switching wins.
    if (DOORS[Math.floor(rng() * 3)] === game.car) stayWins++;
    else switchWins++;
    if (i % step === 0 || i === games) running.push([i, switchWins / i, stayWins / i]);
  }
  return { games, switchWins, stayWins, running };
}
