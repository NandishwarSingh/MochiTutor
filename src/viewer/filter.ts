// One Euro filter (Casiez et al. 2012): smooth when still, responsive when moving.

class OneEuro {
  private x: number | null = null;
  private dx = 0;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly dCutoff = 1,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, dt: number): number {
    if (this.x === null || dt <= 0) {
      this.x = value;
      return value;
    }
    const dValue = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dValue - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}

/** Filters a 4x4 pose: translation and rotation (as a quaternion) separately. */
export class PoseFilter {
  private readonly pos = [0, 1, 2].map(() => new OneEuro(1.2, 4));
  private readonly rot = [0, 1, 2, 3].map(() => new OneEuro(1.5, 2.5));
  private lastQ: number[] | null = null;

  filter(position: number[], quaternion: number[], dt: number): { position: number[]; quaternion: number[] } {
    let q = quaternion;
    // q and -q are the same rotation; keep the sign continuous so the filter doesn't flip.
    if (this.lastQ && q.reduce((s, v, i) => s + v * (this.lastQ as number[])[i], 0) < 0) q = q.map((v) => -v);
    const fp = position.map((v, i) => this.pos[i].filter(v, dt));
    const fq = q.map((v, i) => this.rot[i].filter(v, dt));
    const n = Math.hypot(...fq) || 1;
    this.lastQ = fq.map((v) => v / n);
    return { position: fp, quaternion: this.lastQ };
  }

  reset(): void {
    for (const f of [...this.pos, ...this.rot]) f.reset();
    this.lastQ = null;
  }
}
