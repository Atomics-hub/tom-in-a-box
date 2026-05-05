import { describe, expect, test } from "bun:test";
import { finalStatus, mergeVerificationResults } from "../src/pipeline";
import { type AgentResult, VERIFICATION_AGENT_NAMES } from "../src/types";

function result(agent: AgentResult["agent"], verdict: AgentResult["verdict"]): AgentResult {
  return {
    agent,
    verdict,
    confidence: verdict === "AGREE" ? 0.9 : 0.2,
    summary: `${agent} ${verdict}`,
    evidence: [],
    blockingFacts: [],
    assumptions: [],
    filesReviewed: []
  };
}

describe("verification result merging", () => {
  test("does not submit a partial all-AGREE result", () => {
    expect(finalStatus([result("audit-poc", "AGREE")])).toBe("NEEDS_MANUAL_REVIEW");
  });

  test("merges targeted reruns in canonical agent order", () => {
    const previous = VERIFICATION_AGENT_NAMES.map((agent) =>
      result(agent, agent === "audit-poc" ? "NEEDS_REVIEW" : "AGREE")
    );
    const merged = mergeVerificationResults(previous, [result("audit-poc", "AGREE")]);

    expect(merged.map((item) => item.agent)).toEqual([...VERIFICATION_AGENT_NAMES]);
    expect(merged.find((item) => item.agent === "audit-poc")?.verdict).toBe("AGREE");
    expect(finalStatus(merged)).toBe("SUBMIT");
  });
});
