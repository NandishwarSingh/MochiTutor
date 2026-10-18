import { describe, expect, test } from "bun:test";
import { CalcError, calculate, compileFunction, toFraction } from "../src/lib/calc";

const value = (s: string) => calculate(s).value;

describe("calculate", () => {
  test("operator precedence and associativity", () => {
    expect(value("2 + 3 * 4")).toBe(14);
    expect(value("2 ^ 3 ^ 2")).toBe(512);
    expect(value("-2 ^ 2")).toBe(-4);
    expect(value("(2 + 3) * 4")).toBe(20);
    expect(value("10 / 4")).toBe(2.5);
    expect(value("7 % 3")).toBe(1);
    expect(value("2 ** 10")).toBe(1024);
  });

  test("implicit multiplication", () => {
    expect(value("2pi")).toBeCloseTo(2 * Math.PI, 12);
    expect(value("3(4 + 1)")).toBe(15);
  });

  test("factorials and counting", () => {
    expect(value("5!")).toBe(120);
    expect(value("0!")).toBe(1);
    expect(value("C(52, 5)")).toBe(2598960);
    expect(value("nCr(10, 3)")).toBe(120);
    expect(value("P(5, 2)")).toBe(20);
    expect(value("10! / (3! * 7!)")).toBe(120);
  });

  test("probability functions", () => {
    expect(value("binompdf(10, 0.5, 3)")).toBeCloseTo(0.1171875, 14);
    expect(value("binomcdf(10, 0.5, 5)")).toBeCloseTo(0.623046875, 14);
    expect(value("normalcdf(-1.96, 1.96)")).toBeCloseTo(0.9500042097035593, 10);
    expect(value("invnorm(0.975)")).toBeCloseTo(1.959963984540054, 9);
    expect(value("poissonpdf(3, 2)")).toBeCloseTo(0.22404180765538775, 12);
    expect(value("0.3 ^ 4")).toBeCloseTo(0.0081, 15);
  });

  test("unicode operators the model sometimes writes", () => {
    expect(value("6 × 6")).toBe(36);
    expect(value("1 ÷ 4")).toBe(0.25);
    expect(value("5 − 2")).toBe(3);
  });

  test("results carry a fraction when one fits", () => {
    expect(calculate("6/36").fraction).toBe("1/6");
    expect(calculate("1/3").text).toBe("0.3333333333");
    expect(calculate("4/2").fraction).toBeUndefined();
    expect(toFraction(Math.SQRT2)).toBeUndefined();
    expect(toFraction(-0.375)).toBe("-3/8");
  });

  test("rejects bad input with readable errors", () => {
    expect(() => calculate("2 +")).toThrow(CalcError);
    expect(() => calculate("")).toThrow("empty");
    expect(() => calculate("foo(1)")).toThrow('Unknown function "foo"');
    expect(() => calculate("x + 1")).toThrow('Unknown name "x"');
    expect(() => calculate("sqrt(1, 2)")).toThrow("takes 1 arguments");
    expect(() => calculate("(1 + 2")).toThrow("closing bracket");
    expect(() => calculate("2 $ 3")).toThrow("Unexpected");
    expect(() => calculate("1+".repeat(300))).toThrow("too long");
  });

  test("no access to JavaScript globals", () => {
    expect(() => calculate("constructor")).toThrow(CalcError);
    expect(() => calculate("process(1)")).toThrow(CalcError);
  });
});

describe("compileFunction", () => {
  test("evaluates expressions in x", () => {
    const f = compileFunction("y = x^2 - 2x + 1");
    expect(f(1)).toBe(0);
    expect(f(3)).toBe(4);
  });

  test("throws on unknown names at compile time", () => {
    expect(() => compileFunction("x + z")).toThrow(CalcError);
  });
});
