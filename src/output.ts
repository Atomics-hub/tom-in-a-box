import { join, resolve } from "node:path";
import type {
  AgentResult,
  AuditArtifacts,
  CandidateFinding,
  CandidateStatus,
  CodeMap,
  Focus,
  VerifiedFinding
} from "./types";
import { ensureDir, timestampSlug } from "./utils";

export interface OutputInput {
  repoName: string;
  target: string;
  focus: Focus;
  codeMap: CodeMap;
  candidates: CandidateFinding[];
  verified: VerifiedFinding[];
  outDir?: string;
}

export async function writeAuditOutput(input: OutputInput): Promise<AuditArtifacts> {
  const root = resolve(input.outDir ?? join(process.cwd(), "audit-results"));
  const outputDir = join(root, `${input.repoName}-${timestampSlug()}`);
  const archiveDir = join(outputDir, "archived");
  await ensureDir(outputDir);
  await ensureDir(archiveDir);

  const summaryPath = join(outputDir, "summary.md");
  const candidatesPath = join(outputDir, "raw-candidates.json");
  const verificationPath = join(outputDir, "verification-results.json");

  await Bun.write(summaryPath, renderSummary(input));
  await Bun.write(candidatesPath, JSON.stringify(input.candidates, null, 2));
  await Bun.write(verificationPath, JSON.stringify(input.verified, null, 2));

  for (const [index, finding] of input.verified.entries()) {
    const rank = index + 1;
    const dir = finding.status === "SUBMIT" ? outputDir : archiveDir;
    await Bun.write(join(dir, `${rank}-finding.md`), renderFinding(finding, input.codeMap));
    await Bun.write(join(dir, `${rank}-poc.md`), renderPoc(finding));
  }

  return { outputDir, summaryPath, candidatesPath, verificationPath };
}

function renderSummary(input: OutputInput): string {
  const submitCount = input.verified.filter((finding) => finding.status === "SUBMIT").length;
  const statusLines = input.verified.length
    ? input.verified.map((finding, index) => renderSummaryRow(index + 1, finding)).join("\n")
    : "| - | - | - | - | No candidates produced. |\n";
  const warnings = input.codeMap.warnings.length
    ? `\n## Map Warnings\n\n${input.codeMap.warnings.map((warning) => `- ${warning}`).join("\n")}\n`
    : "";

  return [
    `# ${input.repoName} Security Audit`,
    "",
    `- Target: ${input.target}`,
    `- Commit: ${input.codeMap.commit}`,
    `- Focus: ${input.focus}`,
    `- Files mapped: ${input.codeMap.files.length}`,
    `- Symbols mapped: ${input.codeMap.symbols.length}`,
    `- Candidates: ${input.candidates.length}`,
    `- Ready to submit: ${submitCount}`,
    "",
    "## Ranked Candidates",
    "",
    "| Rank | Status | Score | Severity | Finding |",
    "| --- | --- | ---: | --- | --- |",
    statusLines,
    warnings,
    "## Reading The Verdicts",
    "",
    "- `SUBMIT` means every verification agent returned `AGREE`.",
    "- `REJECT` means at least one agent found a blocking contradiction.",
    "- `LIKELY_DUPLICATE` means novelty review found meaningful duplicate risk.",
    "- `NEEDS_MANUAL_REVIEW` means no hard rejection, but at least one agent was not willing to agree.",
    ""
  ].join("\n");
}

function renderSummaryRow(rank: number, finding: VerifiedFinding): string {
  return `| ${rank} | ${finding.status} | ${finding.score.toFixed(2)} | ${finding.candidate.severity} | ${escapePipes(
    finding.candidate.title
  )} |`;
}

function renderFinding(finding: VerifiedFinding, codeMap: CodeMap): string {
  const writeup = finding.verification.find((result) => result.agent === "audit-writeup")?.writeupMarkdown;
  if (writeup?.trim()) {
    return addVerificationAppendix(writeup.trim(), finding);
  }

  const c = finding.candidate;
  return addVerificationAppendix(
    [
      `# ${c.title}`,
      "",
      "## Advisory Metadata",
      "",
      `- Status: ${finding.status}`,
      `- Severity: ${c.severity}`,
      `- Confidence: ${c.confidence.toFixed(2)}`,
      `- Focus: ${c.focus}`,
      `- Repository commit: ${codeMap.commit}`,
      "",
      "## Summary",
      "",
      c.summary,
      "",
      "## Affected Code",
      "",
      c.files.length ? c.files.map(renderLocation).join("\n") : "- Unknown",
      "",
      "## Attack Path",
      "",
      c.attackPath,
      "",
      "## Impact",
      "",
      c.impact,
      "",
      "## Evidence",
      "",
      c.evidence.length ? c.evidence.map((item) => `- ${item}`).join("\n") : "- No evidence returned.",
      ""
    ].join("\n"),
    finding
  );
}

function renderPoc(finding: VerifiedFinding): string {
  const poc = finding.verification.find((result) => result.agent === "audit-poc")?.pocMarkdown;
  if (poc?.trim()) return poc.trim() + "\n";

  return [
    `# PoC: ${finding.candidate.title}`,
    "",
    `Status: ${finding.status}`,
    "",
    finding.candidate.pocPlan || "No PoC was produced. Review the verification appendix in the finding writeup.",
    ""
  ].join("\n");
}

function addVerificationAppendix(markdown: string, finding: VerifiedFinding): string {
  return [
    markdown,
    "",
    "## Verification Appendix",
    "",
    `Final status: ${finding.status}`,
    `Score: ${finding.score.toFixed(2)}`,
    "",
    "| Agent | Verdict | Confidence | Summary |",
    "| --- | --- | ---: | --- |",
    ...finding.verification.map(renderAgentRow),
    "",
    "### Blocking Facts",
    "",
    renderBlockingFacts(finding.verification),
    ""
  ].join("\n");
}

function renderAgentRow(result: AgentResult): string {
  return `| ${result.agent} | ${result.verdict} | ${result.confidence.toFixed(2)} | ${escapePipes(result.summary)} |`;
}

function renderBlockingFacts(results: AgentResult[]): string {
  const facts = results.flatMap((result) => result.blockingFacts.map((fact) => `- ${result.agent}: ${fact}`));
  return facts.length ? facts.join("\n") : "- None reported.";
}

function renderLocation(location: CandidateFinding["files"][number]): string {
  const line =
    location.startLine && location.endLine
      ? `:${location.startLine}-${location.endLine}`
      : location.startLine
        ? `:${location.startLine}`
        : "";
  const symbol = location.symbol ? ` (${location.symbol})` : "";
  return `- ${location.path}${line}${symbol}`;
}

function escapePipes(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}
