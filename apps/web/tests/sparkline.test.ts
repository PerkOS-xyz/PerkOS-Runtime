/**
 * The sparkline shape for a desk's price history.
 */

import { describe, expect, it } from "vitest";

import { sparkline } from "../app/desks/sparkline";

const at = (h: number) => `2026-09-25T${String(h).padStart(2, "0")}:00:00.000Z`;

describe("sparkline", () => {
  it("needs two points", () => {
    expect(sparkline([])).toBeNull();
    expect(sparkline([{ at: at(1), value: 10 }])).toBeNull();
  });

  it("puts the low at the bottom and the high at the top, in time order", () => {
    const spark = sparkline([{ at: at(3), value: 12 }, { at: at(1), value: 10 }, { at: at(2), value: 14 }], 600, 140, 8)!;
    expect(spark.line).toBe("M0.0,132.0 L300.0,8.0 L600.0,70.0");
    expect(spark.area).toBe("M0.0,132.0 L300.0,8.0 L600.0,70.0 L600.0,140 L0.0,140 Z");
    expect(spark).toMatchObject({ low: 10, high: 14, last: { x: 100, y: 50 } });
  });

  it("draws a flat series across the middle", () => {
    const spark = sparkline([{ at: at(1), value: 5 }, { at: at(2), value: 5 }], 600, 140)!;
    expect(spark.line).toBe("M0.0,70.0 L600.0,70.0");
  });
});
