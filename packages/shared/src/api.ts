export type HealthStatus = {
  ok: boolean;
  status?: number;
  error?: string;
  checkedAt: string;
};

export async function checkHealth(serverUrl: string): Promise<HealthStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/health`, {
      method: "GET"
    });
    return { ok: response.ok, status: response.status, checkedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return { ok: false, error: message, checkedAt };
  }
}
