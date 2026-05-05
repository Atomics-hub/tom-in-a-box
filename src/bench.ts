import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import * as TOML from "smol-toml";
import { runVerify, type DryRunEstimate } from "./pipeline";
import { CostTracker } from "./pricing";
import type { AgentResult, AuditConfig, BenchmarkContext, CandidateStatus, Focus, VerificationAgentName } from "./types";
import { CANDIDATE_STATUSES, VERIFICATION_AGENT_NAMES } from "./types";
import { ensureDir, isFocus, pathExists, sanitizeName, timestampSlug } from "./utils";

export interface BenchOptions {
  corpusDir: string;
  dryRun: boolean;
  offline: boolean;
  keepClone: boolean;
  strictPublicBar: boolean;
  caseIds: string[];
  outDir?: string;
  costCapUsd?: number;
  maxCases?: number;
  rerunFromPath?: string;
  rerunAgents?: VerificationAgentName[];
}

export interface BenchReplayOptions {
  sourcePath: string;
  corpusDir: string;
  outDir?: string;
  strictPublicBar: boolean;
}

export interface BenchResumeOptions {
  sourcePath: string;
  corpusDir: string;
  dryRun: boolean;
  offline: boolean;
  keepClone: boolean;
  strictPublicBar: boolean;
  caseIds: string[];
  outDir?: string;
  costCapUsd?: number;
}

export interface BenchScaffoldOptions {
  corpusDir: string;
  id: string;
  repo: string;
  claimPath: string;
  focus: Focus;
  acceptedStatuses: CandidateStatus[];
  sourcePaths: string[];
  tags: string[];
  name?: string;
  notes?: string;
  sourceUrl?: string;
  sourceCommit?: string;
  fixedCommit?: string;
  evidenceLevel?: string;
  noveltyAsOf?: string;
  noveltyState?: string;
  force?: boolean;
}

export interface BenchScaffoldResult {
  caseDir: string;
  caseTomlPath: string;
  claimPath: string;
  repoDir: string;
  copiedPaths: string[];
  fixDiffPath?: string;
}

export interface BenchCase {
  id: string;
  name: string;
  caseDir: string;
  repo: string;
  claimPath: string;
  focus: Focus;
  acceptedStatuses: CandidateStatus[];
  tags: string[];
  evidence?: BenchEvidence;
  novelty?: BenchNovelty;
  notes?: string;
}

export interface BenchEvidence {
  level?: string;
  sourceUrl?: string;
  sourceCommit?: string;
  fixedCommit?: string;
  sourcePaths: string[];
}

export interface BenchNovelty {
  asOf?: string;
  disclosureState?: string;
}

export type BenchObservedStatus = CandidateStatus | "DRY_RUN" | "ERROR";

export interface BenchCaseResult {
  case: BenchCase;
  observedStatus: BenchObservedStatus;
  passed: boolean;
  error?: string;
  outputDir?: string;
  summaryPath?: string;
  dryRunEstimate?: DryRunEstimate;
  agents: Array<{
    agent: VerificationAgentName;
    verdict: string;
    confidence: number;
    blockingFacts: string[];
  }>;
}

export interface BenchRunResult {
  corpusDir: string;
  outputDir: string;
  mode: "live" | "offline" | "dry-run";
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  publicBar: PublicBarResult;
  results: BenchCaseResult[];
  summaryPath: string;
  jsonPath: string;
}

export interface PublicBarResult {
  acceptedCount: number;
  negativeCount: number;
  acceptedSubmitCount: number;
  negativeSubmitCount: number;
  zeroNegativeSubmits: boolean;
  allCasesPassed: boolean;
  enoughAccepted: boolean;
  enoughNegatives: boolean;
  liveRun: boolean;
  passed: boolean;
  notes: string[];
}

export async function runBench(config: AuditConfig, options: BenchOptions): Promise<BenchRunResult> {
  const corpusDir = resolve(options.corpusDir);
  const loadedCases = await loadBenchCases(corpusDir);
  const selectedCases = options.caseIds.length
    ? loadedCases.filter((benchCase) => options.caseIds.includes(benchCase.id))
    : loadedCases;
  const missingIds = options.caseIds.filter((id) => !selectedCases.some((benchCase) => benchCase.id === id));
  if (missingIds.length) {
    throw new Error(`Benchmark case(s) not found: ${missingIds.join(", ")}`);
  }
  const cases = selectedCases.slice(0, options.maxCases ?? Number.POSITIVE_INFINITY);
  if (cases.length === 0) {
    throw new Error(`No benchmark cases found in ${corpusDir}. Expected case.toml files.`);
  }
  if (options.rerunFromPath) {
    if (cases.length !== 1) {
      throw new Error("--from can only be used with exactly one --case.");
    }
    if (!options.rerunAgents?.length) {
      throw new Error("--from requires at least one --agent.");
    }
  }

  const outputDir = resolve(options.outDir ?? join(process.cwd(), "benchmark-results", timestampSlug()));
  const artifactsRoot = join(outputDir, "artifacts");
  await ensureDir(artifactsRoot);
  const costTracker = new CostTracker(options.costCapUsd ?? config.costCapUsd);

  const results: BenchCaseResult[] = [];
  for (const benchCase of cases) {
    results.push(await runBenchCase(config, options, benchCase, artifactsRoot, costTracker));
  }

  const skipped = options.dryRun ? results.length : 0;
  const passed = options.dryRun ? 0 : results.filter((result) => result.passed).length;
  const failed = options.dryRun ? 0 : results.length - passed;
  const summaryPath = join(outputDir, "benchmark-summary.md");
  const jsonPath = join(outputDir, "benchmark-results.json");
  const runResult: BenchRunResult = {
    corpusDir,
    outputDir,
    mode: options.dryRun ? "dry-run" : options.offline ? "offline" : "live",
    total: results.length,
    passed,
    failed,
    skipped,
    publicBar: evaluatePublicBar(results, options),
    results,
    summaryPath,
    jsonPath
  };

  await Bun.write(summaryPath, renderBenchSummary(runResult));
  await Bun.write(jsonPath, JSON.stringify(runResult, null, 2));
  if (options.strictPublicBar && !runResult.publicBar.passed) {
    throw new Error(`Benchmark run did not satisfy the public alpha bar. See ${summaryPath}`);
  }
  return runResult;
}

export async function runBenchReplay(options: BenchReplayOptions): Promise<BenchRunResult> {
  const sourcePath = await resolveBenchRunJsonPath(options.sourcePath);
  const sourceRun = JSON.parse(await Bun.file(sourcePath).text()) as BenchRunResult;
  const corpusDir = resolve(options.corpusDir);
  const currentCases = await loadBenchCases(corpusDir);
  const currentCaseById = new Map(currentCases.map((benchCase) => [benchCase.id, benchCase]));

  const results = sourceRun.results.map((result) => {
    const currentCase = currentCaseById.get(result.case.id) ?? result.case;
    const observedStatus = result.observedStatus;
    return {
      ...result,
      case: currentCase,
      passed: observedStatus !== "ERROR" && observedStatus !== "DRY_RUN" && currentCase.acceptedStatuses.includes(observedStatus)
    };
  });

  const outputDir = resolve(options.outDir ?? join(process.cwd(), "benchmark-results", `${timestampSlug()}-replay`));
  await ensureDir(outputDir);
  const runOptions: BenchOptions = {
    corpusDir,
    dryRun: sourceRun.mode === "dry-run",
    offline: sourceRun.mode === "offline",
    keepClone: false,
    strictPublicBar: options.strictPublicBar,
    caseIds: results.map((result) => result.case.id)
  };
  const runResult: BenchRunResult = {
    corpusDir,
    outputDir,
    mode: sourceRun.mode,
    total: results.length,
    passed: sourceRun.mode === "dry-run" ? 0 : results.filter((result) => result.passed).length,
    failed: sourceRun.mode === "dry-run" ? 0 : results.filter((result) => !result.passed).length,
    skipped: sourceRun.mode === "dry-run" ? results.length : 0,
    publicBar: evaluatePublicBar(results, runOptions),
    results,
    summaryPath: join(outputDir, "benchmark-summary.md"),
    jsonPath: join(outputDir, "benchmark-results.json")
  };

  await Bun.write(runResult.summaryPath, renderBenchSummary(runResult));
  await Bun.write(runResult.jsonPath, JSON.stringify(runResult, null, 2));
  if (options.strictPublicBar && !runResult.publicBar.passed) {
    throw new Error(`Replayed benchmark run did not satisfy the public alpha bar. See ${runResult.summaryPath}`);
  }
  return runResult;
}

export async function runBenchResume(config: AuditConfig, options: BenchResumeOptions): Promise<BenchRunResult> {
  const sourcePath = await resolveBenchRunJsonPath(options.sourcePath);
  const sourceRun = JSON.parse(await Bun.file(sourcePath).text()) as BenchRunResult;
  const corpusDir = resolve(options.corpusDir);
  const currentCases = await loadBenchCases(corpusDir);
  const currentCaseById = new Map(currentCases.map((benchCase) => [benchCase.id, benchCase]));
  const sourceResults = sourceRun.results.map((result) => {
    const currentCase = currentCaseById.get(result.case.id) ?? result.case;
    return {
      ...result,
      case: currentCase,
      passed: isPassingObservedStatus(result.observedStatus, currentCase.acceptedStatuses)
    };
  });

  const selectedRetryIds = options.caseIds.length
    ? options.caseIds
    : sourceResults.filter((result) => !result.passed).map((result) => result.case.id);
  const retryIds = new Set(selectedRetryIds);
  if (retryIds.size === 0) {
    throw new Error("Benchmark resume found no failed cases to rerun. Pass --case to rerun specific cases.");
  }

  const sourceIds = new Set(sourceResults.map((result) => result.case.id));
  const missingFromSource = [...retryIds].filter((id) => !sourceIds.has(id));
  if (missingFromSource.length) {
    throw new Error(`Benchmark case(s) not present in source run: ${missingFromSource.join(", ")}`);
  }
  const missingFromCorpus = [...retryIds].filter((id) => !currentCaseById.has(id));
  if (missingFromCorpus.length) {
    throw new Error(`Benchmark case(s) not found in current corpus: ${missingFromCorpus.join(", ")}`);
  }

  const outputDir = resolve(options.outDir ?? join(process.cwd(), "benchmark-results", `${timestampSlug()}-resume`));
  const artifactsRoot = join(outputDir, "artifacts");
  await ensureDir(artifactsRoot);
  const costTracker = new CostTracker(options.costCapUsd ?? config.costCapUsd);
  const caseIds = sourceResults.map((result) => result.case.id);
  const runOptions: BenchOptions = {
    corpusDir,
    dryRun: options.dryRun,
    offline: options.offline,
    keepClone: options.keepClone,
    strictPublicBar: options.strictPublicBar,
    caseIds,
    ...(options.costCapUsd !== undefined ? { costCapUsd: options.costCapUsd } : {})
  };

  const results: BenchCaseResult[] = [];
  for (const result of sourceResults) {
    const currentCase = currentCaseById.get(result.case.id) ?? result.case;
    if (retryIds.has(result.case.id)) {
      results.push(await runBenchCase(config, runOptions, currentCase, artifactsRoot, costTracker));
      continue;
    }
    results.push({
      ...result,
      case: currentCase,
      passed: isPassingObservedStatus(result.observedStatus, currentCase.acceptedStatuses)
    });
  }

  const mode = options.dryRun ? "dry-run" : options.offline ? "offline" : sourceRun.mode === "offline" ? "offline" : "live";
  const summaryPath = join(outputDir, "benchmark-summary.md");
  const jsonPath = join(outputDir, "benchmark-results.json");
  const evaluationOptions = { ...runOptions, dryRun: mode === "dry-run", offline: mode === "offline" };
  const runResult: BenchRunResult = {
    corpusDir,
    outputDir,
    mode,
    total: results.length,
    passed: mode === "dry-run" ? 0 : results.filter((result) => result.passed).length,
    failed: mode === "dry-run" ? 0 : results.filter((result) => !result.passed).length,
    skipped: mode === "dry-run" ? results.length : 0,
    publicBar: evaluatePublicBar(results, evaluationOptions),
    results,
    summaryPath,
    jsonPath
  };

  await Bun.write(summaryPath, renderBenchSummary(runResult));
  await Bun.write(jsonPath, JSON.stringify(runResult, null, 2));
  if (options.strictPublicBar && !runResult.publicBar.passed) {
    throw new Error(`Resumed benchmark run did not satisfy the public alpha bar. See ${summaryPath}`);
  }
  return runResult;
}

export async function loadBenchCases(corpusDir: string): Promise<BenchCase[]> {
  const root = resolve(corpusDir);
  if (!(await pathExists(root))) throw new Error(`Benchmark corpus does not exist: ${root}`);

  const caseFiles: string[] = [];
  const rootCase = join(root, "case.toml");
  if (await pathExists(rootCase)) {
    caseFiles.push(rootCase);
  } else {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = join(root, entry.name, "case.toml");
      if (await pathExists(candidate)) caseFiles.push(candidate);
    }
  }

  caseFiles.sort();
  return Promise.all(caseFiles.map(loadBenchCase));
}

function isPassingObservedStatus(observedStatus: BenchObservedStatus, acceptedStatuses: CandidateStatus[]): boolean {
  return observedStatus !== "ERROR" && observedStatus !== "DRY_RUN" && acceptedStatuses.includes(observedStatus);
}

async function resolveBenchRunJsonPath(sourcePath: string): Promise<string> {
  const resolved = resolve(sourcePath);
  const asRunJson = join(resolved, "benchmark-results.json");
  if (await pathExists(asRunJson)) return asRunJson;
  if (await pathExists(resolved)) return resolved;
  throw new Error(`Benchmark replay source does not exist: ${resolved}`);
}

export async function runBenchScaffold(options: BenchScaffoldOptions): Promise<BenchScaffoldResult> {
  const id = sanitizeName(options.id);
  if (!id) throw new Error("Benchmark scaffold requires a non-empty --id");
  const corpusDir = resolve(options.corpusDir);
  const caseDir = join(corpusDir, id);
  const repoDir = join(caseDir, "repo");
  const caseTomlPath = join(caseDir, "case.toml");
  const claimOutPath = join(caseDir, "claim.md");

  if ((await pathExists(caseDir)) && !options.force) {
    throw new Error(`Benchmark case already exists: ${caseDir}. Pass --force to replace it.`);
  }
  if (options.force) {
    await rm(caseDir, { recursive: true, force: true });
  }

  const source = await prepareScaffoldSource(options.repo);
  try {
    const sourceCommit = options.sourceCommit ?? (await git(["rev-parse", "HEAD"], source.repoRoot)).trim();
    const sourcePaths = options.sourcePaths.length
      ? normalizeSourcePaths(options.sourcePaths)
      : await inferSourcePaths(source.repoRoot, sourceCommit, options.fixedCommit);
    if (!sourcePaths.length) {
      throw new Error("Benchmark scaffold needs at least one --source-path, or commits with changed files to infer.");
    }

    await ensureDir(repoDir);
    const copiedPaths: string[] = [];
    for (const path of sourcePaths) {
      const text = await git(["show", `${sourceCommit}:${path}`], source.repoRoot);
      const outputPath = join(repoDir, path);
      await ensureDir(dirname(outputPath));
      await Bun.write(outputPath, text);
      copiedPaths.push(path);
    }

    let fixDiffPath: string | undefined;
    const diff = await buildFixDiff(source.repoRoot, sourceCommit, options.fixedCommit, sourcePaths);
    const sourcePathsForToml = [...sourcePaths];
    if (diff.trim()) {
      fixDiffPath = join(repoDir, "fix.diff");
      await Bun.write(fixDiffPath, diff);
      sourcePathsForToml.push("fix.diff");
    }

    const claimText = await Bun.file(resolve(options.claimPath)).text();
    await Bun.write(claimOutPath, claimText);
    await Bun.write(
      caseTomlPath,
      renderScaffoldCaseToml({
        ...options,
        id,
        name: options.name ?? id,
        repo: "repo",
        claimPath: "claim.md",
        sourceCommit,
        sourcePaths: sourcePathsForToml
      })
    );

    return {
      caseDir,
      caseTomlPath,
      claimPath: claimOutPath,
      repoDir,
      copiedPaths,
      ...(fixDiffPath ? { fixDiffPath } : {})
    };
  } finally {
    await source.cleanup();
  }
}

async function runBenchCase(
  config: AuditConfig,
  options: BenchOptions,
  benchCase: BenchCase,
  artifactsRoot: string,
  costTracker: CostTracker
): Promise<BenchCaseResult> {
  try {
    const caseArtifactsRoot = join(artifactsRoot, benchCase.id);
    await ensureDir(caseArtifactsRoot);
    const previousVerification = options.rerunFromPath
      ? await readPreviousVerification(options.rerunFromPath)
      : undefined;
    const result = await runVerify(
      config,
      {
        target: benchCase.repo,
        claimPath: benchCase.claimPath,
        focus: benchCase.focus,
        dryRun: options.dryRun,
        offline: options.offline,
        keepClone: options.keepClone,
        outDir: caseArtifactsRoot,
        benchmarkContext: buildBenchmarkContext(benchCase),
        ...(options.rerunAgents?.length ? { onlyAgents: options.rerunAgents } : {}),
        ...(previousVerification ? { previousVerification } : {}),
        ...(options.costCapUsd !== undefined ? { costCapUsd: options.costCapUsd } : {})
      },
      costTracker
    );

    if (options.dryRun) {
      const dryResult: BenchCaseResult = {
        case: benchCase,
        observedStatus: "DRY_RUN",
        passed: false,
        agents: []
      };
      if (result.dryRunEstimate) dryResult.dryRunEstimate = result.dryRunEstimate;
      return dryResult;
    }

    const finding = result.verified[0];
    const observedStatus = finding?.status ?? "ERROR";
    return {
      case: benchCase,
      observedStatus,
      passed: observedStatus !== "ERROR" && benchCase.acceptedStatuses.includes(observedStatus),
      ...(result.artifacts?.outputDir ? { outputDir: result.artifacts.outputDir } : {}),
      ...(result.artifacts?.summaryPath ? { summaryPath: result.artifacts.summaryPath } : {}),
      agents:
        finding?.verification.map((agent) => ({
          agent: agent.agent,
          verdict: agent.verdict,
          confidence: agent.confidence,
          blockingFacts: agent.blockingFacts
        })) ?? []
    };
  } catch (error) {
    return {
      case: benchCase,
      observedStatus: "ERROR",
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      agents: []
    };
  }
}

async function readPreviousVerification(path: string): Promise<AgentResult[]> {
  const parsed = JSON.parse(await Bun.file(resolve(path)).text()) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${path} to contain a verification result array.`);
  }
  const first = parsed[0] as { verification?: unknown } | undefined;
  if (!first || !Array.isArray(first.verification)) {
    throw new Error(`Expected ${path} to contain at least one finding with verification results.`);
  }
  return first.verification.map((result, index) =>
    normalizeLoadedAgentResult(result, `${path}: verification[${index}]`)
  );
}

function normalizeLoadedAgentResult(value: unknown, label: string): AgentResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const agent = record.agent;
  if (typeof agent !== "string" || !(VERIFICATION_AGENT_NAMES as readonly string[]).includes(agent)) {
    throw new Error(`${label}.agent must be one of: ${VERIFICATION_AGENT_NAMES.join(", ")}`);
  }
  const verdict = record.verdict;
  if (
    verdict !== "AGREE" &&
    verdict !== "REJECT" &&
    verdict !== "LIKELY_DUPLICATE" &&
    verdict !== "NEEDS_REVIEW"
  ) {
    throw new Error(`${label}.verdict is invalid.`);
  }
  const loaded: AgentResult = {
    agent: agent as VerificationAgentName,
    verdict,
    confidence: typeof record.confidence === "number" ? record.confidence : 0,
    summary: readString(record.summary, ""),
    evidence: readStringArray(record.evidence),
    blockingFacts: readStringArray(record.blockingFacts),
    assumptions: readStringArray(record.assumptions),
    filesReviewed: readStringArray(record.filesReviewed)
  };
  if (typeof record.writeupMarkdown === "string") loaded.writeupMarkdown = record.writeupMarkdown;
  if (typeof record.pocMarkdown === "string") loaded.pocMarkdown = record.pocMarkdown;
  if (typeof record.rawText === "string") loaded.rawText = record.rawText;
  return loaded;
}

async function loadBenchCase(caseTomlPath: string): Promise<BenchCase> {
  const caseDir = dirname(caseTomlPath);
  const parsed = TOML.parse(await Bun.file(caseTomlPath).text()) as Record<string, unknown>;
  const id = sanitizeName(readString(parsed.id, basename(caseDir)));
  const name = readString(parsed.name, id);
  const repoValue = requireString(parsed.repo, `${caseTomlPath}: repo`);
  const claimValue = requireString(parsed.claim, `${caseTomlPath}: claim`);
  const focusValue = requireString(parsed.focus, `${caseTomlPath}: focus`);
  if (!isFocus(focusValue)) {
    throw new Error(`${caseTomlPath}: invalid focus "${focusValue}"`);
  }

  const acceptedStatuses = readAcceptedStatuses(parsed, caseTomlPath);
  const evidence = readEvidence(parsed);
  const novelty = readNovelty(parsed);
  return {
    id,
    name,
    caseDir,
    repo: resolveTarget(caseDir, repoValue),
    claimPath: resolve(caseDir, claimValue),
    focus: focusValue,
    acceptedStatuses,
    tags: readStringArray(parsed.tags),
    ...(evidence ? { evidence } : {}),
    ...(novelty ? { novelty } : {}),
    ...(typeof parsed.notes === "string" ? { notes: parsed.notes } : {})
  };
}

function readAcceptedStatuses(parsed: Record<string, unknown>, path: string): CandidateStatus[] {
  const accepted = readStringArray(parsed.accepted_statuses);
  const expected = typeof parsed.expected_status === "string" ? [parsed.expected_status] : [];
  const statuses = accepted.length ? accepted : expected;
  if (statuses.length === 0) {
    throw new Error(`${path}: expected_status or accepted_statuses is required`);
  }
  return statuses.map((status) => parseCandidateStatus(status, path));
}

function parseCandidateStatus(value: string, path: string): CandidateStatus {
  if ((CANDIDATE_STATUSES as readonly string[]).includes(value)) return value as CandidateStatus;
  throw new Error(`${path}: invalid expected status "${value}"`);
}

function renderBenchSummary(run: BenchRunResult): string {
  const passRate = run.total ? (run.passed / run.total) * 100 : 0;
  const rows = run.results.map(renderCaseRow).join("\n");
  const failures = run.mode === "dry-run" ? [] : run.results.filter((result) => !result.passed);
  const estimates = run.results
    .filter((result) => result.dryRunEstimate)
    .map((result) => {
      const estimate = result.dryRunEstimate!;
      return `- ${result.case.id}: ${estimate.plannedModelCalls} calls including malformed-output retries, ~$${estimate.approximateMaxCostUsd.toFixed(2)} max`;
    });

  return [
    "# tib Benchmark Run",
    "",
    `- Corpus: ${run.corpusDir}`,
    `- Mode: ${run.mode}`,
    `- Cases: ${run.total}`,
    `- Passed: ${run.passed}`,
    `- Failed: ${run.failed}`,
    `- Skipped: ${run.skipped}`,
    run.mode === "dry-run" ? "- Pass rate: n/a (dry run)" : `- Pass rate: ${passRate.toFixed(1)}%`,
    "",
    "## Public Alpha Bar",
    "",
    renderPublicBar(run.publicBar),
    "",
    "## Cases",
    "",
    "| Case | Expected | Observed | Result | Agents |",
    "| --- | --- | --- | --- | --- |",
    rows,
    "",
    ...(failures.length
      ? [
          "## Failures",
          "",
          ...failures.flatMap((result) => renderFailure(result)),
          ""
        ]
      : ["## Failures", "", "None.", ""]),
    ...(estimates.length ? ["## Dry-Run Estimates", "", ...estimates, ""] : []),
    "## Agent Verdict Matrix",
    "",
    renderAgentMatrix(run.results),
    ""
  ].join("\n");
}

function evaluatePublicBar(results: BenchCaseResult[], options: BenchOptions): PublicBarResult {
  const negativeTags = new Set(["near-miss", "duplicate", "silent-patch", "design-intent"]);
  const publicEvidence = results.filter((result) => !result.case.tags.includes("source-fixture"));
  const accepted = publicEvidence.filter((result) => result.case.tags.includes("accepted"));
  const negatives = publicEvidence.filter((result) => result.case.tags.some((tag) => negativeTags.has(tag)));
  const acceptedSubmitCount = accepted.filter((result) => result.observedStatus === "SUBMIT").length;
  const negativeSubmitCount = negatives.filter((result) => result.observedStatus === "SUBMIT").length;
  const allCasesPassed = !options.dryRun && results.length > 0 && results.every((result) => result.passed);
  const enoughAccepted = accepted.length >= 10;
  const enoughNegatives = negatives.length >= 20;
  const liveRun = !options.dryRun && !options.offline;
  const zeroNegativeSubmits = negativeSubmitCount === 0;
  const allAcceptedSubmitted = accepted.length === 0 || acceptedSubmitCount === accepted.length;
  const notes: string[] = [];

  if (!liveRun) notes.push("Public bar requires a live model run.");
  if (!enoughAccepted) notes.push(`Need at least 10 accepted cases; found ${accepted.length}.`);
  if (!enoughNegatives) notes.push(`Need at least 20 negative cases; found ${negatives.length}.`);
  if (accepted.length > 0 && !allAcceptedSubmitted) {
    notes.push(`Accepted non-fixture cases must produce SUBMIT; ${acceptedSubmitCount}/${accepted.length} did.`);
  }
  if (!zeroNegativeSubmits) notes.push(`Known negative cases produced ${negativeSubmitCount} SUBMIT verdict(s).`);
  if (options.dryRun) {
    notes.push("Expected-status checks are skipped in dry-run mode.");
  } else if (!allCasesPassed) {
    notes.push("One or more benchmark cases failed its expected-status check.");
  }
  notes.push("Stability across two model runs must be checked by comparing two benchmark summaries.");

  return {
    acceptedCount: accepted.length,
    negativeCount: negatives.length,
    acceptedSubmitCount,
    negativeSubmitCount,
    zeroNegativeSubmits,
    allCasesPassed,
    enoughAccepted,
    enoughNegatives,
    liveRun,
    passed: liveRun && enoughAccepted && enoughNegatives && allAcceptedSubmitted && zeroNegativeSubmits && allCasesPassed,
    notes
  };
}

function renderPublicBar(result: PublicBarResult): string {
  return [
    `- Status: ${result.passed ? "PASS" : "NOT YET"}`,
    `- Accepted cases: ${result.acceptedCount} / 10`,
    `- Negative cases: ${result.negativeCount} / 20`,
    `- Accepted cases observed as SUBMIT: ${result.acceptedSubmitCount}`,
    `- Known negative SUBMIT verdicts: ${result.negativeSubmitCount}`,
    `- All expected-status checks passed: ${result.allCasesPassed ? "yes" : "no"}`,
    `- Live model run: ${result.liveRun ? "yes" : "no"}`,
    "",
    ...(result.notes.length ? ["Notes:", "", ...result.notes.map((note) => `- ${note}`)] : [])
  ].join("\n");
}

function renderCaseRow(result: BenchCaseResult): string {
  const expected = result.case.acceptedStatuses.join(" or ");
  const mark = result.passed ? "PASS" : result.observedStatus === "DRY_RUN" ? "DRY_RUN" : "FAIL";
  const agents = result.agents.length
    ? result.agents.map((agent) => `${agent.agent}:${agent.verdict}`).join("<br>")
    : result.error
      ? escapePipes(result.error)
      : "-";
  return `| ${escapePipes(result.case.id)} | ${expected} | ${result.observedStatus} | ${mark} | ${agents} |`;
}

function readEvidence(parsed: Record<string, unknown>): BenchEvidence | undefined {
  const evidence = parsed.evidence;
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) return undefined;
  const record = evidence as Record<string, unknown>;
  const sourcePaths = readStringArray(record.source_paths);
  return {
    ...(typeof record.level === "string" ? { level: record.level } : {}),
    ...(typeof record.source_url === "string" ? { sourceUrl: record.source_url } : {}),
    ...(typeof record.source_commit === "string" ? { sourceCommit: record.source_commit } : {}),
    ...(typeof record.fixed_commit === "string" ? { fixedCommit: record.fixed_commit } : {}),
    sourcePaths
  };
}

function readNovelty(parsed: Record<string, unknown>): BenchNovelty | undefined {
  const novelty = parsed.novelty;
  if (typeof novelty !== "object" || novelty === null || Array.isArray(novelty)) return undefined;
  const record = novelty as Record<string, unknown>;
  const result: BenchNovelty = {};
  if (typeof record.as_of === "string") result.asOf = record.as_of;
  if (typeof record.state === "string") result.disclosureState = record.state;
  return Object.keys(result).length ? result : undefined;
}

function buildBenchmarkContext(benchCase: BenchCase): BenchmarkContext {
  const context: BenchmarkContext = { caseId: benchCase.id };
  if (benchCase.evidence?.level) context.evidenceLevel = benchCase.evidence.level;
  if (benchCase.evidence?.sourceUrl) context.sourceUrl = benchCase.evidence.sourceUrl;
  if (benchCase.evidence?.sourceCommit) context.sourceCommit = benchCase.evidence.sourceCommit;
  if (benchCase.evidence?.fixedCommit) context.fixedCommit = benchCase.evidence.fixedCommit;
  if (benchCase.evidence?.sourcePaths.length) context.sourcePaths = benchCase.evidence.sourcePaths;
  if (benchCase.novelty?.asOf) context.noveltyAsOf = benchCase.novelty.asOf;
  if (benchCase.novelty?.disclosureState) context.disclosureState = benchCase.novelty.disclosureState;
  return context;
}

function renderFailure(result: BenchCaseResult): string[] {
  const lines = [
    `### ${result.case.id}`,
    "",
    `- Expected: ${result.case.acceptedStatuses.join(" or ")}`,
    `- Observed: ${result.observedStatus}`,
    ...(result.error ? [`- Error: ${result.error}`] : []),
    ...(result.summaryPath ? [`- Summary: ${result.summaryPath}`] : []),
    ""
  ];
  const blockingFacts = result.agents.flatMap((agent) =>
    agent.blockingFacts.map((fact) => `- ${agent.agent}: ${fact}`)
  );
  if (blockingFacts.length) {
    lines.push("Blocking facts:", "", ...blockingFacts, "");
  }
  return lines;
}

function renderAgentMatrix(results: BenchCaseResult[]): string {
  const agentNames: VerificationAgentName[] = [
    "revalidate",
    "trybreak",
    "audit-writeup",
    "audit-poc",
    "novelty",
    "style-consistency"
  ];
  const rows = agentNames.map((agentName) => {
    const counts = new Map<string, number>();
    for (const result of results) {
      const agent = result.agents.find((candidate) => candidate.agent === agentName);
      const verdict = agent?.verdict ?? "NO_RESULT";
      counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
    }
    const summary = [...counts.entries()]
      .map(([verdict, count]) => `${verdict}:${count}`)
      .join(", ");
    return `| ${agentName} | ${summary || "-"} |`;
  });
  return ["| Agent | Verdict Counts |", "| --- | --- |", ...rows].join("\n");
}

function resolveTarget(caseDir: string, target: string): string {
  if (/^https?:\/\//.test(target) || /^git@/.test(target)) return target;
  return resolve(caseDir, target);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function requireString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`${label} is required`);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function escapePipes(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

async function prepareScaffoldSource(repo: string): Promise<{ repoRoot: string; cleanup: () => Promise<void> }> {
  if (isRemoteGitTarget(repo)) {
    const parent = await mkdtemp(join(tmpdir(), "tib-bench-scaffold-"));
    const repoRoot = join(parent, "source");
    await git(["clone", "--quiet", "--filter=blob:none", "--no-checkout", repo, repoRoot]);
    return {
      repoRoot,
      cleanup: async () => {
        await rm(parent, { recursive: true, force: true });
      }
    };
  }

  const repoRoot = resolve(repo);
  if (!(await pathExists(repoRoot))) throw new Error(`Source repo does not exist: ${repoRoot}`);
  const topLevel = (await git(["rev-parse", "--show-toplevel"], repoRoot)).trim();
  return {
    repoRoot: topLevel || repoRoot,
    cleanup: async () => {}
  };
}

async function inferSourcePaths(repoRoot: string, sourceCommit: string, fixedCommit?: string): Promise<string[]> {
  const args =
    fixedCommit && fixedCommit !== sourceCommit
      ? ["diff", "--name-only", "--diff-filter=DMRT", sourceCommit, fixedCommit]
      : ["show", "--format=", "--name-only", fixedCommit ?? sourceCommit];
  const output = await git(args, repoRoot);
  return normalizeSourcePaths(output.split(/\r?\n/)).slice(0, 20);
}

function normalizeSourcePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.trim().replaceAll("\\", "/")).filter(isScaffoldSourcePath))];
}

function isScaffoldSourcePath(path: string): boolean {
  if (!path || path === "fix.diff" || path.includes("\0")) return false;
  if (path.startsWith("/") || path.startsWith("../") || path.includes("/../")) return false;
  return true;
}

async function buildFixDiff(
  repoRoot: string,
  sourceCommit: string,
  fixedCommit: string | undefined,
  sourcePaths: string[]
): Promise<string> {
  if (!fixedCommit) return "";
  if (fixedCommit === sourceCommit) {
    return git(["show", "--format=fuller", "--patch", "--find-renames", fixedCommit, "--", ...sourcePaths], repoRoot);
  }
  return git(["diff", "--find-renames", sourceCommit, fixedCommit, "--", ...sourcePaths], repoRoot);
}

function renderScaffoldCaseToml(options: BenchScaffoldOptions & {
  repo: string;
  claimPath: string;
  sourceCommit: string;
}): string {
  const tags = options.tags.length ? options.tags : defaultScaffoldTags(options.acceptedStatuses);
  const lines = [
    `id = ${tomlString(options.id)}`,
    `name = ${tomlString(options.name ?? options.id)}`,
    `repo = ${tomlString(options.repo)}`,
    `claim = ${tomlString(options.claimPath)}`,
    `focus = ${tomlString(options.focus)}`,
    `accepted_statuses = ${tomlArray(options.acceptedStatuses)}`,
    `tags = ${tomlArray(tags)}`,
    ...(options.notes ? [`notes = ${tomlString(options.notes)}`] : []),
    "",
    "[evidence]",
    `level = ${tomlString(options.evidenceLevel ?? "focused-source-snapshot")}`,
    ...(options.sourceUrl ? [`source_url = ${tomlString(options.sourceUrl)}`] : []),
    `source_commit = ${tomlString(options.sourceCommit)}`,
    ...(options.fixedCommit ? [`fixed_commit = ${tomlString(options.fixedCommit)}`] : []),
    `source_paths = ${tomlArray(options.sourcePaths)}`,
    ...(options.noveltyAsOf || options.noveltyState
      ? [
          "",
          "[novelty]",
          ...(options.noveltyAsOf ? [`as_of = ${tomlString(options.noveltyAsOf)}`] : []),
          ...(options.noveltyState ? [`state = ${tomlString(options.noveltyState)}`] : [])
        ]
      : [])
  ];
  return `${lines.join("\n")}\n`;
}

function defaultScaffoldTags(statuses: CandidateStatus[]): string[] {
  if (statuses.includes("SUBMIT")) return ["accepted"];
  if (statuses.includes("LIKELY_DUPLICATE")) return ["duplicate"];
  if (statuses.includes("REJECT")) return ["near-miss"];
  return ["source-fixture"];
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

async function git(args: string[], cwd?: string): Promise<string> {
  const proc = cwd
    ? Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
    : Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr.trim() || stdout.trim()}`);
  }
  return stdout;
}

function isRemoteGitTarget(target: string): boolean {
  return /^https?:\/\/.+\.git$/.test(target) || /^https?:\/\/github\.com\//.test(target) || /^git@/.test(target);
}
