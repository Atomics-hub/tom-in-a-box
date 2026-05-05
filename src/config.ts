import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as TOML from "smol-toml";
import type { AuditConfig, Focus } from "./types";
import { ensureDir, isFocus } from "./utils";

const DEFAULT_CONFIG: AuditConfig = {
  defaultFocus: "authz",
  hunterModel: "claude-sonnet-4-6",
  verificationModel: "claude-opus-4-7",
  maxCandidates: 10
};

export function configPath(): string {
  return join(homedir(), ".tib", "config.toml");
}

export async function loadConfig(): Promise<AuditConfig> {
  const path = configPath();
  const file = Bun.file(path);
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (!(await file.exists())) {
    return envKey ? { ...DEFAULT_CONFIG, anthropicApiKey: envKey } : DEFAULT_CONFIG;
  }

  const parsed = TOML.parse(await file.text()) as Record<string, unknown>;
  const defaultFocus = readFocus(parsed.default_focus, DEFAULT_CONFIG.defaultFocus);
  const config: AuditConfig = {
    defaultFocus,
    hunterModel: readString(parsed.hunter_model, DEFAULT_CONFIG.hunterModel),
    verificationModel: readString(parsed.verification_model, DEFAULT_CONFIG.verificationModel),
    maxCandidates: readNumber(parsed.max_candidates, DEFAULT_CONFIG.maxCandidates)
  };

  const apiKey = envKey || readOptionalString(parsed.anthropic_api_key);
  if (apiKey) config.anthropicApiKey = apiKey;

  const costCap = readOptionalNumber(parsed.cost_cap_usd);
  if (costCap !== undefined) config.costCapUsd = costCap;

  return config;
}

export async function writeDefaultConfig(): Promise<string> {
  const path = configPath();
  await ensureDir(dirname(path));
  const exists = await Bun.file(path).exists();
  if (!exists) {
    await Bun.write(
      path,
      [
        '# tom-in-a-box config',
        '# ANTHROPIC_API_KEY in the environment overrides anthropic_api_key.',
        'anthropic_api_key = "sk-ant-..."',
        'default_focus = "authz"',
        'hunter_model = "claude-sonnet-4-6"',
        'verification_model = "claude-opus-4-7"',
        "max_candidates = 10",
        "cost_cap_usd = 20",
        ""
      ].join("\n")
    );
  }
  return path;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readFocus(value: unknown, fallback: Focus): Focus {
  return typeof value === "string" && isFocus(value) ? value : fallback;
}
