import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type GitRunOptions = {
  cwd?: string;
  githubToken?: string;
};

function normalizeRepoUrl(raw?: string | null) {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }

  const sshMatch = trimmed.match(
    /^(?:ssh:\/\/)?git@github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/i
  );
  if (sshMatch?.groups?.owner && sshMatch.groups.repo) {
    return `https://github.com/${sshMatch.groups.owner}/${sshMatch.groups.repo}`;
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname === "github.com") {
      const parts = url.pathname
        .replace(/^\/+|\/+$/g, "")
        .replace(/\.git$/i, "")
        .split("/");
      if (parts.length >= 2 && parts[0] && parts[1]) {
        return `https://github.com/${parts[0]}/${parts[1]}`;
      }
    }

    return trimmed.replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/$/, "");
  }
}

function buildGitArgs(args: string[], githubToken?: string) {
  if (!githubToken) {
    return args;
  }

  const authHeader = Buffer.from(`x-access-token:${githubToken}`).toString("base64");
  return [
    "-c",
    `http.extraHeader=AUTHORIZATION: basic ${authHeader}`,
    "-c",
    "credential.helper=",
    "-c",
    "core.askPass=true",
    ...args
  ];
}

async function runGit(args: string[], options: GitRunOptions = {}) {
  const result = await execFileAsync("git", buildGitArgs(args, options.githubToken), {
    cwd: options.cwd,
    env: process.env
  });
  return result.stdout.trim();
}

function parseBranchStatus(summary: string) {
  let ahead = 0;
  let behind = 0;

  const aheadMatch = summary.match(/ahead (\d+)/);
  if (aheadMatch) {
    ahead = Number(aheadMatch[1]) || 0;
  }

  const behindMatch = summary.match(/behind (\d+)/);
  if (behindMatch) {
    behind = Number(behindMatch[1]) || 0;
  }

  return { ahead, behind };
}

function parsePorcelainStatus(output: string) {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const branchLine = lines[0]?.startsWith("## ") ? lines[0].slice(3) : "";
  const fileLines = branchLine ? lines.slice(1) : lines;

  let staged = 0;
  let modified = 0;
  let deleted = 0;
  let untracked = 0;

  for (const line of fileLines) {
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";

    if (x === "?" && y === "?") {
      untracked += 1;
      continue;
    }

    if (x !== " ") {
      staged += 1;
      if (x === "D") {
        deleted += 1;
      }
    }

    if (y !== " ") {
      modified += 1;
      if (y === "D") {
        deleted += 1;
      }
    }
  }

  return {
    branchLine,
    changedFiles: fileLines.length,
    staged,
    modified,
    deleted,
    untracked,
    clean: fileLines.length === 0
  };
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function removePathIfExists(targetPath: string) {
  if (await pathExists(targetPath)) {
    await fs.rm(targetPath, { recursive: true, force: true });
  }
}

async function getDefaultRemoteBranch(repoPath: string, githubToken?: string) {
  const refs = await runGit(
    ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"],
    {
      cwd: repoPath,
      githubToken
    }
  );
  const branches = refs
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "origin/HEAD");

  if (branches.includes("origin/main")) {
    return "main";
  }

  if (branches.includes("origin/master")) {
    return "master";
  }

  const first = branches[0];
  return first?.replace(/^origin\//, "") ?? "main";
}

async function ensureCleanCheckout(repoPath: string) {
  const porcelain = await runGit(["status", "--short"], { cwd: repoPath });
  if (porcelain.trim()) {
    throw new Error("server_checkout_dirty");
  }
}

export async function getGitSnapshot(repoPath: string) {
  const topLevel = await runGit(["rev-parse", "--show-toplevel"], { cwd: repoPath });
  const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: topLevel });
  const originUrl = await runGit(["remote", "get-url", "origin"], { cwd: topLevel }).catch(() => "");
  const porcelain = await runGit(["status", "--short", "--branch"], { cwd: topLevel });
  const lastCommitSha = await runGit(["log", "-1", "--pretty=format:%H"], { cwd: topLevel });
  const lastCommitSubject = await runGit(["log", "-1", "--pretty=format:%s"], { cwd: topLevel });
  const lastCommitAt = await runGit(["log", "-1", "--pretty=format:%cI"], { cwd: topLevel });
  const status = parsePorcelainStatus(porcelain);
  const sync = parseBranchStatus(status.branchLine);

  return {
    path: topLevel,
    branch,
    originUrl: normalizeRepoUrl(originUrl),
    clean: status.clean,
    changedFiles: status.changedFiles,
    stagedFiles: status.staged,
    modifiedFiles: status.modified,
    deletedFiles: status.deleted,
    untrackedFiles: status.untracked,
    ahead: sync.ahead,
    behind: sync.behind,
    lastCommit: {
      sha: lastCommitSha,
      shortSha: lastCommitSha.slice(0, 7),
      subject: lastCommitSubject,
      committedAt: lastCommitAt
    }
  };
}

export async function syncGitRepoToPath(input: {
  repoUrl: string;
  repoPath: string;
  githubToken?: string;
}) {
  const repoUrl = normalizeRepoUrl(input.repoUrl) ?? input.repoUrl;
  const gitDir = path.join(input.repoPath, ".git");

  await fs.mkdir(path.dirname(input.repoPath), { recursive: true });

  if (!(await pathExists(gitDir))) {
    if (await pathExists(input.repoPath)) {
      throw new Error("checkout_path_not_empty");
    }

    await runGit(["clone", repoUrl, input.repoPath], {
      githubToken: input.githubToken
    });
  } else {
    const currentOrigin = normalizeRepoUrl(
      await runGit(["remote", "get-url", "origin"], { cwd: input.repoPath }).catch(() => "")
    );

    if (currentOrigin && currentOrigin !== repoUrl) {
      await runGit(["remote", "set-url", "origin", repoUrl], { cwd: input.repoPath });
    }
  }

  await ensureCleanCheckout(input.repoPath);
  await runGit(["fetch", "origin"], {
    cwd: input.repoPath,
    githubToken: input.githubToken
  });

  const branch = await getDefaultRemoteBranch(input.repoPath, input.githubToken);
  const localBranchExists = await runGit(["rev-parse", "--verify", branch], {
    cwd: input.repoPath
  })
    .then(() => true)
    .catch(() => false);

  if (localBranchExists) {
    await runGit(["checkout", branch], { cwd: input.repoPath });
  } else {
    await runGit(["checkout", "-b", branch, "--track", `origin/${branch}`], {
      cwd: input.repoPath
    });
  }

  await runGit(["pull", "--ff-only", "origin", branch], {
    cwd: input.repoPath,
    githubToken: input.githubToken
  });

  return getGitSnapshot(input.repoPath);
}

export async function createGitWorktree(input: {
  repoPath: string;
  worktreePath: string;
  branch: string;
  baseRef?: string;
}) {
  await removePathIfExists(input.worktreePath);
  await fs.mkdir(path.dirname(input.worktreePath), { recursive: true });

  const addArgs = ["worktree", "add"];
  if (input.baseRef) {
    addArgs.push("-b", input.branch, input.worktreePath, input.baseRef);
  } else {
    addArgs.push(input.worktreePath, input.branch);
  }

  await runGit(addArgs, { cwd: input.repoPath });
  return getGitSnapshot(input.worktreePath);
}

export async function removeGitWorktree(input: {
  repoPath: string;
  worktreePath: string;
}) {
  if (!(await pathExists(input.worktreePath))) {
    return;
  }

  await runGit(["worktree", "remove", "--force", input.worktreePath], {
    cwd: input.repoPath
  });
}

export async function listDirectoryEntries(rootPath: string, relativePath = "") {
  const normalized = relativePath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const targetPath = path.resolve(rootPath, normalized);
  const relativeFromRoot = path.relative(rootPath, targetPath);
  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    throw new Error("path_outside_root");
  }

  const stats = await fs.stat(targetPath);
  if (!stats.isDirectory()) {
    throw new Error("not_a_directory");
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const visibleEntries = entries
    .filter((entry) => entry.name !== ".git")
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  return Promise.all(
    visibleEntries.map(async (entry) => {
      const entryPath = path.join(targetPath, entry.name);
      const entryStats = await fs.stat(entryPath);
      const entryRelativePath = path.relative(rootPath, entryPath).replace(/\\/g, "/");

      return {
        name: entry.name,
        path: entryRelativePath,
        type: entry.isDirectory() ? "directory" : "file",
        size: entry.isDirectory() ? null : entryStats.size
      };
    })
  );
}

export async function readTextFile(rootPath: string, relativePath: string, maxBytes = 64 * 1024) {
  const normalized = relativePath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const targetPath = path.resolve(rootPath, normalized);
  const relativeFromRoot = path.relative(rootPath, targetPath);
  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    throw new Error("path_outside_root");
  }

  const stats = await fs.stat(targetPath);
  if (!stats.isFile()) {
    throw new Error("not_a_file");
  }

  const bytesToRead = Math.min(stats.size, maxBytes);
  const buffer = await fs.readFile(targetPath);
  return {
    path: normalized,
    content: buffer.subarray(0, bytesToRead).toString("utf8"),
    truncated: stats.size > maxBytes,
    size: stats.size
  };
}

export async function writeTextFile(rootPath: string, relativePath: string, content: string) {
  const normalized = relativePath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const targetPath = path.resolve(rootPath, normalized);
  const relativeFromRoot = path.relative(rootPath, targetPath);
  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    throw new Error("path_outside_root");
  }

  const stats = await fs.stat(targetPath);
  if (!stats.isFile()) {
    throw new Error("not_a_file");
  }

  await fs.writeFile(targetPath, content, "utf8");
  const nextStats = await fs.stat(targetPath);

  return {
    path: normalized,
    size: nextStats.size
  };
}

export async function getGitDiffForFile(rootPath: string, relativePath: string) {
  const normalized = relativePath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const targetPath = path.resolve(rootPath, normalized);
  const relativeFromRoot = path.relative(rootPath, targetPath);
  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    throw new Error("path_outside_root");
  }

  const stats = await fs.stat(targetPath);
  if (!stats.isFile()) {
    throw new Error("not_a_file");
  }

  const diff = await runGit(["diff", "--no-color", "--unified=3", "--", normalized], {
    cwd: rootPath
  }).catch(() => "");

  return {
    path: normalized,
    content: diff,
    hasChanges: diff.trim().length > 0
  };
}

export async function getLocalGitSnapshot() {
  try {
    const topLevel = await runGit(["rev-parse", "--show-toplevel"]);
    return await getGitSnapshot(topLevel);
  } catch {
    return null;
  }
}

export function normalizeGitRepoUrl(raw?: string | null) {
  return normalizeRepoUrl(raw);
}
