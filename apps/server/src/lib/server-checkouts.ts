import path from "node:path";
import { loadRuntimeConfig, resolveConfigBaseDir } from "./runtime-config.js";

function slugifySegment(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "workspace";
}

function truncateSegment(value: string, maxLength = 48) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export function resolveServerCheckoutRoot() {
  const runtimeConfig = loadRuntimeConfig();
  return runtimeConfig?.serverCheckoutRoot ?? path.resolve(resolveConfigBaseDir(), ".hawkcode/checkouts");
}

export function resolveManagedCheckoutPath(input: {
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
}) {
  return path.join(
    resolveServerCheckoutRoot(),
    `${slugifySegment(input.workspaceName)}-${input.workspaceId}`,
    `${slugifySegment(input.projectName)}-${input.projectId}`
  );
}

export function resolveSessionWorktreePath(input: {
  workspaceId: string;
  workspaceName: string;
  sessionId: string;
  sessionTitle: string;
}) {
  return path.join(
    resolveServerCheckoutRoot(),
    `${slugifySegment(input.workspaceName)}-${input.workspaceId}`,
    "_sessions",
    `${truncateSegment(slugifySegment(input.sessionTitle) || "session")}-${input.sessionId}`
  );
}
