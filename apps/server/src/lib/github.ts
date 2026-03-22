import { loadRuntimeConfig } from "./runtime-config.js";

const GITHUB_DEVICE_FLOW_SCOPE = "repo read:user";

type GitHubDeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

type GitHubDeviceTokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
};

type GitHubUserResponse = {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type GitHubRepoResponse = {
  full_name: string;
  html_url: string;
  name: string;
  private: boolean;
  owner: {
    login: string;
  };
};

type GitHubPullRequestResponse = {
  html_url: string;
  number: number;
  title: string;
  state: string;
};

function getConfiguredGitHubClientId() {
  const trimmed = loadRuntimeConfig()?.githubClientId?.trim();
  return trimmed ? trimmed : null;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function isGitHubAuthConfigured() {
  return Boolean(getConfiguredGitHubClientId());
}

export async function startGitHubDeviceFlow() {
  const clientId = getConfiguredGitHubClientId();
  if (!clientId) {
    throw new Error("github_not_configured");
  }

  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "HawkCode"
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: GITHUB_DEVICE_FLOW_SCOPE
    })
  });

  const data = await parseJsonResponse<GitHubDeviceCodeResponse & GitHubDeviceTokenResponse>(response);
  if (!response.ok || !data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error(data.error_description ?? data.error ?? "github_device_flow_start_failed");
  }

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval
  };
}

export async function pollGitHubDeviceFlow(deviceCode: string) {
  const clientId = getConfiguredGitHubClientId();
  if (!clientId) {
    throw new Error("github_not_configured");
  }

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "HawkCode"
    },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    })
  });

  const data = await parseJsonResponse<GitHubDeviceTokenResponse>(response);
  if (data.error === "authorization_pending" || data.error === "slow_down") {
    return {
      status: data.error,
      message: data.error_description ?? data.error,
      retryAfterSeconds: data.error === "slow_down" ? 5 : undefined
    } as const;
  }

  if (data.error) {
    return {
      status: "error",
      error: data.error,
      message: data.error_description ?? data.error
    } as const;
  }

  if (!response.ok || !data.access_token) {
    return {
      status: "error",
      error: "token_exchange_failed",
      message: "GitHub token exchange failed."
    } as const;
  }

  return {
    status: "connected",
    accessToken: data.access_token,
    tokenType: data.token_type ?? null,
    scope: data.scope ?? null
  } as const;
}

export async function fetchGitHubUser(accessToken: string) {
  const response = await fetch("https://api.github.com/user", {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "HawkCode"
    }
  });

  if (!response.ok) {
    throw new Error(response.status === 401 ? "github_token_invalid" : "github_user_fetch_failed");
  }

  const data = await parseJsonResponse<GitHubUserResponse>(response);
  return {
    githubUserId: String(data.id),
    login: data.login,
    name: data.name,
    email: data.email,
    avatarUrl: data.avatar_url
  };
}

export async function fetchGitHubRepo(accessToken: string, owner: string, repo: string) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "HawkCode"
    }
  });

  if (!response.ok) {
    throw new Error(response.status === 401 ? "github_token_invalid" : "github_repo_not_found");
  }

  const data = await parseJsonResponse<GitHubRepoResponse>(response);
  return {
    fullName: data.full_name,
    htmlUrl: data.html_url,
    name: data.name
  };
}

export async function listGitHubRepos(accessToken: string) {
  const response = await fetch(
    "https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member",
    {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "HawkCode"
      }
    }
  );

  if (!response.ok) {
    throw new Error(response.status === 401 ? "github_token_invalid" : "github_repo_list_failed");
  }

  const data = await parseJsonResponse<GitHubRepoResponse[]>(response);
  return data.map((repo) => ({
    name: repo.name,
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    private: repo.private,
    ownerLogin: repo.owner.login
  }));
}

export async function createGitHubPullRequest(input: {
  accessToken: string;
  owner: string;
  repo: string;
  title: string;
  body?: string;
  head: string;
  base: string;
}) {
  const response = await fetch(`https://api.github.com/repos/${input.owner}/${input.repo}/pulls`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.accessToken}`,
      "User-Agent": "HawkCode",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base
    })
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(
      response.status === 401
        ? "github_token_invalid"
        : errorBody?.message || "github_pull_request_create_failed"
    );
  }

  const data = await parseJsonResponse<GitHubPullRequestResponse>(response);
  return {
    url: data.html_url,
    number: data.number,
    title: data.title,
    state: data.state
  };
}
