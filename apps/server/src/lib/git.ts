import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

async function runGit(args: string[], cwd = process.cwd()) {
  const result = await execFileAsync("git", args, {
    cwd,
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

export async function getLocalGitSnapshot() {
  try {
    const topLevel = await runGit(["rev-parse", "--show-toplevel"]);
    const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], topLevel);
    const originUrl = await runGit(["remote", "get-url", "origin"], topLevel).catch(() => "");
    const porcelain = await runGit(["status", "--short", "--branch"], topLevel);
    const lastCommitSha = await runGit(["log", "-1", "--pretty=format:%H"], topLevel);
    const lastCommitSubject = await runGit(["log", "-1", "--pretty=format:%s"], topLevel);
    const lastCommitAt = await runGit(["log", "-1", "--pretty=format:%cI"], topLevel);
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
  } catch {
    return null;
  }
}

export function normalizeGitRepoUrl(raw?: string | null) {
  return normalizeRepoUrl(raw);
}
