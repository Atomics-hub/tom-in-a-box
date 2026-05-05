#!/usr/bin/env bun
import { loadConfig, writeDefaultConfig } from "./config";
import {
  runBench,
  runBenchReplay,
  runBenchResume,
  runBenchScaffold,
  type BenchOptions,
  type BenchReplayOptions,
  type BenchResumeOptions,
  type BenchRunResult,
  type BenchScaffoldOptions,
  type BenchScaffoldResult
} from "./bench";
import { runDoctor, type DoctorResult } from "./doctor";
import { runAudit, runVerify, type DryRunEstimate, type PipelineResult } from "./pipeline";
import type { AuditConfig, AuditOptions, CandidateStatus, Focus, VerificationAgentName, VerifyOptions } from "./types";
import { CANDIDATE_STATUSES, FOCI, VERIFICATION_AGENT_NAMES } from "./types";
import { isFocus } from "./utils";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log("tom-in-a-box 0.1.0");
    return;
  }

  if (command === "init-config") {
    const path = await writeDefaultConfig();
    console.log(`Config ready: ${path}`);
    return;
  }

  if (command === "doctor") {
    const corpusDir = readFlag(argv.slice(1), "--benchmarks") ?? "benchmarks";
    reportDoctorResult(await runDoctor(corpusDir));
    return;
  }

  if (command === "bench" && argv[1] === "scaffold") {
    reportBenchScaffoldResult(await runBenchScaffold(parseBenchScaffoldArgs(argv.slice(2))));
    return;
  }

  if (command === "bench" && argv[1] === "replay") {
    reportBenchResult(await runBenchReplay(parseBenchReplayArgs(argv.slice(2))));
    return;
  }

  const config = await loadConfig();
  if (command === "bench" && argv[1] === "resume") {
    reportBenchResult(await runBenchResume(config, parseBenchResumeArgs(argv.slice(2))));
    return;
  }

  if (command === "audit") {
    const options = parseAuditArgs(argv.slice(1), config);
    await reportResult(await runAudit(config, options), options.dryRun);
    return;
  }

  if (command === "verify") {
    const options = parseVerifyArgs(argv.slice(1), config);
    await reportResult(await runVerify(config, options), options.dryRun);
    return;
  }

  if (command === "bench") {
    const options = parseBenchArgs(argv.slice(1));
    reportBenchResult(await runBench(config, options));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseBenchScaffoldArgs(args: string[]): BenchScaffoldOptions {
  const corpusDir = args.find((arg) => !arg.startsWith("-"));
  if (!corpusDir) throw new Error("Usage: tib bench scaffold <benchmarks-dir> --id <id> --repo <path-or-url> --claim finding.md --focus <focus> --accepted <status>");

  const id = requireFlag(args, "--id");
  const repo = requireFlag(args, "--repo");
  const claimPath = requireFlag(args, "--claim");
  const acceptedStatuses = parseCandidateStatuses(readFlags(args, "--accepted"));
  const options: BenchScaffoldOptions = {
    corpusDir,
    id,
    repo,
    claimPath,
    focus: parseFocus(requireFlag(args, "--focus")),
    acceptedStatuses,
    sourcePaths: readFlags(args, "--source-path"),
    tags: readFlags(args, "--tag")
  };

  const name = readFlag(args, "--name");
  const notes = readFlag(args, "--notes");
  const sourceUrl = readFlag(args, "--source-url");
  const sourceCommit = readFlag(args, "--source-commit");
  const fixedCommit = readFlag(args, "--fixed-commit");
  const evidenceLevel = readFlag(args, "--evidence-level");
  const noveltyAsOf = readFlag(args, "--novelty-as-of");
  const noveltyState = readFlag(args, "--novelty-state");
  if (name) options.name = name;
  if (notes) options.notes = notes;
  if (sourceUrl) options.sourceUrl = sourceUrl;
  if (sourceCommit) options.sourceCommit = sourceCommit;
  if (fixedCommit) options.fixedCommit = fixedCommit;
  if (evidenceLevel) options.evidenceLevel = evidenceLevel;
  if (noveltyAsOf) options.noveltyAsOf = noveltyAsOf;
  if (noveltyState) options.noveltyState = noveltyState;
  if (hasFlag(args, "--force")) options.force = true;
  return options;
}

function parseBenchArgs(args: string[]): BenchOptions {
  const corpusDir = args.find((arg) => !arg.startsWith("-"));
  if (!corpusDir) throw new Error("Usage: tib bench <benchmarks-dir> [--offline] [--dry-run]");
  const outDir = readFlag(args, "--out");
  const costCap = readFlag(args, "--cost-cap");
  const maxCases = readFlag(args, "--max-cases");
  const caseIds = readFlags(args, "--case");
  const rerunFromPath = readFlag(args, "--from");
  const rerunAgents = parseVerificationAgents([...readFlags(args, "--agent"), ...readFlags(args, "--only-agent")]);
  const options: BenchOptions = {
    corpusDir,
    dryRun: hasFlag(args, "--dry-run"),
    offline: hasFlag(args, "--offline"),
    keepClone: hasFlag(args, "--keep-clone"),
    strictPublicBar: hasFlag(args, "--strict-public-bar"),
    caseIds
  };
  if (outDir) options.outDir = outDir;
  if (costCap) options.costCapUsd = Number(costCap);
  if (maxCases) options.maxCases = parsePositiveInt(maxCases, 1);
  if (rerunFromPath) options.rerunFromPath = rerunFromPath;
  if (rerunAgents.length) options.rerunAgents = rerunAgents;
  return options;
}

function parseBenchResumeArgs(args: string[]): BenchResumeOptions {
  const sourcePath = args.find((arg) => !arg.startsWith("-"));
  if (!sourcePath) throw new Error("Usage: tib bench resume <run-dir-or-results.json> --corpus <benchmarks-dir>");
  const outDir = readFlag(args, "--out");
  const costCap = readFlag(args, "--cost-cap");
  const options: BenchResumeOptions = {
    sourcePath,
    corpusDir: readFlag(args, "--corpus") ?? "benchmarks",
    dryRun: hasFlag(args, "--dry-run"),
    offline: hasFlag(args, "--offline"),
    keepClone: hasFlag(args, "--keep-clone"),
    strictPublicBar: hasFlag(args, "--strict-public-bar"),
    caseIds: readFlags(args, "--case")
  };
  if (outDir) options.outDir = outDir;
  if (costCap) options.costCapUsd = Number(costCap);
  return options;
}

function parseBenchReplayArgs(args: string[]): BenchReplayOptions {
  const sourcePath = args.find((arg) => !arg.startsWith("-"));
  if (!sourcePath) throw new Error("Usage: tib bench replay <run-dir-or-results.json> --corpus <benchmarks-dir>");
  const outDir = readFlag(args, "--out");
  const options: BenchReplayOptions = {
    sourcePath,
    corpusDir: readFlag(args, "--corpus") ?? "benchmarks",
    strictPublicBar: hasFlag(args, "--strict-public-bar")
  };
  if (outDir) options.outDir = outDir;
  return options;
}

function parseCandidateStatuses(values: string[]): CandidateStatus[] {
  if (!values.length) throw new Error("--accepted is required at least once.");
  return values.map((status) => {
    if ((CANDIDATE_STATUSES as readonly string[]).includes(status)) return status as CandidateStatus;
    throw new Error(`Invalid accepted status "${status}". Expected one of: ${CANDIDATE_STATUSES.join(", ")}`);
  });
}

function parseAuditArgs(args: string[], config: AuditConfig): AuditOptions {
  const target = args.find((arg) => !arg.startsWith("-"));
  if (!target) throw new Error("Usage: tib audit <github-url-or-path> --focus <authn|authz|injection|memory|race>");
  const focus = parseFocus(readFlag(args, "--focus") ?? config.defaultFocus);
  const outDir = readFlag(args, "--out");
  const costCap = readFlag(args, "--cost-cap");
  const options: AuditOptions = {
    target,
    focus,
    maxCandidates: parsePositiveInt(readFlag(args, "--max-candidates"), config.maxCandidates),
    dryRun: hasFlag(args, "--dry-run"),
    offline: hasFlag(args, "--offline"),
    keepClone: hasFlag(args, "--keep-clone")
  };
  if (outDir) options.outDir = outDir;
  if (costCap) options.costCapUsd = Number(costCap);
  return options;
}

function parseVerifyArgs(args: string[], config: AuditConfig): VerifyOptions {
  const target = args.find((arg) => !arg.startsWith("-"));
  const claimPath = readFlag(args, "--claim");
  if (!target || !claimPath) {
    throw new Error("Usage: tib verify <github-url-or-path> --claim finding.md [--focus authz]");
  }
  const focus = parseFocus(readFlag(args, "--focus") ?? config.defaultFocus);
  const outDir = readFlag(args, "--out");
  const costCap = readFlag(args, "--cost-cap");
  const onlyAgents = parseVerificationAgents([...readFlags(args, "--agent"), ...readFlags(args, "--only-agent")]);
  const options: VerifyOptions = {
    target,
    claimPath,
    focus,
    dryRun: hasFlag(args, "--dry-run"),
    offline: hasFlag(args, "--offline"),
    keepClone: hasFlag(args, "--keep-clone")
  };
  if (outDir) options.outDir = outDir;
  if (costCap) options.costCapUsd = Number(costCap);
  if (onlyAgents.length) options.onlyAgents = onlyAgents;
  return options;
}

async function reportResult(result: PipelineResult, dryRun: boolean): Promise<void> {
  console.log(`Mapped ${result.codeMap.files.length} files and ${result.codeMap.symbols.length} symbols.`);
  if (result.codeMap.warnings.length) {
    for (const warning of result.codeMap.warnings) console.warn(`Warning: ${warning}`);
  }

  if (dryRun && result.dryRunEstimate) {
    printDryRun(result.dryRunEstimate);
    return;
  }

  const submitCount = result.verified.filter((finding) => finding.status === "SUBMIT").length;
  console.log(`Candidates: ${result.candidates.length}`);
  console.log(`Ready to submit: ${submitCount}`);
  if (result.artifacts) {
    console.log(`Results: ${result.artifacts.outputDir}`);
    console.log(`Summary: ${result.artifacts.summaryPath}`);
  }
}

function printDryRun(estimate: DryRunEstimate): void {
  console.log("Dry run complete. No model calls were made.");
  console.log(`Planned model calls including malformed-output retries: ${estimate.plannedModelCalls}`);
  console.log(`Approximate input tokens: ${estimate.approximateInputTokens}`);
  console.log(`Conservative max-cost estimate: $${estimate.approximateMaxCostUsd.toFixed(2)}`);
  console.log(`Candidate slots: ${estimate.candidateSlots}`);
  console.log(`Verification agents per candidate: ${estimate.verificationAgents}`);
}

function reportBenchResult(result: BenchRunResult): void {
  console.log(`Benchmark mode: ${result.mode}`);
  console.log(`Cases: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Public alpha bar: ${result.publicBar.passed ? "PASS" : "NOT YET"}`);
  console.log(`Results: ${result.outputDir}`);
  console.log(`Summary: ${result.summaryPath}`);
  if (result.failed > 0 && result.mode !== "dry-run") {
    process.exitCode = 1;
  }
}

function reportBenchScaffoldResult(result: BenchScaffoldResult): void {
  console.log(`Benchmark case: ${result.caseDir}`);
  console.log(`Case TOML: ${result.caseTomlPath}`);
  console.log(`Claim: ${result.claimPath}`);
  console.log(`Repo fixture: ${result.repoDir}`);
  console.log(`Source files: ${result.copiedPaths.length}`);
  if (result.fixDiffPath) console.log(`Fix diff: ${result.fixDiffPath}`);
}

function reportDoctorResult(result: DoctorResult): void {
  for (const check of result.checks) {
    console.log(`${check.ok ? "OK" : "MISSING"} ${check.name}: ${check.detail}`);
  }
  if (!result.ok) process.exitCode = 1;
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function requireFlag(args: string[], name: string): string {
  const value = readFlag(args, name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readFlags(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const value = args[index + 1];
    if (args[index] === name && value) values.push(value);
  }
  return values;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function parseFocus(value: string): Focus {
  if (!isFocus(value)) {
    throw new Error(`Invalid focus "${value}". Expected one of: ${FOCI.join(", ")}`);
  }
  return value;
}

function parseVerificationAgents(values: string[]): VerificationAgentName[] {
  const agents = new Set<VerificationAgentName>();
  for (const value of values) {
    if ((VERIFICATION_AGENT_NAMES as readonly string[]).includes(value)) {
      agents.add(value as VerificationAgentName);
      continue;
    }
    throw new Error(`Invalid verification agent "${value}". Expected one of: ${VERIFICATION_AGENT_NAMES.join(", ")}`);
  }
  return [...agents];
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, got: ${value}`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(`
tom-in-a-box

Usage:
  tib init-config
  tib doctor [--benchmarks <dir>]
  tib audit <github-url-or-path> --focus <authn|authz|injection|memory|race> [options]
  tib verify <github-url-or-path> --claim finding.md [--focus authz] [options]
  tib bench <benchmarks-dir> [--offline] [--dry-run] [options]
  tib bench resume <run-dir-or-results.json> --corpus <benchmarks-dir> [options]
  tib bench replay <run-dir-or-results.json> --corpus <benchmarks-dir> [options]
  tib bench scaffold <benchmarks-dir> --id <id> --repo <path-or-url> --claim finding.md --focus <focus> --accepted <status> [options]

Options:
  --max-candidates <n>  Candidate cap for audit mode
  --dry-run             Clone/map and estimate calls without using the model
  --offline             Local smoke mode with deterministic placeholder results
  --out <dir>           Output root directory
  --cost-cap <usd>      Record a run-specific cost cap in runtime config
  --keep-clone          Keep temporary clone after remote audit
  --case <id>           Run one benchmark case id; repeatable
                       In resume mode, rerun specific source-run cases; default is failed cases only
  --from <results.json> Merge a benchmark rerun from prior verification-results.json
  --agent <name>        Restrict verify/bench rerun to one verifier; repeatable
  --max-cases <n>       Case cap for benchmark mode
  --strict-public-bar   Fail bench unless public alpha thresholds are met
  --corpus <dir>        Benchmark corpus for replay/resume mode
  --accepted <status>   Accepted scaffold status; repeatable
  --source-commit <sha> Snapshot commit for scaffold
  --fixed-commit <sha>  Fix commit for scaffold diff
  --source-path <path>  Source path to copy into scaffold; repeatable
  --tag <tag>           Benchmark tag for scaffold; repeatable
  --novelty-as-of <date> Historical novelty cutoff for scaffold
  --force               Replace an existing scaffold case directory
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
