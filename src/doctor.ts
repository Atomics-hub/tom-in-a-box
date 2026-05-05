import { configPath, loadConfig } from "./config";
import { loadBenchCases } from "./bench";
import { pathExists } from "./utils";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

export async function runDoctor(corpusDir = "benchmarks"): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  checks.push(await commandCheck("bun", ["--version"], "Bun runtime"));
  checks.push(await commandCheck("git", ["--version"], "Git"));
  checks.push(await commandCheck("rg", ["--version"], "ripgrep"));

  const path = configPath();
  const hasConfig = await pathExists(path);
  const config = await loadConfig();
  const hasEnvKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasConfigKey = Boolean(config.anthropicApiKey && config.anthropicApiKey !== "sk-ant-...");
  checks.push({
    name: "Anthropic API key",
    ok: hasEnvKey || hasConfigKey,
    detail: hasEnvKey
      ? "ANTHROPIC_API_KEY is set in the environment."
      : hasConfigKey
        ? `${path} contains an API key.`
        : `Missing. Run tib init-config and set ${path}, or export ANTHROPIC_API_KEY.`
  });
  checks.push({
    name: "Config file",
    ok: hasConfig,
    detail: hasConfig ? path : `Missing. Run tib init-config to create ${path}.`
  });
  checks.push({
    name: "Models",
    ok: true,
    detail: `hunter=${config.hunterModel}, verification=${config.verificationModel}`
  });

  try {
    const cases = await loadBenchCases(corpusDir);
    checks.push({
      name: "Benchmark corpus",
      ok: cases.length > 0,
      detail: `${corpusDir}: ${cases.length} case(s) found.`
    });
  } catch (error) {
    checks.push({
      name: "Benchmark corpus",
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  return { ok: checks.every((check) => check.ok), checks };
}

async function commandCheck(command: string, args: string[], name: string): Promise<DoctorCheck> {
  try {
    const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ]);
    return {
      name,
      ok: code === 0,
      detail: code === 0 ? firstLine(stdout) : firstLine(stderr || stdout)
    };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/)[0] || "not found";
}
