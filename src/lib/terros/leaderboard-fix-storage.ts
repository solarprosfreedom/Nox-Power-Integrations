/** Persist Leaderboard Fix progress in localStorage (survives page reload). */

export type PersistedRowStatus = "updated" | "skipped" | "failed";

export type PersistedRow = {
  status: PersistedRowStatus;
  message?: string;
  ownerId?: string;
  updatedAt: string;
};

type StoredFileState = {
  fileName: string;
  accounts: Record<string, PersistedRow>;
  lastLoadedAt: string;
};

const PREFIX = "leaderboard-fix-v1";
const LAST_FILE_KEY = `${PREFIX}:last-file`;

function fileKey(fileName: string): string {
  return `${PREFIX}:file:${fileName}`;
}

function readFileState(fileName: string): StoredFileState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(fileKey(fileName));
    if (!raw) return null;
    return JSON.parse(raw) as StoredFileState;
  } catch {
    return null;
  }
}

function writeFileState(state: StoredFileState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(fileKey(state.fileName), JSON.stringify(state));
}

export function getLastLoadedFileName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LAST_FILE_KEY);
}

export function setLastLoadedFileName(fileName: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LAST_FILE_KEY, fileName);
}

export function loadPersistedRows(fileName: string): Record<string, PersistedRow> {
  return readFileState(fileName)?.accounts ?? {};
}

export function persistRow(
  fileName: string,
  accountId: string,
  row: PersistedRow,
): void {
  const existing = readFileState(fileName) ?? {
    fileName,
    accounts: {},
    lastLoadedAt: new Date().toISOString(),
  };
  existing.accounts[accountId] = row;
  existing.lastLoadedAt = new Date().toISOString();
  writeFileState(existing);
}

export function clearPersistedProgress(fileName: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(fileKey(fileName));
}

export function isTerminalStatus(status: string): boolean {
  return status === "updated" || status === "skipped" || status === "failed";
}
