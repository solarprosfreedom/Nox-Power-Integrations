import { env } from "@/lib/env";
import { enerfloRequest } from "@/lib/enerflo/client";

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_PUT_GAP_MS = 200;

/** Roles every active sales rep should have. */
export const REQUIRED_ROLES = ["Setter", "Sales Rep"] as const;

/**
 * Enerflo API aliases — the API returns these internal keys but the UI
 * displays the human label. Map internal key → canonical role name so we
 * don't add a duplicate under a different string.
 *   "agent"  → "Sales Rep"
 *   "setter" → "Setter"
 */
const ROLE_ALIASES: Record<string, string> = {
  agent:           "Sales Rep",
  setter:          "Setter",
  company:         "Company Admin",
  manager:         "Sales Rep Manager",
  regionalmanager: "Regional Manager",
};

/**
 * Role names the Enerflo PUT /api/v3/users endpoint actually accepts.
 * GET may return internal strings (e.g. "manager", "regionalmanager", "ops",
 * "solardesigns") that are rejected on PUT with 400 "Invalid role name".
 * Only roles in this set are included in the PUT body.
 */
const VALID_PUT_ROLES = new Set([
  "Sales Rep",
  "Setter",
  "Sales Rep Manager",
  "Regional Manager",
  "Company Admin",
  // "supercompany" and "company" are managed by Enerflo internally —
  // they are returned by GET but rejected on PUT, and are preserved
  // automatically regardless of what the roles array contains.
]);

export interface EnerfloUser {
  id: number;
  name: string;
  email: string;
  currentRoles: string[];
  status: string;
}

export interface EnsureRolesResult {
  userId: number;
  name: string;
  email: string;
  previousRoles: string[];
  newRoles: string[];
  action: "updated" | "would_update" | "skipped" | "error";
  skipReason?: string;
  error?: string;
}

export interface EnsureAllUserRolesResult {
  dryRun: boolean;
  scanned: number;
  updated: number;
  skipped: number;
  errors: string[];
  samples: EnsureRolesResult[];
}

function enerfloBase(): string {
  return (env.enerfloV1BaseUrl ?? "https://enerflo.io").replace(/\/$/, "");
}

function enerfloKey(): string {
  const key = env.enerfloV1ApiKey?.trim();
  if (!key) throw new Error("ENERFLO_V1_API_KEY is not configured");
  return key;
}

function extractUserList(parsed: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["results", "data", "users", "items"]) {
    const val = parsed[key];
    if (Array.isArray(val)) return val as Record<string, unknown>[];
  }
  return [];
}

/** Normalise a single role string — resolves API aliases to their display name. */
function normalizeRole(r: string): string {
  const trimmed = r.trim();
  return ROLE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

function parseRoles(user: Record<string, unknown>): string[] {
  const rolesVal = user.roles;
  if (Array.isArray(rolesVal)) return rolesVal.map(r => normalizeRole(String(r))).filter(Boolean);
  if (typeof rolesVal === "string" && rolesVal.trim())
    return rolesVal.split(",").map(r => normalizeRole(r)).filter(Boolean);
  const role = user.role;
  if (role && typeof role === "string") return [normalizeRole(role)];
  return [];
}

function parseName(user: Record<string, unknown>): string {
  const first = String(user.first_name ?? user.firstName ?? "").trim();
  const last = String(user.last_name ?? user.lastName ?? "").trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const name = String(user.name ?? "").trim();
  if (name) return name;
  return String(user.email ?? "").trim() || `User ${user.id}`;
}

function mergeRequiredRoles(current: string[]): { merged: string[]; changed: boolean } {
  // Only keep roles the PUT endpoint accepts — drop any internal-only strings.
  const validCurrent = current.filter(r => VALID_PUT_ROLES.has(r));
  const normalizedValid = validCurrent.map(r => r.toLowerCase());

  const toAdd: string[] = [];
  for (const req of REQUIRED_ROLES) {
    if (!normalizedValid.includes(req.toLowerCase())) {
      toAdd.push(req);
    }
  }
  if (!toAdd.length) return { merged: validCurrent, changed: false };
  return { merged: [...validCurrent, ...toAdd], changed: true };
}

async function fetchAllEnerfloUsers(): Promise<EnerfloUser[]> {
  const base = enerfloBase();
  const key = enerfloKey();
  const all: EnerfloUser[] = [];

  for (let page = 1; page <= 100; page++) {
    const res = await fetch(
      `${base}/api/v3/users?page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`,
      { headers: { "api-key": key, "Content-Type": "application/json" } },
    );
    if (!res.ok) {
      if (page === 1) throw new Error(`GET /api/v3/users failed (${res.status})`);
      break;
    }
    const parsed = (await res.json()) as Record<string, unknown>;
    const rows = extractUserList(parsed);
    if (!rows.length) break;

    for (const row of rows) {
      const id = Number(row.id ?? row.userId);
      if (!Number.isFinite(id) || id <= 0) continue;
      all.push({
        id,
        name: parseName(row),
        email: String(row.email ?? "").trim(),
        currentRoles: parseRoles(row),
        status: String(row.status ?? "active").toLowerCase(),
      });
    }

    if (rows.length < DEFAULT_PAGE_SIZE) break;
  }

  return all;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
}

/** Returns null on success, "not_found" on 404, or an error message string. */
async function updateUserRoles(userId: number, roles: string[]): Promise<null | "not_found" | string> {
  const log = await enerfloRequest({
    operation: "enerflo:ensure-user-roles:update",
    method: "PUT",
    path: "/api/v3/users",
    body: { id: userId, roles },
  });
  if (log.ok) return null;
  if (log.status === 404) return "not_found";
  return `PUT /api/v3/users id=${userId} failed (${log.status ?? "?"}): ${log.responsePreview}`;
}

/**
 * Ensure every active Enerflo user has both "Setter" and "Sales Rep" roles.
 * - Adds missing roles; never removes existing ones.
 * - No role-based exclusions — all users including admins are processed.
 * - Only skips inactive users (status = "inactive").
 * - dryRun=true shows what would change without writing.
 * - filterEmail: when set, only processes the single user with that email.
 */
export async function ensureAllUserRoles(options: {
  dryRun?: boolean;
  putGapMs?: number;
  filterEmail?: string;
  onProgress?: (done: number, total: number, userName: string) => void;
}): Promise<EnsureAllUserRolesResult> {
  const dryRun = options.dryRun ?? true;
  const putGapMs = options.putGapMs ?? DEFAULT_PUT_GAP_MS;
  const filterEmail = options.filterEmail?.trim().toLowerCase();

  const result: EnsureAllUserRolesResult = {
    dryRun,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    samples: [],
  };

  let users = await fetchAllEnerfloUsers();
  if (filterEmail) {
    users = users.filter(u => u.email.toLowerCase() === filterEmail);
    if (users.length === 0) {
      result.errors.push(`No Enerflo user found with email: ${filterEmail}`);
      return result;
    }
  }
  const total = users.length;

  for (let i = 0; i < users.length; i++) {
    const user = users[i]!;
    result.scanned++;
    options.onProgress?.(i + 1, total, user.name);

    // Skip inactive
    if (user.status === "inactive") {
      result.skipped++;
      result.samples.push({
        userId: user.id,
        name: user.name,
        email: user.email,
        previousRoles: user.currentRoles,
        newRoles: user.currentRoles,
        action: "skipped",
        skipReason: "inactive",
      });
      continue;
    }

    const { merged, changed } = mergeRequiredRoles(user.currentRoles);

    if (!changed) {
      result.skipped++;
      result.samples.push({
        userId: user.id,
        name: user.name,
        email: user.email,
        previousRoles: user.currentRoles,
        newRoles: merged,
        action: "skipped",
        skipReason: "already_has_required_roles",
      });
      continue;
    }

    if (dryRun) {
      result.updated++;
      result.samples.push({
        userId: user.id,
        name: user.name,
        email: user.email,
        previousRoles: user.currentRoles,
        newRoles: merged,
        action: "would_update",
      });
      continue;
    }

    try {
      const putResult = await updateUserRoles(user.id, merged);

      if (putResult === "not_found") {
        result.skipped++;
        result.samples.push({
          userId: user.id,
          name: user.name,
          email: user.email,
          previousRoles: user.currentRoles,
          newRoles: user.currentRoles,
          action: "skipped",
          skipReason: "not_found_in_this_account",
        });
        continue;
      }

      if (putResult !== null) {
        result.errors.push(putResult);
        result.samples.push({
          userId: user.id,
          name: user.name,
          email: user.email,
          previousRoles: user.currentRoles,
          newRoles: merged,
          action: "error",
          error: putResult,
        });
        continue;
      }

      result.updated++;
      result.samples.push({
        userId: user.id,
        name: user.name,
        email: user.email,
        previousRoles: user.currentRoles,
        newRoles: merged,
        action: "updated",
      });
      await sleep(putGapMs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(msg);
      result.samples.push({
        userId: user.id,
        name: user.name,
        email: user.email,
        previousRoles: user.currentRoles,
        newRoles: merged,
        action: "error",
        error: msg,
      });
    }
  }

  return result;
}
