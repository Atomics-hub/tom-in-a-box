import { describe, expect, test } from "bun:test";
import { estimateModelCostUsd } from "../src/pricing";

describe("pricing estimates", () => {
  test("uses current Opus 4.7 rates before generic Opus fallback", () => {
    expect(estimateModelCostUsd("claude-opus-4-7", 1_000_000, 1_000_000)).toBe(30);
  });

  test("keeps older Opus models on conservative fallback rates", () => {
    expect(estimateModelCostUsd("claude-opus-4-1", 1_000_000, 1_000_000)).toBe(90);
  });
});
