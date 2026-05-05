export const FOCI = ["authn", "authz", "injection", "memory", "race"] as const;

export type Focus = (typeof FOCI)[number];

export type Severity = "critical" | "high" | "medium" | "low" | "informational" | "unknown";

export type CandidateStatus = "SUBMIT" | "REJECT" | "LIKELY_DUPLICATE" | "NEEDS_MANUAL_REVIEW";

export const CANDIDATE_STATUSES = ["SUBMIT", "REJECT", "LIKELY_DUPLICATE", "NEEDS_MANUAL_REVIEW"] as const;

export type AgentVerdict = "AGREE" | "REJECT" | "LIKELY_DUPLICATE" | "NEEDS_REVIEW";

export const VERIFICATION_AGENT_NAMES = [
  "revalidate",
  "trybreak",
  "audit-writeup",
  "audit-poc",
  "novelty",
  "style-consistency"
] as const;

export type VerificationAgentName = (typeof VERIFICATION_AGENT_NAMES)[number];

export interface AuditConfig {
  anthropicApiKey?: string;
  defaultFocus: Focus;
  hunterModel: string;
  verificationModel: string;
  maxCandidates: number;
  costCapUsd?: number;
}

export interface AuditOptions {
  target: string;
  focus: Focus;
  maxCandidates: number;
  dryRun: boolean;
  offline: boolean;
  keepClone: boolean;
  outDir?: string;
  costCapUsd?: number;
}

export interface BenchmarkContext {
  caseId: string;
  evidenceLevel?: string;
  sourceUrl?: string;
  sourceCommit?: string;
  fixedCommit?: string;
  sourcePaths?: string[];
  noveltyAsOf?: string;
  disclosureState?: string;
}

export interface VerifyOptions extends Omit<AuditOptions, "maxCandidates"> {
  claimPath: string;
  benchmarkContext?: BenchmarkContext;
  onlyAgents?: VerificationAgentName[];
  previousVerification?: AgentResult[];
}

export interface CodeLocation {
  path: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
}

export interface CandidateFinding {
  id: string;
  title: string;
  focus: Focus;
  severity: Severity;
  confidence: number;
  summary: string;
  files: CodeLocation[];
  attackPath: string;
  impact: string;
  evidence: string[];
  pocPlan?: string;
  duplicateRisk?: string;
}

export interface CodeSymbol {
  name: string;
  kind: string;
  path: string;
  line: number;
}

export interface CodeFileSummary {
  path: string;
  language: string;
  bytes: number;
  lines: number;
  imports: string[];
  symbols: CodeSymbol[];
}

export interface CodeMap {
  repoRoot: string;
  repoName: string;
  commit: string;
  files: CodeFileSummary[];
  symbols: CodeSymbol[];
  warnings: string[];
}

export interface AgentResult {
  agent: VerificationAgentName;
  verdict: AgentVerdict;
  confidence: number;
  summary: string;
  evidence: string[];
  blockingFacts: string[];
  assumptions: string[];
  filesReviewed: string[];
  writeupMarkdown?: string;
  pocMarkdown?: string;
  rawText?: string;
}

export interface VerifiedFinding {
  candidate: CandidateFinding;
  status: CandidateStatus;
  verification: AgentResult[];
  score: number;
}

export interface AuditArtifacts {
  outputDir: string;
  summaryPath: string;
  candidatesPath: string;
  verificationPath: string;
}
