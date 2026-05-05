import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { CodeFileSummary, CodeMap, CodeSymbol } from "./types";
import { extensionLanguage, truncateText } from "./utils";

const MAX_FILE_BYTES = 250_000;
const MAX_FILES = 900;
const EXCLUDED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  ".next",
  ".turbo",
  "coverage",
  "__pycache__"
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".zip",
  ".gz",
  ".tar",
  ".pdf",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".wasm",
  ".lockb"
]);

export async function buildCodeMap(repoRoot: string, repoName: string, commit: string): Promise<CodeMap> {
  const warnings: string[] = [];
  const paths = (await listTrackedFiles(repoRoot)).filter(shouldIncludePath).slice(0, MAX_FILES);
  if (paths.length === MAX_FILES) {
    warnings.push(`Repo map capped at ${MAX_FILES} files.`);
  }

  const files: CodeFileSummary[] = [];
  for (const path of paths) {
    const summary = await summarizeFile(repoRoot, path);
    if (summary) files.push(summary);
  }

  const symbols = files.flatMap((file) => file.symbols);
  return { repoRoot, repoName, commit, files, symbols, warnings };
}

export function renderCodeMapForPrompt(codeMap: CodeMap): string {
  const topFiles = codeMap.files
    .slice(0, 180)
    .map((file) => {
      const symbols = file.symbols
        .slice(0, 12)
        .map((symbol) => `${symbol.kind} ${symbol.name}:${symbol.line}`)
        .join("; ");
      const imports = file.imports.slice(0, 8).join("; ");
      return `- ${file.path} (${file.language}, ${file.lines} lines) imports=[${imports}] symbols=[${symbols}]`;
    })
    .join("\n");

  const warnings = codeMap.warnings.length ? `\nWarnings:\n${codeMap.warnings.map((w) => `- ${w}`).join("\n")}` : "";
  return [
    `Repo: ${codeMap.repoName}`,
    `Commit: ${codeMap.commit}`,
    `Files mapped: ${codeMap.files.length}`,
    `Symbols mapped: ${codeMap.symbols.length}`,
    warnings,
    "\nFile/symbol map:",
    topFiles
  ].join("\n");
}

export async function collectEvidenceBundle(
  repoRoot: string,
  paths: string[],
  fallbackPaths: string[] = []
): Promise<string> {
  const unique = [...new Set([...paths, ...fallbackPaths])].filter(shouldIncludePath).slice(0, 16);
  const chunks: string[] = [];
  for (const path of unique) {
    const abs = join(repoRoot, path);
    const file = Bun.file(abs);
    if (!(await file.exists()) || file.size > MAX_FILE_BYTES) continue;
    const language = extensionLanguage(path);
    const text = truncateText(await file.text(), 18_000);
    chunks.push(`### ${path}\n\n\`\`\`${language === "unknown" ? "" : language}\n${text}\n\`\`\``);
  }
  return chunks.join("\n\n");
}

async function summarizeFile(repoRoot: string, path: string): Promise<CodeFileSummary | undefined> {
  const abs = join(repoRoot, path);
  const file = Bun.file(abs);
  if (!(await file.exists()) || file.size > MAX_FILE_BYTES) return undefined;

  let text: string;
  try {
    text = await file.text();
  } catch {
    return undefined;
  }

  const language = extensionLanguage(path);
  const lines = text.split(/\r?\n/);
  return {
    path,
    language,
    bytes: file.size,
    lines: lines.length,
    imports: extractImports(lines),
    symbols: extractSymbols(path, language, lines)
  };
}

async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  const gitFiles = await runCommand(["git", "ls-files"], repoRoot, true);
  if (gitFiles.trim()) {
    return gitFiles.split(/\r?\n/).filter(Boolean);
  }

  const rgFiles = await runCommand(["rg", "--files"], repoRoot, true);
  if (rgFiles.trim()) {
    return rgFiles.split(/\r?\n/).filter(Boolean);
  }

  return walkFiles(repoRoot);
}

async function runCommand(args: string[], cwd: string, allowFailure: boolean): Promise<string> {
  let proc: {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
  };
  try {
    proc = Bun.spawn(args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe"
    }) as typeof proc;
  } catch (error) {
    if (allowFailure) return "";
    throw error;
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);
  if (code !== 0 && !allowFailure) {
    throw new Error(`${args.join(" ")} failed: ${stderr.trim() || stdout.trim()}`);
  }
  return stdout;
}

async function walkFiles(root: string, directory = "", files: string[] = []): Promise<string[]> {
  const absoluteDirectory = join(root, directory);
  let entries: Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const relativePath = directory ? `${directory}/${entry.name}` : entry.name;
    if (!shouldIncludePath(relativePath)) continue;
    if (entry.isDirectory()) {
      await walkFiles(root, relativePath, files);
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function shouldIncludePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (parts.some((part) => EXCLUDED_SEGMENTS.has(part))) return false;
  const lower = normalized.toLowerCase();
  for (const ext of BINARY_EXTENSIONS) {
    if (lower.endsWith(ext)) return false;
  }
  return true;
}

function extractImports(lines: string[]): string[] {
  const imports: string[] = [];
  for (const line of lines.slice(0, 300)) {
    const trimmed = line.trim();
    if (/^(import|from|require\(|use |mod |package |#include|using )/.test(trimmed)) {
      imports.push(trimmed.slice(0, 160));
    }
    if (imports.length >= 20) break;
  }
  return imports;
}

function extractSymbols(path: string, language: string, lines: string[]): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const push = (line: number, kind: string, name: string) => {
    if (name && symbols.length < 80) symbols.push({ path, line, kind, name });
  };

  lines.forEach((line, index) => {
    const n = index + 1;
    const trimmed = line.trim();
    let match: RegExpMatchArray | null = null;

    if (["typescript", "javascript"].includes(language)) {
      match =
        trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/) ||
        trimmed.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/) ||
        trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
      if (match?.[1]) push(n, "symbol", match[1]);
    } else if (language === "python") {
      match = trimmed.match(/^(def|class)\s+([A-Za-z_]\w*)/);
      if (match?.[1] && match[2]) push(n, match[1], match[2]);
    } else if (language === "go") {
      match = trimmed.match(/^func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)/) || trimmed.match(/^type\s+([A-Za-z_]\w*)/);
      if (match?.[1]) push(n, "symbol", match[1]);
    } else if (language === "rust") {
      match = trimmed.match(/^(?:pub\s+)?(?:async\s+)?(fn|struct|enum|trait|impl)\s+([A-Za-z_]\w*)?/);
      if (match?.[1]) push(n, match[1], match[2] ?? "impl");
    } else if (["c", "cpp"].includes(language)) {
      match = trimmed.match(/^[A-Za-z_][\w\s*]+?\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?$/);
      if (match?.[1] && !["if", "for", "while", "switch"].includes(match[1])) push(n, "function", match[1]);
    }
  });

  return symbols;
}
