import { basename, extname } from "node:path";
import { stat } from "node:fs/promises";

export function isFocus(value: string): value is import("./types").Focus {
  return ["authn", "authz", "injection", "memory", "race"].includes(value);
}

export function sanitizeName(input: string): string {
  return input
    .replace(/\.git$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "repo";
}

export function repoNameFromTarget(target: string): string {
  const cleaned = target.replace(/[#?].*$/, "").replace(/\/+$/, "");
  if (cleaned.startsWith("git@")) {
    return sanitizeName(basename(cleaned.split(":").pop() ?? cleaned));
  }
  return sanitizeName(basename(cleaned));
}

export function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(path: string): Promise<void> {
  await Bun.$`mkdir -p ${path}`.quiet();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const keep = Math.max(0, maxChars - 80);
  return `${text.slice(0, keep)}\n\n[truncated ${text.length - keep} chars]`;
}

export function extensionLanguage(path: string): string {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".c":
    case ".h":
      return "c";
    case ".cc":
    case ".cpp":
    case ".cxx":
    case ".hpp":
      return "cpp";
    case ".java":
      return "java";
    case ".rb":
      return "ruby";
    case ".php":
      return "php";
    case ".cs":
      return "csharp";
    case ".swift":
      return "swift";
    case ".kt":
    case ".kts":
      return "kotlin";
    case ".sql":
      return "sql";
    case ".sol":
      return "solidity";
    default:
      return "unknown";
  }
}

export function parseJsonFromText<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate.trim()) {
    throw new Error("Model response did not contain JSON.");
  }
  return JSON.parse(candidate) as T;
}

export function readableList(items: string[]): string {
  if (items.length === 0) return "none";
  return items.join(", ");
}
