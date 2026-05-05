#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(await Bun.file(join(root, "package.json")).text()) as {
  files?: string[];
};
const gitignore = await readOptional(".gitignore");
const npmignore = await readOptional(".npmignore");

const forbiddenPackageEntries = [
  "private-benchmarks",
  "benchmark-results",
  "audit-results",
  "node_modules",
  ".tib",
  "dist"
];
const requiredIgnoreEntries = [
  "private-benchmarks/",
  "benchmark-results/",
  "audit-results/",
  "node_modules/",
  ".*.bun-build"
];
const publicScanRoots = [
  "README.md",
  "SECURITY.md",
  "LIMITATIONS.md",
  "CONTRIBUTING.md",
  "package.json",
  "tsconfig.json",
  ".github",
  "docs",
  "benchmarks",
  "examples",
  "prompts",
  "src",
  "tests",
  "scripts"
];
const secretPatterns = [
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /ANTHROPIC_API_KEY\s*=\s*["'][^"']{12,}["']/,
  /anthropic_api_key\s*=\s*["'](?!sk-ant-\.\.\.["'])[A-Za-z0-9_.-]{12,}["']/
];
const localPathPatterns = [/\/Users\/[A-Za-z0-9._-]+\//, /\/home\/[A-Za-z0-9._-]+\//];

const failures: string[] = [];

if (!Array.isArray(packageJson.files) || packageJson.files.length === 0) {
  failures.push("package.json must define an explicit files allowlist.");
} else {
  for (const entry of packageJson.files) {
    const normalized = entry.replace(/^\.?\//, "").replace(/\/$/, "");
    if (forbiddenPackageEntries.includes(normalized)) {
      failures.push(`package.json files includes forbidden entry: ${entry}`);
    }
  }
}

for (const entry of requiredIgnoreEntries) {
  if (!gitignore.includes(entry)) failures.push(`.gitignore is missing ${entry}`);
  if (!npmignore.includes(entry)) failures.push(`.npmignore is missing ${entry}`);
}

for (const filePath of await listFiles(publicScanRoots)) {
  const text = await Bun.file(filePath).text();
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) failures.push(`${relative(filePath)} matches secret pattern ${pattern}`);
  }
  for (const pattern of localPathPatterns) {
    if (pattern.test(text)) failures.push(`${relative(filePath)} contains a local absolute path`);
  }
}

if (failures.length) {
  console.error("Publication audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Publication audit passed.");

async function readOptional(path: string): Promise<string> {
  const file = Bun.file(join(root, path));
  return (await file.exists()) ? file.text() : "";
}

async function listFiles(entries: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = join(root, entry);
    const file = Bun.file(absolute);
    if (await file.exists()) {
      const stat = await file.stat();
      if (stat.isFile()) {
        files.push(absolute);
        continue;
      }
    }
    await walkDirectory(absolute, files);
  }
  return files.filter((path) => !path.includes("/node_modules/") && !path.includes("/dist/"));
}

async function walkDirectory(directory: string, files: string[]): Promise<void> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walkDirectory(child, files);
      } else if (entry.isFile()) {
        files.push(child);
      }
    }
  } catch {
    return;
  }
}

function relative(path: string): string {
  return path.startsWith(root) ? path.slice(root.length + 1) : path;
}
