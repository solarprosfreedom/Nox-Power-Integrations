"use server";

import { readFile } from "fs/promises";
import path from "path";
import { env } from "@/lib/env";
import {
  DEFAULT_LEADERBOARD_CSV_FILENAME,
  DEFAULT_SOURCE_USER_ID,
  historyNeedsLeaderboardFix,
  rewriteWorkflowHistory,
  type WorkflowHistoryEntry,
} from "@/lib/terros/leaderboard-fix";

export type LeaderboardFixMeta = {
  sourceUserId: string;
  stageLabels: Record<string, string>;
  terrosConfigured: boolean;
};

export type LeaderboardFixResult = {
  ok: boolean;
  accountId: string;
  ownerId?: string;
  status: "updated" | "skipped" | "failed";
  reason?: string;
  workflowHistory?: WorkflowHistoryEntry[];
};

function terrosBase() {
  return (env.terrosApiBaseUrl ?? "https://api.terros.com").replace(/\/$/, "");
}

function terrosHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `ApiKey ${env.terrosApiKey ?? ""}`,
  };
}

function terrosSuccess(text: string): boolean {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (j.type === "error") return false;
  } catch {
    /* non-JSON 2xx */
  }
  return true;
}

export type LoadLeaderboardCsvResult =
  | { ok: true; fileName: string; csvText: string }
  | { ok: false; error: string };

export async function loadDefaultLeaderboardCsv(): Promise<LoadLeaderboardCsvResult> {
  const filePath = path.join(process.cwd(), DEFAULT_LEADERBOARD_CSV_FILENAME);
  try {
    const csvText = await readFile(filePath, "utf-8");
    return { ok: true, fileName: DEFAULT_LEADERBOARD_CSV_FILENAME, csvText };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `Could not read ${DEFAULT_LEADERBOARD_CSV_FILENAME} in project root (${msg})`,
    };
  }
}

export async function getLeaderboardFixMeta(): Promise<LeaderboardFixMeta> {
  const stageLabels: Record<string, string> = {};

  if (env.terrosWorkflowClosedStageId) {
    stageLabels[env.terrosWorkflowClosedStageId] = "Closed";
  }
  if (env.terrosWorkflowKnockStageId) {
    stageLabels[env.terrosWorkflowKnockStageId] = "Knock";
  }
  if (env.terrosWorkflowAppointmentStageId) {
    stageLabels[env.terrosWorkflowAppointmentStageId] = "Appointment";
  }
  if (env.terrosWorkflowStartStageId) {
    stageLabels[env.terrosWorkflowStartStageId] = "Prospect";
  }

  return {
    sourceUserId: DEFAULT_SOURCE_USER_ID,
    stageLabels,
    terrosConfigured: Boolean(env.terrosApiKey?.trim()),
  };
}

export async function fixLeaderboardAccount(accountId: string): Promise<LeaderboardFixResult> {
  const sourceUserId = DEFAULT_SOURCE_USER_ID;
  const key = env.terrosApiKey?.trim();
  if (!key) {
    return { ok: false, accountId, status: "failed", reason: "TERROS_API_KEY not configured" };
  }

  const base = terrosBase();
  const headers = terrosHeaders();

  let getRes: Response;
  try {
    getRes = await fetch(`${base}/account/get`, {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId }),
    });
  } catch (e) {
    return {
      ok: false,
      accountId,
      status: "failed",
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  const getText = await getRes.text();
  if (getRes.status === 404) {
    return { ok: false, accountId, status: "skipped", reason: "Account not found in Terros" };
  }
  if (!getRes.ok || !terrosSuccess(getText)) {
    return {
      ok: false,
      accountId,
      status: "failed",
      reason: `account/get failed (${getRes.status})`,
    };
  }

  let account: Record<string, unknown>;
  try {
    account = (JSON.parse(getText).account ?? {}) as Record<string, unknown>;
  } catch {
    return { ok: false, accountId, status: "failed", reason: "Invalid account/get response" };
  }

  const liveOwnerId = String(account.ownerId ?? "").trim();
  const liveStageId = String(account.workflowStageId ?? "").trim();
  const liveHistory = (account.workflowHistory ?? []) as WorkflowHistoryEntry[];

  if (!liveOwnerId || liveOwnerId === sourceUserId) {
    return {
      ok: false,
      accountId,
      status: "skipped",
      reason: "No valid owner assigned in Terros",
    };
  }

  if (!historyNeedsLeaderboardFix(liveHistory, sourceUserId)) {
    return {
      ok: true,
      accountId,
      ownerId: liveOwnerId,
      status: "skipped",
      reason: "Already fixed",
      workflowHistory: liveHistory,
    };
  }

  const newHistory = rewriteWorkflowHistory(liveHistory, sourceUserId, liveOwnerId);

  let updateRes: Response;
  try {
    updateRes = await fetch(`${base}/account/update`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        account: {
          accountId,
          id: accountId,
          ownerId: liveOwnerId,
          workflowStageId: liveStageId,
          workflowHistory: newHistory,
        },
      }),
    });
  } catch (e) {
    return {
      ok: false,
      accountId,
      ownerId: liveOwnerId,
      status: "failed",
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  const updateText = await updateRes.text();
  if (!updateRes.ok || !terrosSuccess(updateText)) {
    return {
      ok: false,
      accountId,
      ownerId: liveOwnerId,
      status: "failed",
      reason: `account/update failed (${updateRes.status})`,
    };
  }

  return {
    ok: true,
    accountId,
    ownerId: liveOwnerId,
    status: "updated",
    workflowHistory: newHistory,
  };
}
