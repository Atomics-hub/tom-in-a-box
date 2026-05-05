import { buildCodeMap, collectEvidenceBundle } from "./codemap";
import { prepareRepo } from "./clone";
import { recordAudit } from "./db";
import { runHunter } from "./agents/hunter";
import { runNovelty } from "./agents/novelty";
import { runPoc } from "./agents/poc";
import { runRevalidate } from "./agents/revalidate";
import { runStyle } from "./agents/style";
import { runTryBreak } from "./agents/trybreak";
import { runWriteup } from "./agents/writeup";
import { writeAuditOutput } from "./output";
import { CostTracker, estimateModelCostUsd } from "./pricing";
import type {
  AgentResult,
  AuditArtifacts,
  AuditConfig,
  AuditOptions,
  BenchmarkContext,
  CandidateFinding,
  CandidateStatus,
  CodeMap,
  Focus,
  VerificationAgentName,
  VerifiedFinding,
  VerifyOptions
} from "./types";
import { VERIFICATION_AGENT_NAMES } from "./types";
import { estimateTokens } from "./utils";

export interface PipelineResult {
  codeMap: CodeMap;
  candidates: CandidateFinding[];
  verified: VerifiedFinding[];
  artifacts?: AuditArtifacts;
  dryRunEstimate?: DryRunEstimate;
}

export interface DryRunEstimate {
  plannedModelCalls: number;
  approximateInputTokens: number;
  approximateMaxCostUsd: number;
  candidateSlots: number;
  verificationAgents: number;
}

const VERIFICATION_AGENT_COUNT: number = VERIFICATION_AGENT_NAMES.length;
const MAX_VERIFICATION_ATTEMPTS_PER_AGENT = 2;

export async function runAudit(config: AuditConfig, options: AuditOptions): Promise<PipelineResult> {
  const repo = await prepareRepo(options.target, options.keepClone);
  try {
    const codeMap = await buildCodeMap(repo.repoRoot, repo.repoName, repo.commit);
    if (options.dryRun) {
      return {
        codeMap,
        candidates: [],
        verified: [],
        dryRunEstimate: estimateAudit(withOptionOverrides(config, options), codeMap, options.maxCandidates)
      };
    }

    const runtimeConfig = withOptionOverrides(config, options);
    const runtime = {
      config: runtimeConfig,
      dryRun: options.dryRun,
      offline: options.offline,
      costTracker: new CostTracker(runtimeConfig.costCapUsd)
    };
    const candidates = await runHunter(runtime, codeMap, options.focus, options.maxCandidates);
    const verified = await Promise.all(candidates.map((candidate) => verifyCandidate(runtime, codeMap, candidate)));
    verified.sort((a, b) => b.score - a.score);

    const outputInput = {
      repoName: repo.repoName,
      target: options.target,
      focus: options.focus,
      codeMap,
      candidates,
      verified
    };
    const artifacts = await writeAuditOutput(options.outDir ? { ...outputInput, outDir: options.outDir } : outputInput);

    await recordAudit(
      {
        repo: repo.repoName,
        target: options.target,
        commit: codeMap.commit,
        focus: options.focus,
        outputDir: artifacts.outputDir,
        candidateCount: candidates.length,
        submitCount: verified.filter((finding) => finding.status === "SUBMIT").length
      },
      verified.map((finding) => ({
        auditId: 0,
        title: finding.candidate.title,
        status: finding.status,
        severity: finding.candidate.severity,
        score: finding.score
      }))
    );

    return { codeMap, candidates, verified, artifacts };
  } finally {
    await repo.cleanup();
  }
}

export async function runVerify(
  config: AuditConfig,
  options: VerifyOptions,
  externalCostTracker?: CostTracker
): Promise<PipelineResult> {
  const repo = await prepareRepo(options.target, options.keepClone);
  try {
    const codeMap = await buildCodeMap(repo.repoRoot, repo.repoName, repo.commit);
    const claimMarkdown = await Bun.file(options.claimPath).text();
    const candidate = candidateFromClaim(claimMarkdown, options.focus, codeMap);
    if (options.dryRun) {
      const evidencePaths = [...candidate.files.map((file) => file.path), ...(options.benchmarkContext?.sourcePaths ?? [])];
      const evidenceBundle = await collectEvidenceBundle(codeMap.repoRoot, evidencePaths, selectFallbackFiles(codeMap, candidate.focus));
      return {
        codeMap,
        candidates: [candidate],
        verified: [],
        dryRunEstimate: estimateVerify(
          withOptionOverrides(config, options),
          codeMap,
          claimMarkdown,
          options.benchmarkContext,
          evidenceBundle,
          options.onlyAgents?.length ?? VERIFICATION_AGENT_COUNT
        )
      };
    }

    const runtimeConfig = withOptionOverrides(config, options);
    const runtime = {
      config: runtimeConfig,
      dryRun: options.dryRun,
      offline: options.offline,
      costTracker: externalCostTracker ?? new CostTracker(runtimeConfig.costCapUsd)
    };
    const rerunOptions: { onlyAgents?: VerificationAgentName[]; previousVerification?: AgentResult[] } = {};
    if (options.onlyAgents?.length) rerunOptions.onlyAgents = options.onlyAgents;
    if (options.previousVerification) rerunOptions.previousVerification = options.previousVerification;
    const verified = [await verifyCandidate(runtime, codeMap, candidate, claimMarkdown, options.benchmarkContext, rerunOptions)];
    const outputInput = {
      repoName: repo.repoName,
      target: options.target,
      focus: options.focus,
      codeMap,
      candidates: [candidate],
      verified
    };
    const artifacts = await writeAuditOutput(options.outDir ? { ...outputInput, outDir: options.outDir } : outputInput);

    await recordAudit(
      {
        repo: repo.repoName,
        target: options.target,
        commit: codeMap.commit,
        focus: options.focus,
        outputDir: artifacts.outputDir,
        candidateCount: 1,
        submitCount: verified[0]?.status === "SUBMIT" ? 1 : 0
      },
      verified.map((finding) => ({
        auditId: 0,
        title: finding.candidate.title,
        status: finding.status,
        severity: finding.candidate.severity,
        score: finding.score
      }))
    );

    return { codeMap, candidates: [candidate], verified, artifacts };
  } finally {
    await repo.cleanup();
  }
}

async function verifyCandidate(
  runtime: { config: AuditConfig; dryRun: boolean; offline: boolean; costTracker?: CostTracker },
  codeMap: CodeMap,
  candidate: CandidateFinding,
  claimMarkdown?: string,
  benchmarkContext?: BenchmarkContext,
  rerun?: {
    onlyAgents?: VerificationAgentName[];
    previousVerification?: AgentResult[];
  }
): Promise<VerifiedFinding> {
  const candidatePaths = [...candidate.files.map((file) => file.path), ...(benchmarkContext?.sourcePaths ?? [])];
  const fallbackPaths = selectFallbackFiles(codeMap, candidate.focus);
  const evidenceBundle = await collectEvidenceBundle(codeMap.repoRoot, candidatePaths, fallbackPaths);
  const context = {
    runtime,
    codeMap,
    candidate,
    evidenceBundle,
    ...(claimMarkdown ? { claimMarkdown } : {}),
    ...(benchmarkContext ? { benchmarkContext } : {})
  };
  const runnerFactories: Record<VerificationAgentName, () => Promise<AgentResult>> = {
    revalidate: () => runRevalidate(context),
    trybreak: () => runTryBreak(context),
    "audit-writeup": () => runWriteup(context),
    "audit-poc": () => runPoc(context),
    novelty: () => runNovelty(context),
    "style-consistency": () => runStyle(context)
  };
  const agentsToRun = rerun?.onlyAgents?.length ? uniqueAgents(rerun.onlyAgents) : [...VERIFICATION_AGENT_NAMES];

  const rerunResults = await Promise.all(
    agentsToRun.map(async (agent) => {
      try {
        return await runnerFactories[agent]();
      } catch (error) {
        return agentFailure(agent, error);
      }
    })
  );
  const verification = mergeVerificationResults(rerun?.previousVerification ?? [], rerunResults);

  const status = finalStatus(verification);
  return {
    candidate,
    verification,
    status,
    score: scoreFinding(candidate, verification, status)
  };
}

export function mergeVerificationResults(previous: AgentResult[], rerunResults: AgentResult[]): AgentResult[] {
  const rerunAgents = new Set(rerunResults.map((result) => result.agent));
  const merged = [...previous.filter((result) => !rerunAgents.has(result.agent)), ...rerunResults];
  return VERIFICATION_AGENT_NAMES.flatMap((agent) => {
    const result = merged.find((candidate) => candidate.agent === agent);
    return result ? [result] : [];
  });
}

export function finalStatus(results: AgentResult[]): CandidateStatus {
  if (results.some((result) => result.verdict === "REJECT")) return "REJECT";
  if (results.some((result) => result.verdict === "LIKELY_DUPLICATE")) return "LIKELY_DUPLICATE";
  const complete = VERIFICATION_AGENT_NAMES.every((agent) => results.some((result) => result.agent === agent));
  if (complete && results.every((result) => result.verdict === "AGREE")) return "SUBMIT";
  return "NEEDS_MANUAL_REVIEW";
}

function uniqueAgents(agents: VerificationAgentName[]): VerificationAgentName[] {
  const selected = new Set(agents);
  return VERIFICATION_AGENT_NAMES.filter((agent) => selected.has(agent));
}

function scoreFinding(candidate: CandidateFinding, results: AgentResult[], status: CandidateStatus): number {
  const severityWeight: Record<string, number> = {
    critical: 1,
    high: 0.88,
    medium: 0.65,
    low: 0.42,
    informational: 0.2,
    unknown: 0.35
  };
  const agreeRatio = results.length
    ? results.filter((result) => result.verdict === "AGREE").length / results.length
    : 0;
  const meanConfidence = results.length
    ? results.reduce((sum, result) => sum + result.confidence, 0) / results.length
    : 0;
  const statusWeight: Record<CandidateStatus, number> = {
    SUBMIT: 1,
    NEEDS_MANUAL_REVIEW: 0.55,
    LIKELY_DUPLICATE: 0.2,
    REJECT: 0.05
  };
  return (
    (candidate.confidence * 0.35 +
      (severityWeight[candidate.severity] ?? 0.35) * 0.2 +
      agreeRatio * 0.3 +
      meanConfidence * 0.15) *
    statusWeight[status]
  );
}

function agentFailure(agent: VerificationAgentName, error: unknown): AgentResult {
  return {
    agent,
    verdict: "NEEDS_REVIEW",
    confidence: 0,
    summary: "Agent failed before returning a verdict.",
    evidence: [],
    blockingFacts: [error instanceof Error ? error.message : String(error)],
    assumptions: [],
    filesReviewed: []
  };
}

function candidateFromClaim(markdown: string, focus: Focus, codeMap: CodeMap): CandidateFinding {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "Researcher-supplied vulnerability claim";
  const files = codeMap.files
    .filter((file) => markdown.includes(file.path))
    .slice(0, 12)
    .map((file) => ({ path: file.path }));

  return {
    id: "claim-1",
    title,
    focus,
    severity: severityFromClaim(markdown),
    confidence: 0.5,
    summary: markdown.slice(0, 1200),
    files,
    attackPath: "Provided by researcher claim; verification agents must independently validate it.",
    impact: "Provided by researcher claim; verification agents must independently validate it.",
    evidence: ["Researcher supplied an external claim document."],
    pocPlan: "Verification agents should derive a minimal reproduction from the claim and source."
  };
}

function severityFromClaim(markdown: string): CandidateFinding["severity"] {
  const lower = markdown.toLowerCase();
  if (lower.includes("critical")) return "critical";
  if (lower.includes("high")) return "high";
  if (lower.includes("medium")) return "medium";
  if (lower.includes("low")) return "low";
  return "unknown";
}

function selectFallbackFiles(codeMap: CodeMap, focus: Focus): string[] {
  const focusPattern: Record<Focus, RegExp> = {
    authn: /auth|login|session|jwt|token|password|oauth/i,
    authz: /auth|role|permission|policy|admin|acl|tenant|owner/i,
    injection: /sql|query|exec|command|template|deserialize|xpath|ldap/i,
    memory: /unsafe|alloc|free|ptr|buffer|mem|copy|slice/i,
    race: /race|lock|mutex|thread|async|queue|transaction|atomic/i
  };
  return codeMap.files
    .filter((file) => focusPattern[focus].test(file.path) || file.symbols.some((symbol) => focusPattern[focus].test(symbol.name)))
    .slice(0, 10)
    .map((file) => file.path);
}

function estimateAudit(config: AuditConfig, codeMap: CodeMap, maxCandidates: number): DryRunEstimate {
  const mapText = JSON.stringify({
    files: codeMap.files.slice(0, 180),
    warnings: codeMap.warnings
  });
  const mapTokens = estimateTokens(mapText);
  const hunterCost = estimateModelCostUsd(config.hunterModel, mapTokens, 6000);
  const maxVerificationCalls = maxCandidates * VERIFICATION_AGENT_COUNT * MAX_VERIFICATION_ATTEMPTS_PER_AGENT;
  const verificationCost = estimateModelCostUsd(config.verificationModel, mapTokens, 7000) * maxVerificationCalls;
  return {
    plannedModelCalls: 1 + maxVerificationCalls,
    approximateInputTokens: mapTokens * (1 + maxVerificationCalls),
    approximateMaxCostUsd: hunterCost + verificationCost,
    candidateSlots: maxCandidates,
    verificationAgents: VERIFICATION_AGENT_COUNT
  };
}

function estimateVerify(
  config: AuditConfig,
  codeMap: CodeMap,
  claimMarkdown: string,
  benchmarkContext?: BenchmarkContext,
  evidenceBundle?: string,
  verificationAgents: number = VERIFICATION_AGENT_COUNT
): DryRunEstimate {
  const mapText = JSON.stringify({
    files: codeMap.files.slice(0, 180),
    warnings: codeMap.warnings,
    claimMarkdown,
    benchmarkContext,
    evidenceBundle
  });
  const mapTokens = estimateTokens(mapText);
  const verificationCalls = verificationAgents * MAX_VERIFICATION_ATTEMPTS_PER_AGENT;
  return {
    plannedModelCalls: verificationCalls,
    approximateInputTokens: mapTokens * verificationCalls,
    approximateMaxCostUsd:
      estimateModelCostUsd(config.verificationModel, mapTokens, 7000) * verificationCalls,
    candidateSlots: 1,
    verificationAgents
  };
}

function withOptionOverrides(config: AuditConfig, options: { costCapUsd?: number }): AuditConfig {
  if (options.costCapUsd === undefined) return config;
  return { ...config, costCapUsd: options.costCapUsd };
}
