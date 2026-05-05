import Anthropic from "@anthropic-ai/sdk";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentResult, AgentVerdict, AuditConfig, VerificationAgentName } from "../types";
import { clamp, parseJsonFromText } from "../utils";
import type { CostTracker } from "../pricing";
import hunterPrompt from "../../prompts/hunter.md" with { type: "text" };
import noveltyPrompt from "../../prompts/novelty.md" with { type: "text" };
import pocPrompt from "../../prompts/poc.md" with { type: "text" };
import pocTextVerdictPrompt from "../../prompts/poc-text-verdict.md" with { type: "text" };
import pocVerdictPrompt from "../../prompts/poc-verdict.md" with { type: "text" };
import revalidatePrompt from "../../prompts/revalidate.md" with { type: "text" };
import stylePrompt from "../../prompts/style.md" with { type: "text" };
import textVerdictPrompt from "../../prompts/text-verdict.md" with { type: "text" };
import trybreakPrompt from "../../prompts/trybreak.md" with { type: "text" };
import writeupPrompt from "../../prompts/writeup.md" with { type: "text" };

const PROMPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../prompts");
const EMBEDDED_PROMPTS: Record<string, string> = {
  "hunter.md": hunterPrompt,
  "novelty.md": noveltyPrompt,
  "poc.md": pocPrompt,
  "poc-text-verdict.md": pocTextVerdictPrompt,
  "poc-verdict.md": pocVerdictPrompt,
  "revalidate.md": revalidatePrompt,
  "style.md": stylePrompt,
  "text-verdict.md": textVerdictPrompt,
  "trybreak.md": trybreakPrompt,
  "writeup.md": writeupPrompt
};

export interface AgentRuntime {
  config: AuditConfig;
  dryRun: boolean;
  offline: boolean;
  costTracker?: CostTracker;
}

export interface ModelJsonCall {
  runtime: AgentRuntime;
  model: string;
  promptName: string;
  userPrompt: string;
  inputSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  outputMode?: "tool" | "text";
}

export async function loadPrompt(name: string): Promise<string> {
  if (EMBEDDED_PROMPTS[name]) return EMBEDDED_PROMPTS[name];
  return Bun.file(join(PROMPTS_DIR, name)).text();
}

export async function callJsonModel<T>(call: ModelJsonCall): Promise<{ parsed: T; rawText: string }> {
  if (call.runtime.dryRun) {
    throw new Error("Dry run requested; model call was skipped.");
  }
  if (call.runtime.offline) {
    throw new Error("Offline mode requested; model call was skipped.");
  }
  if (!call.runtime.config.anthropicApiKey) {
    throw new Error(
      "Missing Anthropic API key. Run `tib init-config`, set ~/.tib/config.toml, or export ANTHROPIC_API_KEY."
    );
  }

  const anthropic = new Anthropic({ apiKey: call.runtime.config.anthropicApiKey });
  const system = await loadPrompt(call.promptName);
  call.runtime.costTracker?.reserve(call.model, `${system}\n${call.userPrompt}`, call.maxTokens ?? 4096);
  const baseRequest = {
    model: call.model,
    max_tokens: call.maxTokens ?? 4096,
    system,
    messages: [{ role: "user" as const, content: call.userPrompt }]
  };

  if (call.outputMode === "text") {
    const message = await anthropic.messages.create(baseRequest);
    const rawText = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    return { parsed: parseJsonFromText<T>(rawText), rawText };
  }

  const request = {
    ...baseRequest,
    tools: [
      {
        name: "return_json",
        description: "Return the requested structured JSON result.",
        input_schema: (call.inputSchema ?? { type: "object" as const, additionalProperties: true }) as {
          type: "object";
          [key: string]: unknown;
        }
      }
    ],
    tool_choice: { type: "tool" as const, name: "return_json" }
  } satisfies Parameters<typeof anthropic.messages.create>[0];
  const message = await anthropic.messages.create(request);
  const toolUse = message.content.find((block) => block.type === "tool_use" && block.name === "return_json");
  if (toolUse?.type === "tool_use") {
    return { parsed: toolUse.input as T, rawText: JSON.stringify(toolUse.input) };
  }
  const rawText = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return { parsed: parseJsonFromText<T>(rawText), rawText };
}

export async function callTextModel(call: ModelJsonCall): Promise<string> {
  if (call.runtime.dryRun) {
    throw new Error("Dry run requested; model call was skipped.");
  }
  if (call.runtime.offline) {
    throw new Error("Offline mode requested; model call was skipped.");
  }
  if (!call.runtime.config.anthropicApiKey) {
    throw new Error(
      "Missing Anthropic API key. Run `tib init-config`, set ~/.tib/config.toml, or export ANTHROPIC_API_KEY."
    );
  }

  const anthropic = new Anthropic({ apiKey: call.runtime.config.anthropicApiKey });
  const system = await loadPrompt(call.promptName);
  call.runtime.costTracker?.reserve(call.model, `${system}\n${call.userPrompt}`, call.maxTokens ?? 4096);
  const message = await anthropic.messages.create({
    model: call.model,
    max_tokens: call.maxTokens ?? 4096,
    system,
    messages: [{ role: "user" as const, content: call.userPrompt }]
  });
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export interface RawAgentResult {
  verdict?: string;
  confidence?: number;
  summary?: string;
  evidence?: unknown;
  blocking_facts?: unknown;
  blockingFacts?: unknown;
  assumptions?: unknown;
  files_reviewed?: unknown;
  filesReviewed?: unknown;
  writeup_markdown?: string;
  writeupMarkdown?: string;
  poc_markdown?: string;
  pocMarkdown?: string;
}

export function normalizeAgentResult(
  agent: VerificationAgentName,
  raw: RawAgentResult,
  rawText?: string
): AgentResult {
  const normalizedRaw = unwrapRawAgentResult(raw);
  if (!isAgentVerdict(normalizedRaw.verdict)) {
    return malformedAgentResult(agent, rawText);
  }
  return {
    agent,
    verdict: normalizedRaw.verdict,
    confidence: clamp(typeof normalizedRaw.confidence === "number" ? normalizedRaw.confidence : 0.5, 0, 1),
    summary: typeof normalizedRaw.summary === "string" ? normalizedRaw.summary : "No summary returned.",
    evidence: normalizeStringArray(normalizedRaw.evidence),
    blockingFacts: normalizeStringArray(normalizedRaw.blocking_facts ?? normalizedRaw.blockingFacts),
    assumptions: normalizeStringArray(normalizedRaw.assumptions),
    filesReviewed: normalizeStringArray(normalizedRaw.files_reviewed ?? normalizedRaw.filesReviewed),
    ...(normalizedRaw.writeup_markdown || normalizedRaw.writeupMarkdown
      ? { writeupMarkdown: normalizedRaw.writeup_markdown ?? normalizedRaw.writeupMarkdown }
      : {}),
    ...(normalizedRaw.poc_markdown || normalizedRaw.pocMarkdown
      ? { pocMarkdown: normalizedRaw.poc_markdown ?? normalizedRaw.pocMarkdown }
      : {}),
    ...(rawText ? { rawText } : {})
  };
}

export function hasRawAgentVerdict(raw: RawAgentResult): boolean {
  return isAgentVerdict(unwrapRawAgentResult(raw).verdict);
}

export function offlineAgentResult(agent: VerificationAgentName, summary: string): AgentResult {
  return {
    agent,
    verdict: "NEEDS_REVIEW",
    confidence: 0.25,
    summary,
    evidence: ["Offline mode did not call the model."],
    blockingFacts: ["No independent AI verification was performed."],
    assumptions: ["Use without --offline for a real verdict."],
    filesReviewed: []
  };
}

export function malformedAgentResult(agent: VerificationAgentName, rawText?: string, attempts = 1): AgentResult {
  const trimmedRaw = rawText?.trim();
  const attemptText = attempts > 1 ? ` after ${attempts} attempts` : "";
  return {
    agent,
    verdict: "NEEDS_REVIEW",
    confidence: 0,
    summary: `Agent returned malformed output${attemptText}; no trustworthy verdict was available.`,
    evidence: trimmedRaw ? [`Raw model output: ${truncateForEvidence(trimmedRaw)}`] : [],
    blockingFacts: ["Model response did not include a valid AGREE, REJECT, LIKELY_DUPLICATE, or NEEDS_REVIEW verdict."],
    assumptions: ["Treat this candidate as requiring manual review or rerun the verifier."],
    filesReviewed: [],
    ...(rawText ? { rawText } : {})
  };
}

function unwrapRawAgentResult(raw: RawAgentResult): RawAgentResult {
  if (typeof raw.verdict === "string") return raw;
  const record = raw as Record<string, unknown>;
  for (const key of ["value", "_", "parameter", "input", "result", "json"]) {
    const candidate = record[key];
    if (isRecord(candidate) && typeof candidate.verdict === "string") {
      return candidate as RawAgentResult;
    }
  }
  for (const value of Object.values(record)) {
    if (isRecord(value) && typeof value.verdict === "string") {
      return value as RawAgentResult;
    }
  }
  return raw;
}

function isAgentVerdict(value: unknown): value is AgentVerdict {
  return value === "AGREE" || value === "REJECT" || value === "LIKELY_DUPLICATE" || value === "NEEDS_REVIEW";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function truncateForEvidence(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}
