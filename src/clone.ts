import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathExists, repoNameFromTarget, sanitizeName } from "./utils";

export interface PreparedRepo {
  repoRoot: string;
  repoName: string;
  commit: string;
  cloned: boolean;
  cleanup: () => Promise<void>;
}

export async function prepareRepo(target: string, keepClone: boolean): Promise<PreparedRepo> {
  if (isRemoteGitTarget(target)) {
    return cloneRemote(target, keepClone);
  }

  const repoRoot = resolve(target);
  if (!(await pathExists(repoRoot))) {
    throw new Error(`Target path does not exist: ${repoRoot}`);
  }
  const repoName = sanitizeName(basename(repoRoot));
  const commit = await gitCommit(repoRoot);
  return {
    repoRoot,
    repoName,
    commit,
    cloned: false,
    cleanup: async () => {}
  };
}

async function cloneRemote(target: string, keepClone: boolean): Promise<PreparedRepo> {
  const parent = await mkdtemp(join(tmpdir(), "tib-"));
  const repoName = repoNameFromTarget(target);
  const repoRoot = join(parent, repoName);
  await runGit(["clone", "--depth", "1", target, repoRoot]);
  const commit = await gitCommit(repoRoot);

  return {
    repoRoot,
    repoName,
    commit,
    cloned: true,
    cleanup: async () => {
      if (!keepClone) {
        await rm(parent, { recursive: true, force: true });
      }
    }
  };
}

async function gitCommit(cwd: string): Promise<string> {
  const result = await runGit(["rev-parse", "HEAD"], cwd, true);
  return result.trim() || "unknown";
}

async function runGit(args: string[], cwd?: string, allowFailure = false): Promise<string> {
  const options = {
    stdout: "pipe",
    stderr: "pipe"
  } as const;
  const proc = cwd ? Bun.spawn(["git", ...args], { ...options, cwd }) : Bun.spawn(["git", ...args], options);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);
  if (code !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr.trim() || stdout.trim()}`);
  }
  return stdout;
}

function isRemoteGitTarget(target: string): boolean {
  return /^https?:\/\/.+\.git$/.test(target) || /^https?:\/\/github\.com\//.test(target) || /^git@/.test(target);
}
