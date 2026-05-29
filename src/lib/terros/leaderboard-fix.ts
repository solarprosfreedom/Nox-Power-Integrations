/** Shared types + CSV parsing for Terros leaderboard workflowHistory fixes. */

export const DEFAULT_SOURCE_USER_ID = "U.a19_7hSDbg";

/** Bundled export in repo root — used by Leaderboard Fix tab. */
export const DEFAULT_LEADERBOARD_CSV_FILENAME =
  "Jonas Lim Accounts - jonas-lim-accounts.script.csv.csv";

export type WorkflowHistoryEntry = {
  userId?: string;
  timestamp?: number;
  stageId?: string;
  actionId?: string;
  latlng?: { latitude: number; longitude: number };
};

export type LeaderboardFixAccount = {
  accountId: string;
  ownerId: string;
  workflowStageId: string;
  residentFirstName: string;
  residentLastName: string;
  line1: string;
  locality: string;
  workflowHistory: WorkflowHistoryEntry[];
  jonasEntryCount: number;
};

export type LeaderboardFixStageGroup = {
  stageId: string;
  stageLabel: string;
  accounts: LeaderboardFixAccount[];
};

/** Parse RFC4180-style CSV rows (handles quoted fields with commas). */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(field);
      field = "";
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      if (ch === "\r") i++;
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.length > 0)) rows.push(row);
  }

  return rows;
}

export function parseLeaderboardFixCsv(
  csvText: string,
  sourceUserId = DEFAULT_SOURCE_USER_ID,
): LeaderboardFixAccount[] {
  const rows = parseCsvRows(csvText.trim());
  if (rows.length < 2) return [];

  const header = rows[0]!;
  const idx = (name: string) => header.indexOf(name);

  const accounts: LeaderboardFixAccount[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i]!;
    const accountId = (cols[idx("accountId")] ?? "").trim();
    const ownerId = (cols[idx("ownerId")] ?? "").trim();
    if (!accountId || !ownerId || ownerId === sourceUserId) continue;

    let workflowHistory: WorkflowHistoryEntry[] = [];
    try {
      const snap = JSON.parse(cols[idx("snapshot")] ?? "{}") as {
        workflowHistory?: WorkflowHistoryEntry[];
      };
      workflowHistory = snap.workflowHistory ?? [];
    } catch {
      continue;
    }

    const jonasEntryCount = workflowHistory.filter((h) => h.userId === sourceUserId).length;
    if (jonasEntryCount === 0) continue;

    accounts.push({
      accountId,
      ownerId,
      workflowStageId: (cols[idx("workflowStageId")] ?? "").trim(),
      residentFirstName: (cols[idx("residentFirstName")] ?? "").trim(),
      residentLastName: (cols[idx("residentLastName")] ?? "").trim(),
      line1: (cols[idx("line1")] ?? "").trim(),
      locality: (cols[idx("locality")] ?? "").trim(),
      workflowHistory,
      jonasEntryCount,
    });
  }

  return accounts;
}

export function groupAccountsByStage(
  accounts: LeaderboardFixAccount[],
  stageLabels: Record<string, string>,
): LeaderboardFixStageGroup[] {
  const byStage = new Map<string, LeaderboardFixAccount[]>();

  for (const account of accounts) {
    const stageId = account.workflowStageId || "(no stage)";
    const list = byStage.get(stageId) ?? [];
    list.push(account);
    byStage.set(stageId, list);
  }

  const groups: LeaderboardFixStageGroup[] = [...byStage.entries()].map(([stageId, list]) => ({
    stageId,
    stageLabel: stageLabels[stageId] ?? (stageId === "(no stage)" ? "No stage" : stageId),
    accounts: list.sort((a, b) => {
      const nameA = `${a.residentLastName} ${a.residentFirstName}`.trim();
      const nameB = `${b.residentLastName} ${b.residentFirstName}`.trim();
      return nameA.localeCompare(nameB);
    }),
  }));

  // Closed first, then knock, then alphabetical by label
  const priority = (id: string) => {
    const label = stageLabels[id]?.toLowerCase() ?? "";
    if (label.includes("closed")) return 0;
    if (label.includes("knock")) return 1;
    return 2;
  };

  groups.sort((a, b) => {
    const pa = priority(a.stageId);
    const pb = priority(b.stageId);
    if (pa !== pb) return pa - pb;
    return a.stageLabel.localeCompare(b.stageLabel);
  });

  return groups;
}

export function rewriteWorkflowHistory(
  history: WorkflowHistoryEntry[],
  sourceUserId: string,
  targetOwnerId: string,
): WorkflowHistoryEntry[] {
  return history.map((entry) =>
    entry.userId === sourceUserId ? { ...entry, userId: targetOwnerId } : entry,
  );
}

export function historyNeedsLeaderboardFix(
  history: WorkflowHistoryEntry[],
  sourceUserId: string,
): boolean {
  return history.some((h) => h.userId === sourceUserId);
}

export function accountDisplayName(account: LeaderboardFixAccount): string {
  const name = `${account.residentFirstName} ${account.residentLastName}`.trim();
  if (name) return name;
  return account.line1 || account.accountId;
}
