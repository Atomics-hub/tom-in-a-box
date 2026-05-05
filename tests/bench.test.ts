import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBenchCases, runBenchReplay, runBenchResume, runBenchScaffold } from "../src/bench";

describe("benchmark corpus", () => {
  test("loads the bundled smoke case", async () => {
    const cases = await loadBenchCases("benchmarks");
    expect(cases.some((benchCase) => benchCase.id === "smoke-offline")).toBe(true);
    const smoke = cases.find((benchCase) => benchCase.id === "smoke-offline");
    expect(smoke?.focus).toBe("authz");
    expect(smoke?.acceptedStatuses).toEqual(["NEEDS_MANUAL_REVIEW"]);
  });

  test("scaffolds a focused source-snapshot case from commit pair", async () => {
    const root = await mkdtemp(join(tmpdir(), "tib-bench-test-"));
    try {
      const repo = join(root, "source");
      const corpus = join(root, "corpus");
      await mkdir(join(repo, "src"), { recursive: true });
      await git(["init"], repo);
      await git(["config", "user.email", "test@example.invalid"], repo);
      await git(["config", "user.name", "tib test"], repo);
      await Bun.write(join(repo, "src", "bug.ts"), "export const vulnerable = true;\n");
      await git(["add", "."], repo);
      await git(["commit", "-m", "vulnerable"], repo);
      const sourceCommit = (await git(["rev-parse", "HEAD"], repo)).trim();

      await Bun.write(join(repo, "src", "bug.ts"), "export const vulnerable = false;\n");
      await git(["commit", "-am", "fix bug"], repo);
      const fixedCommit = (await git(["rev-parse", "HEAD"], repo)).trim();

      const claimPath = join(root, "claim.md");
      await Bun.write(claimPath, "# Demo bug\n\n`src/bug.ts` is vulnerable before the fix.\n");

      const result = await runBenchScaffold({
        corpusDir: corpus,
        id: "demo-bug",
        name: "Demo Bug",
        repo,
        claimPath,
        focus: "memory",
        acceptedStatuses: ["SUBMIT", "NEEDS_MANUAL_REVIEW"],
        sourcePaths: ["src/bug.ts"],
        tags: ["accepted", "historical"],
        sourceUrl: "https://example.invalid/repo",
        sourceCommit,
        fixedCommit,
        noveltyAsOf: "2026-01-01",
        noveltyState: "pre-fix"
      });

      expect(await Bun.file(join(result.repoDir, "src", "bug.ts")).text()).toContain("vulnerable = true");
      expect(await Bun.file(result.fixDiffPath!).text()).toContain("vulnerable = false");

      const cases = await loadBenchCases(corpus);
      expect(cases).toHaveLength(1);
      expect(cases[0]?.id).toBe("demo-bug");
      expect(cases[0]?.acceptedStatuses).toEqual(["SUBMIT", "NEEDS_MANUAL_REVIEW"]);
      expect(cases[0]?.evidence?.sourcePaths).toEqual(["src/bug.ts", "fix.diff"]);
      expect(cases[0]?.novelty?.asOf).toBe("2026-01-01");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("replays a live benchmark against current accepted statuses", async () => {
    const root = await mkdtemp(join(tmpdir(), "tib-bench-replay-test-"));
    try {
      const corpus = join(root, "corpus");
      const caseDir = join(corpus, "negative-case");
      const runDir = join(root, "run");
      await mkdir(caseDir, { recursive: true });
      await mkdir(runDir, { recursive: true });
      await Bun.write(
        join(caseDir, "case.toml"),
        [
          'id = "negative-case"',
          'name = "Negative Case"',
          'repo = "repo"',
          'claim = "claim.md"',
          'focus = "authz"',
          'accepted_statuses = ["REJECT"]',
          'tags = ["near-miss", "source-snapshot"]',
          "",
          "[evidence]",
          'source_paths = []',
          ""
        ].join("\n")
      );

      await Bun.write(
        join(runDir, "benchmark-results.json"),
        JSON.stringify(
          {
            corpusDir: corpus,
            outputDir: runDir,
            mode: "live",
            total: 1,
            passed: 0,
            failed: 1,
            skipped: 0,
            publicBar: {},
            summaryPath: join(runDir, "benchmark-summary.md"),
            jsonPath: join(runDir, "benchmark-results.json"),
            results: [
              {
                case: {
                  id: "negative-case",
                  name: "Negative Case",
                  caseDir,
                  repo: join(caseDir, "repo"),
                  claimPath: join(caseDir, "claim.md"),
                  focus: "authz",
                  acceptedStatuses: ["LIKELY_DUPLICATE"],
                  tags: ["near-miss", "source-snapshot"]
                },
                observedStatus: "REJECT",
                passed: false,
                agents: []
              }
            ]
          },
          null,
          2
        )
      );

      const replay = await runBenchReplay({
        sourcePath: runDir,
        corpusDir: corpus,
        outDir: join(root, "replay"),
        strictPublicBar: false
      });

      expect(replay.results[0]?.passed).toBe(true);
      expect(replay.passed).toBe(1);
      expect(replay.failed).toBe(0);
      expect(replay.results[0]?.case.acceptedStatuses).toEqual(["REJECT"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("resumes a benchmark by rerunning only failed cases", async () => {
    const root = await mkdtemp(join(tmpdir(), "tib-bench-resume-test-"));
    try {
      const corpus = join(root, "corpus");
      const retryCaseDir = join(corpus, "retry-case");
      const stableCaseDir = join(corpus, "stable-case");
      const repo = join(retryCaseDir, "repo");
      const runDir = join(root, "run");
      await mkdir(join(repo, "src"), { recursive: true });
      await mkdir(stableCaseDir, { recursive: true });
      await mkdir(runDir, { recursive: true });
      await Bun.write(join(repo, "src", "app.ts"), "export const value = 'demo';\n");
      await Bun.write(join(retryCaseDir, "claim.md"), "# Retry Case\n\nReview `src/app.ts`.\n");
      await Bun.write(
        join(retryCaseDir, "case.toml"),
        [
          'id = "retry-case"',
          'name = "Retry Case"',
          'repo = "repo"',
          'claim = "claim.md"',
          'focus = "authz"',
          'accepted_statuses = ["NEEDS_MANUAL_REVIEW"]',
          'tags = ["near-miss", "source-snapshot"]',
          "",
          "[evidence]",
          'source_paths = ["src/app.ts"]',
          ""
        ].join("\n")
      );
      await Bun.write(join(stableCaseDir, "claim.md"), "# Stable Case\n");
      await Bun.write(
        join(stableCaseDir, "case.toml"),
        [
          'id = "stable-case"',
          'name = "Stable Case"',
          'repo = "repo"',
          'claim = "claim.md"',
          'focus = "authz"',
          'accepted_statuses = ["REJECT"]',
          'tags = ["near-miss", "source-snapshot"]',
          "",
          "[evidence]",
          'source_paths = []',
          ""
        ].join("\n")
      );

      await Bun.write(
        join(runDir, "benchmark-results.json"),
        JSON.stringify(
          {
            corpusDir: corpus,
            outputDir: runDir,
            mode: "live",
            total: 2,
            passed: 1,
            failed: 1,
            skipped: 0,
            publicBar: {},
            summaryPath: join(runDir, "benchmark-summary.md"),
            jsonPath: join(runDir, "benchmark-results.json"),
            results: [
              {
                case: {
                  id: "retry-case",
                  name: "Retry Case",
                  caseDir: retryCaseDir,
                  repo,
                  claimPath: join(retryCaseDir, "claim.md"),
                  focus: "authz",
                  acceptedStatuses: ["SUBMIT"],
                  tags: ["near-miss", "source-snapshot"]
                },
                observedStatus: "ERROR",
                passed: false,
                error: "credit balance is too low",
                agents: []
              },
              {
                case: {
                  id: "stable-case",
                  name: "Stable Case",
                  caseDir: stableCaseDir,
                  repo: join(stableCaseDir, "repo"),
                  claimPath: join(stableCaseDir, "claim.md"),
                  focus: "authz",
                  acceptedStatuses: ["REJECT"],
                  tags: ["near-miss", "source-snapshot"]
                },
                observedStatus: "REJECT",
                passed: true,
                agents: []
              }
            ]
          },
          null,
          2
        )
      );

      const resumed = await runBenchResume(
        {
          defaultFocus: "authz",
          hunterModel: "claude-sonnet-4-6",
          verificationModel: "claude-opus-4-7",
          maxCandidates: 10
        },
        {
          sourcePath: runDir,
          corpusDir: corpus,
          outDir: join(root, "resume"),
          dryRun: false,
          offline: true,
          keepClone: false,
          strictPublicBar: false,
          caseIds: []
        }
      );

      expect(resumed.results[0]?.observedStatus).toBe("NEEDS_MANUAL_REVIEW");
      expect(resumed.results[0]?.passed).toBe(true);
      expect(resumed.results[0]?.agents).toHaveLength(6);
      expect(resumed.results[1]?.observedStatus).toBe("REJECT");
      expect(resumed.results[1]?.agents).toHaveLength(0);
      expect(resumed.passed).toBe(2);
      expect(resumed.failed).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim() || stdout.trim()}`);
  return stdout;
}
