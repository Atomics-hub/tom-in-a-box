import { describe, expect, test } from "bun:test";
import { hasRawAgentVerdict, normalizeAgentResult, type RawAgentResult } from "../src/agents/base";
import { formatPocMarkdown, parsePocTextVerdict, parseTextVerdict, type VerificationContext } from "../src/agents/verification";

describe("agent result normalization", () => {
  test("unwraps Anthropic tool values nested under common wrapper keys", () => {
    const valueWrapped = normalizeAgentResult("audit-poc", {
      value: {
        verdict: "AGREE",
        confidence: 0.78,
        summary: "PoC is credible.",
        evidence: ["constructor omits saved_mode_"],
        blocking_facts: [],
        assumptions: [],
        files_reviewed: ["src/maglev/maglev-graph-builder.cc"],
        poc_markdown: "# Minimal PoC"
      }
    } as RawAgentResult);

    const underscoreWrapped = normalizeAgentResult("novelty", {
      _: {
        verdict: "AGREE",
        confidence: 0.6,
        summary: "No duplicate signal as of the benchmark date.",
        evidence: ["noveltyAsOf was honored"],
        blocking_facts: [],
        assumptions: [],
        files_reviewed: ["src/maglev/maglev-graph-builder.cc"]
      }
    } as RawAgentResult);

    const parameterWrapped = normalizeAgentResult("style-consistency", {
      parameter: {
        verdict: "AGREE",
        confidence: 0.82,
        summary: "Submission-grade report.",
        evidence: ["clear title and remediation"],
        blocking_facts: [],
        assumptions: [],
        files_reviewed: ["src/maglev/maglev-graph-builder.cc"]
      }
    } as RawAgentResult);

    const unknownWrapped = normalizeAgentResult("style-consistency", {
      "$PARAMETER_VALUE": {
        verdict: "REJECT",
        confidence: 0.9,
        summary: "Fixed source should reject.",
        evidence: ["sourceCommit equals fixedCommit"],
        blocking_facts: ["bug already fixed"],
        assumptions: [],
        files_reviewed: ["src/maglev/maglev-graph-builder.cc"]
      }
    } as RawAgentResult);

    expect(valueWrapped.verdict).toBe("AGREE");
    expect(valueWrapped.pocMarkdown).toBe("# Minimal PoC");
    expect(underscoreWrapped.verdict).toBe("AGREE");
    expect(underscoreWrapped.summary).toContain("No duplicate signal");
    expect(parameterWrapped.verdict).toBe("AGREE");
    expect(parameterWrapped.confidence).toBe(0.82);
    expect(unknownWrapped.verdict).toBe("REJECT");
    expect(hasRawAgentVerdict({} as RawAgentResult)).toBe(false);
    expect(hasRawAgentVerdict({ value: { verdict: "AGREE" } } as RawAgentResult)).toBe(true);
  });

  test("flags malformed verifier output with an explicit manual-review reason", () => {
    const malformed = normalizeAgentResult("style-consistency", {} as RawAgentResult, "{}");

    expect(malformed.verdict).toBe("NEEDS_REVIEW");
    expect(malformed.confidence).toBe(0);
    expect(malformed.summary).toContain("malformed output");
    expect(malformed.evidence).toEqual(["Raw model output: {}"]);
    expect(malformed.blockingFacts[0]).toContain("valid AGREE");
  });

  test("formats PoC markdown from structured audit-poc facts", () => {
    const result = normalizeAgentResult("audit-poc", {
      verdict: "AGREE",
      confidence: 0.91,
      summary: "The included harness reaches the vulnerable copy path.",
      evidence: ["poc/sqe_mixed_oob_v2.c maps sq_array[1] to the final slot"],
      blocking_facts: [],
      assumptions: ["io_uring is available to the local user"],
      files_reviewed: ["poc/sqe_mixed_oob_v2.c"]
    } as RawAgentResult);
    const context = {
      candidate: {
        title: "SQE_MIXED physical-index OOB read",
        pocPlan: "Use the supplied harness."
      },
      benchmarkContext: {
        sourceCommit: "177c69432161",
        sourcePaths: ["poc/sqe_mixed_oob_v2.c"]
      }
    } as VerificationContext;

    const markdown = formatPocMarkdown(result, context);

    expect(markdown).toContain("SQE_MIXED physical-index OOB read");
    expect(markdown).toContain("poc/sqe_mixed_oob_v2.c");
    expect(markdown).toContain("AGREE (0.91 confidence)");
  });

  test("parses audit-poc text fallback verdicts", () => {
    const parsed = parsePocTextVerdict([
      "VERDICT: AGREE",
      "CONFIDENCE: 0.87",
      "SUMMARY: The regression harness is derivable from the supplied evidence.",
      "EVIDENCE: sq_array maps logical slot 1 to the final physical SQE; URING_CMD128 copies 128 bytes",
      "BLOCKERS: none",
      "ASSUMPTIONS: io_uring is available",
      "FILES: poc/sqe_mixed_oob_v2.c; io_uring/io_uring.c"
    ].join("\n"));

    expect(parsed?.verdict).toBe("AGREE");
    expect(parsed?.confidence).toBe(0.87);
    expect(parsed?.blocking_facts).toEqual([]);
    expect(parsed?.files_reviewed).toEqual(["poc/sqe_mixed_oob_v2.c", "io_uring/io_uring.c"]);
  });

  test("parses generic text fallback verdicts", () => {
    const parsed = parseTextVerdict([
      "VERDICT: REJECT",
      "CONFIDENCE: 0.93",
      "SUMMARY: The fixed source validates the physical SQE index before the copy path.",
      "EVIDENCE: fixed check rejects final physical slot; fix commit equals source commit",
      "BLOCKERS: stale claim cannot reproduce",
      "ASSUMPTIONS: benchmark source reflects reviewed commit",
      "FILES: tib_evidence/sqe_mixed_relevant.c; fix.diff"
    ].join("\n"));

    expect(parsed?.verdict).toBe("REJECT");
    expect(parsed?.confidence).toBe(0.93);
    expect(parsed?.blocking_facts).toEqual(["stale claim cannot reproduce"]);
    expect(parsed?.files_reviewed).toEqual(["tib_evidence/sqe_mixed_relevant.c", "fix.diff"]);
  });
});
