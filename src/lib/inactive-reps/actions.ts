import { env } from "@/lib/env";
import type { InactiveRepAction, PlatformAccountSnapshot } from "@/lib/inactive-reps/types";
import { getGraphAccessToken, GRAPH_BASE } from "@/lib/microsoft/graph-auth";
import { listFromPayload, asBoolean } from "@/lib/inactive-reps/sources";
import { postTerros } from "@/lib/sync/terros-api";

export interface PendingExecution {
  action: InactiveRepAction;
  account: PlatformAccountSnapshot;
}

export interface ExecutionResult {
  status: "success" | "skipped" | "blocked" | "failed";
  error?: string;
  metadata: Record<string, unknown>;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      await work(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

async function responseDetail(res: Response): Promise<string> {
  const text = await res.text();
  return text.slice(0, 300) || res.statusText;
}

async function fetchEnerfloUsers(): Promise<Record<string, unknown>[]> {
  const base = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const key = env.enerfloV1ApiKey?.trim();
  if (!key) throw new Error("ENERFLO_V1_API_KEY is not configured");
  const res = await fetch(`${base}/api/v3/users`, {
    headers: { "api-key": key, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Enerflo verification failed (${res.status}): ${text.slice(0, 300)}`);
  return listFromPayload(JSON.parse(text), ["results", "users", "data.users", "data"]);
}

export async function deactivateEnerfloAccounts(
  executions: PendingExecution[],
): Promise<Map<string, ExecutionResult>> {
  const results = new Map<string, ExecutionResult>();
  const base = (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
  const key = env.enerfloV1ApiKey?.trim();
  if (!key) throw new Error("ENERFLO_V1_API_KEY is not configured");
  await mapWithConcurrency(executions, 4, async execution => {
    try {
      const res = await fetch(`${base}/api/v3/users`, {
        method: "PUT",
        headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id: Number(execution.account.id), active: false }),
      });
      if (!res.ok) {
        results.set(execution.action.id, {
          status: "failed",
          error: `Enerflo deactivate failed (${res.status}): ${await responseDetail(res)}`,
          metadata: {},
        });
      }
    } catch (error) {
      results.set(execution.action.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        metadata: {},
      });
    }
  });

  let live: Record<string, unknown>[];
  try {
    live = await fetchEnerfloUsers();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const execution of executions) {
      if (!results.has(execution.action.id)) {
        results.set(execution.action.id, { status: "failed", error: message, metadata: {} });
      }
    }
    return results;
  }
  const byId = new Map(live.map(user => [String(user.id ?? user.userId ?? ""), user]));
  for (const execution of executions) {
    if (results.has(execution.action.id)) continue;
    const user = byId.get(execution.account.id);
    if (!user) {
      results.set(execution.action.id, {
        status: "failed",
        error: "Enerflo user was not found during read-back verification",
        metadata: {},
      });
      continue;
    }
    const active = asBoolean(user.active ?? user.is_active ?? user.status);
    results.set(execution.action.id, active
      ? { status: "failed", error: "Enerflo user is still active after PUT", metadata: {} }
      : { status: "success", metadata: { verifiedActive: false } });
  }
  return results;
}

async function fetchTerrosUsers(): Promise<Record<string, unknown>[]> {
  const base = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const key = env.terrosApiKey?.trim();
  if (!key) throw new Error("TERROS_API_KEY is not configured");
  const res = await postTerros(base, key, "/user/list", {});
  if (!res.ok) throw new Error(`Terros verification failed (${res.status}): ${res.text.slice(0, 300)}`);
  return listFromPayload(JSON.parse(res.text), ["users", "data", "results"]);
}

export async function deactivateTerrosAccounts(
  executions: PendingExecution[],
): Promise<Map<string, ExecutionResult>> {
  const results = new Map<string, ExecutionResult>();
  const base = (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
  const key = env.terrosApiKey?.trim();
  if (!key) throw new Error("TERROS_API_KEY is not configured");
  for (const execution of executions) {
    try {
      const res = await postTerros(base, key, "/user/remove", {
        userId: execution.account.id,
        archive: true,
      });
      if (!res.ok) {
        results.set(execution.action.id, {
          status: "failed",
          error: `Terros archive failed (${res.status}): ${res.text.slice(0, 300)}`,
          metadata: {},
        });
      }
    } catch (error) {
      results.set(execution.action.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        metadata: {},
      });
    }
  }

  let live: Record<string, unknown>[];
  try {
    live = await fetchTerrosUsers();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const execution of executions) {
      if (!results.has(execution.action.id)) {
        results.set(execution.action.id, { status: "failed", error: message, metadata: {} });
      }
    }
    return results;
  }
  const byId = new Map(live.map(user => [String(user.userId ?? user.id ?? ""), user]));
  for (const execution of executions) {
    if (results.has(execution.action.id)) continue;
    const user = byId.get(execution.account.id);
    if (!user || asBoolean(user.isDeleted)) {
      results.set(execution.action.id, { status: "success", metadata: { verifiedArchived: true } });
    } else {
      results.set(execution.action.id, {
        status: "failed",
        error: "Terros user is still active after archive request",
        metadata: {},
      });
    }
  }
  return results;
}

interface GraphLicenseState {
  skuId?: string;
  assignedByGroup?: string | null;
  state?: string;
}

interface GraphUserState {
  id: string;
  accountEnabled: boolean;
  assignedLicenses: Array<{ skuId?: string }>;
  licenseAssignmentStates: GraphLicenseState[];
}

async function graphUserState(userId: string): Promise<GraphUserState | null> {
  const token = await getGraphAccessToken();
  const select = "id,accountEnabled,assignedLicenses,licenseAssignmentStates";
  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(userId)}?$select=${encodeURIComponent(select)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`Microsoft user read failed (${res.status}): ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as Partial<GraphUserState>;
  return {
    id: String(data.id ?? userId),
    accountEnabled: data.accountEnabled === true,
    assignedLicenses: Array.isArray(data.assignedLicenses) ? data.assignedLicenses : [],
    licenseAssignmentStates: Array.isArray(data.licenseAssignmentStates) ? data.licenseAssignmentStates : [],
  };
}

async function pollMicrosoftDisabled(userId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 1_500));
    const state = await graphUserState(userId);
    if (!state || !state.accountEnabled) return true;
  }
  return false;
}

async function pollMicrosoftLicenses(userId: string): Promise<GraphUserState | null> {
  let state: GraphUserState | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 1_500));
    state = await graphUserState(userId);
    if (!state || state.assignedLicenses.length === 0) return state;
  }
  return state;
}

export async function deactivateMicrosoftAccount(
  execution: PendingExecution,
): Promise<ExecutionResult> {
  try {
    const before = await graphUserState(execution.account.id);
    if (!before) return { status: "skipped", metadata: { reason: "user_not_found" } };
    const alreadyDisabled = !before.accountEnabled;
    const assignedSkuIds = new Set(
      before.assignedLicenses.map(license => String(license.skuId ?? "").toLowerCase()).filter(Boolean),
    );
    const directSkuIds = new Set(
      before.licenseAssignmentStates
        .filter(state => !state.assignedByGroup && state.skuId)
        .map(state => String(state.skuId).toLowerCase()),
    );
    if (assignedSkuIds.size && !before.licenseAssignmentStates.length) {
      return {
        status: "blocked",
        error: "Microsoft license assignment origin is unavailable; account was not disabled",
        metadata: { assignedLicenseCount: assignedSkuIds.size },
      };
    }
    if (directSkuIds.size) {
      const token = await getGraphAccessToken();
      const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(execution.account.id)}/assignLicense`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ addLicenses: [], removeLicenses: [...directSkuIds] }),
      });
      if (!res.ok) {
        return {
          status: "failed",
          error: `Microsoft direct-license removal failed (${res.status}): ${await responseDetail(res)}`,
          metadata: { directLicenseCount: directSkuIds.size },
        };
      }
    }
    const afterLicense = await pollMicrosoftLicenses(execution.account.id);
    const remaining = afterLicense?.assignedLicenses ?? [];
    if (remaining.length) {
      return {
        status: "blocked",
        error: "Microsoft licenses remain after direct-license removal (likely group-based)",
        metadata: { directLicensesRemoved: directSkuIds.size, licensesRemaining: remaining.length },
      };
    }

    if (alreadyDisabled) {
      return {
        status: "success",
        metadata: { alreadyDisabled: true, directLicensesRemoved: directSkuIds.size, licensesRemaining: 0 },
      };
    }

    const token = await getGraphAccessToken();
    const disable = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(execution.account.id)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountEnabled: false }),
    });
    if (!disable.ok) {
      return {
        status: "failed",
        error: `Microsoft disable failed (${disable.status}): ${await responseDetail(disable)}`,
        metadata: { directLicensesRemoved: directSkuIds.size },
      };
    }
    if (!(await pollMicrosoftDisabled(execution.account.id))) {
      return {
        status: "failed",
        error: "Microsoft account still enabled after PATCH verification polling",
        metadata: { directLicensesRemoved: directSkuIds.size },
      };
    }
    return {
      status: "success",
      metadata: { directLicensesRemoved: directSkuIds.size, licensesRemaining: 0, verifiedDisabled: true },
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      metadata: {},
    };
  }
}
