import type { WelcomeTemplateId } from "@/lib/onboarding/welcome-templates";
import type { OnboardingJob, SequifiUserRecord } from "@/lib/onboarding/types";

export interface RoleMapping {
  enerfloRoles: string[];
  terrosRoles: string[];
  welcomeTemplate: WelcomeTemplateId;
}

export interface SequifiPositionContext {
  positionName: string;
  subPositionName: string;
}

/** Enerflo POST /api/v1/users rejects custom labels like "Self Gen & Closer". */
const DEFAULT_ENERFLO_ROLES = ["Setter", "Sales Rep"];
const DEFAULT_TERROS_ROLES = ["Self Gen & Closer"];

const DEFAULT_MAPPING: RoleMapping = {
  enerfloRoles: DEFAULT_ENERFLO_ROLES,
  terrosRoles: DEFAULT_TERROS_ROLES,
  welcomeTemplate: "sales_rep",
};

function trim(s: string | null | undefined): string {
  return (s ?? "").trim();
}

/** "Setter" and "Appt Setter" are treated as the same category. */
export function isApptSetterName(name: string): boolean {
  return /^(appt\s*setter|setter)$/i.test(name.trim());
}

function isCloserName(name: string): boolean {
  return /^closer$/i.test(name.trim());
}

function mappingForSubPosition(subPositionName: string): RoleMapping | null {
  const sub = subPositionName.trim();
  if (!sub) return null;

  if (/^appt\s*setter$/i.test(sub)) {
    return {
      enerfloRoles: ["Setter", "Sales Rep"],
      terrosRoles: ["Self Gen & Closer"],
      welcomeTemplate: "appt_setter",
    };
  }
  if (/^sales\s*rep$/i.test(sub)) {
    return {
      enerfloRoles: ["Setter", "Sales Rep"],
      terrosRoles: ["Closer"],
      welcomeTemplate: "sales_rep",
    };
  }
  if (/^manager$/i.test(sub)) {
    return {
      enerfloRoles: ["Sales Rep Manager"],
      terrosRoles: ["Self Gen & Closer"],
      welcomeTemplate: "sales_rep",
    };
  }

  return null;
}

function mappingForPositionOnly(positionName: string): RoleMapping {
  const position = positionName.trim();
  if (!position) return DEFAULT_MAPPING;

  if (isApptSetterName(position)) {
    return {
      enerfloRoles: ["Setter"],
      terrosRoles: ["Setter"],
      welcomeTemplate: "appt_setter",
    };
  }
  if (isCloserName(position)) {
    return {
      enerfloRoles: ["Setter", "Sales Rep"],
      terrosRoles: ["Closer"],
      welcomeTemplate: "sales_rep",
    };
  }

  return DEFAULT_MAPPING;
}

function applyEnvRoleOverride(
  label: string,
  envJson: string | null | undefined,
): RoleMapping | null {
  if (!envJson?.trim() || !label.trim()) return null;

  try {
    const parsed = JSON.parse(envJson) as Record<string, Partial<RoleMapping>>;
    if (parsed[label]) return { ...DEFAULT_MAPPING, ...parsed[label] };
    for (const [k, v] of Object.entries(parsed)) {
      if (label.toLowerCase().includes(k.toLowerCase())) return { ...DEFAULT_MAPPING, ...v };
    }
  } catch {
    /* fall through */
  }

  return null;
}

export function sequifiPositionContextFromUser(
  user: Pick<SequifiUserRecord, "position_name" | "sub_position_name" | "raw">,
): SequifiPositionContext {
  return {
    positionName: trim(user.position_name) || trim(String(user.raw?.position_name ?? "")),
    subPositionName: trim(user.sub_position_name) || trim(String(user.raw?.sub_position_name ?? "")),
  };
}

export function sequifiPositionContextFromJob(
  job: Pick<OnboardingJob, "raw_sequifi_payload" | "role_label">,
): SequifiPositionContext {
  const raw = job.raw_sequifi_payload ?? {};
  return {
    positionName: trim(String(raw.position_name ?? "")) || trim(job.role_label),
    subPositionName: trim(String(raw.sub_position_name ?? "")),
  };
}

export function resolveRoleMappingFromSequifi(
  ctx: SequifiPositionContext,
  envJson?: string | null,
): RoleMapping {
  const subPositionName = trim(ctx.subPositionName);
  const positionName = trim(ctx.positionName);

  for (const label of [subPositionName, positionName, `${positionName} / ${subPositionName}`]) {
    const override = applyEnvRoleOverride(label, envJson);
    if (override) return override;
  }

  const bySub = mappingForSubPosition(subPositionName);
  if (bySub) return bySub;

  return mappingForPositionOnly(positionName);
}

/** @deprecated Prefer resolveRoleMappingFromSequifi with position + sub_position. */
export function resolveRoleMapping(
  roleLabel: string | null | undefined,
  envJson?: string | null,
): RoleMapping {
  return resolveRoleMappingFromSequifi(
    { positionName: trim(roleLabel), subPositionName: "" },
    envJson,
  );
}

export function enerfloRolesIncludeManager(enerfloRoles: string[]): boolean {
  return enerfloRoles.some(role => /manager/i.test(role));
}
