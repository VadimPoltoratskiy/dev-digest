/* api.ts — typed fetch client for the F1 Fastify engine (localhost:3001).
   All hooks build on `apiFetch`. Errors are normalized to ApiError so the
   error-UX taxonomy (toast/inline/full-screen) can branch on status. */

import type {
  AgentEvalBatchResult,
  AgentEvalCase,
  AgentEvalCompare,
  Brief,
  BriefTimeline,
  EvalDashboard,
  EvalDashboardAgentSummary,
  EvalRunRecord,
  Onboarding,
  PriorPrList,
  WhyTimeline,
} from "@devdigest/shared";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when one is actually sent — otherwise a
        // body-less POST/PUT (e.g. tour generate, refresh, reindex) trips
        // Fastify's "Body cannot be empty when content-type is application/json".
        ...(init?.body != null ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    // network failure / API down → full-screen error candidate
    throw new ApiError(
      `Cannot reach the DevDigest engine at ${API_BASE}. Is the API running?`,
      0,
      "network_error",
      e
    );
  }

  if (!res.ok) {
    let code: string | undefined;
    let message = `${res.status} ${res.statusText}`;
    let details: unknown;
    try {
      const body = await res.json();
      if (body?.error) {
        code = body.error.code;
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, code, details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

// ---- Onboarding Tour API functions ----

export function fetchOnboardingTour(
  repoId: string,
): Promise<Onboarding & { generatedAt: string }> {
  return api.get(`/repos/${repoId}/onboarding`);
}

export function generateOnboardingTour(
  repoId: string,
): Promise<Onboarding & { generatedAt: string; degraded?: boolean }> {
  // Bodyless POST — do NOT pass {} as that would set Content-Type: application/json
  // with an empty body, which Fastify rejects when no body schema is declared.
  return api.post(`/repos/${repoId}/onboarding`);
}

// ---- PR Brief API functions ----

export function fetchPrBrief(prId: string): Promise<Brief | null> {
  return api.get<Brief>(`/pulls/${prId}/brief`).catch((e: ApiError) =>
    e.status === 404 ? null : Promise.reject(e)
  );
}

export function generateBrief(prId: string, opts?: { force?: boolean }): Promise<Brief> {
  return api.post<Brief>(`/pulls/${prId}/brief`, opts);
}

export function fetchBriefHistory(prId: string): Promise<BriefTimeline> {
  return api.get<BriefTimeline>(`/pulls/${prId}/brief/history`);
}

// ---- git-why API functions ----

export function fetchWhyTimeline(prId: string, file: string, line: number, ref?: string): Promise<WhyTimeline> {
  const q = new URLSearchParams({ file, line: String(line) });
  if (ref) q.set('ref', ref);
  return api.get<WhyTimeline>(`/pulls/${prId}/why?${q.toString()}`);
}

// ---- Prior PRs API functions ----

export function fetchPriorPrs(prId: string, path: string): Promise<PriorPrList> {
  return apiFetch<PriorPrList>(
    `/pulls/${prId}/files/prior-prs?path=${encodeURIComponent(path)}`,
  );
}

// ---- Agent Eval API functions ----

/** Turn a finding into an agent eval case with the given kind (+ optional name). */
export function postFindingEvalCase(
  findingId: string,
  body: { kind: "must_find" | "must_not_flag"; name?: string },
): Promise<AgentEvalCase> {
  return api.post<AgentEvalCase>(`/findings/${findingId}/eval-case`, body);
}

/** List all eval cases for an agent (each includes latest_run if ever run). */
export function getAgentEvalCases(agentId: string): Promise<AgentEvalCase[]> {
  return api.get<AgentEvalCase[]>(`/agents/${agentId}/eval-cases`);
}

/** Delete an eval case for an agent. */
export function deleteAgentEvalCase(agentId: string, caseId: string): Promise<void> {
  return api.del<void>(`/agents/${agentId}/eval-cases/${caseId}`);
}

/**
 * Run all eval cases for an agent as a batch. This can take a while as it
 * calls reviewPullRequest sequentially for every case — no short timeout is
 * applied (same pattern as runAllEvalCases / generateOnboardingTour which also
 * use apiFetch with no AbortSignal).
 */
export function postAgentEvalRuns(agentId: string): Promise<AgentEvalBatchResult> {
  return api.post<AgentEvalBatchResult>(`/agents/${agentId}/eval-runs`);
}

/** List all persisted eval run records for an agent (client groups by ran_at). */
export function getAgentEvalRuns(agentId: string): Promise<EvalRunRecord[]> {
  return api.get<EvalRunRecord[]>(`/agents/${agentId}/eval-runs`);
}

/** Compare two batch runs by their ran_at timestamps (ISO strings). */
export function getAgentEvalRunsCompare(
  agentId: string,
  a: string,
  b: string,
): Promise<AgentEvalCompare> {
  return api.get<AgentEvalCompare>(
    `/agents/${agentId}/eval-runs/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
  );
}

/** Fetch the workspace-level eval dashboard (or filter by a specific agent). */
export function getEvalsDashboard(ownerId?: string): Promise<EvalDashboard> {
  return api.get<EvalDashboard>(
    `/evals/dashboard${ownerId ? `?owner_id=${ownerId}` : ""}`,
  );
}

/** Fetch per-agent eval summaries (one row per agent) for the dashboard's agent list. */
export function getEvalsDashboardAgents(): Promise<EvalDashboardAgentSummary[]> {
  return api.get<EvalDashboardAgentSummary[]>("/evals/dashboard/agents");
}
