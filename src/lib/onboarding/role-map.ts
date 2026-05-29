import type { WelcomeTemplateId } from "@/lib/onboarding/welcome-templates";

export interface RoleMapping {
  enerfloRoles: string[];
  terrosRoles: string[];
  welcomeTemplate: WelcomeTemplateId;
}

/** Enerflo POST /api/v1/users rejects custom labels like "Self Gen & Closer". */
const DEFAULT_ENERFLO_ROLES = ["Sales Rep"];
const DEFAULT_TERROS_ROLES = ["Self Gen & Closer"];

const DEFAULT_MAPPING: RoleMapping = {
  enerfloRoles: DEFAULT_ENERFLO_ROLES,
  terrosRoles: DEFAULT_TERROS_ROLES,
  welcomeTemplate: "sales_rep",
};

function isApptSetter(roleLabel: string): boolean {
  return /appt\s*setter/i.test(roleLabel.trim());
}

function resolveEnerfloRoles(roleLabel: string): string[] {
  const label = roleLabel.trim();
  if (!label) return DEFAULT_ENERFLO_ROLES;

  if (/appt\s*setter/i.test(label) || /\bsetter\b/i.test(label)) {
    return ["Setter"];
  }
  if (/sales\s*rep\s*manager/i.test(label)) {
    return ["Manager"];
  }
  if (/divisional|regional/i.test(label)) {
    return ["Manager"];
  }
  if (/\bmanager\b/i.test(label)) {
    return ["Manager"];
  }
  if (/sales\s*rep/i.test(label)) {
    return ["Sales Rep"];
  }

  return DEFAULT_ENERFLO_ROLES;
}

function resolveTerrosRoles(roleLabel: string): string[] {
  if (isApptSetter(roleLabel)) return ["Setter"];
  return DEFAULT_TERROS_ROLES;
}

function resolveWelcomeTemplate(roleLabel: string): WelcomeTemplateId {
  if (isApptSetter(roleLabel)) return "appt_setter";
  return "sales_rep";
}

export function resolveRoleMapping(
  roleLabel: string | null | undefined,
  envJson?: string | null,
): RoleMapping {
  const label = (roleLabel ?? "").trim();

  if (envJson?.trim()) {
    try {
      const parsed = JSON.parse(envJson) as Record<string, Partial<RoleMapping>>;
      if (label && parsed[label]) return { ...DEFAULT_MAPPING, ...parsed[label] };
      for (const [k, v] of Object.entries(parsed)) {
        if (label.toLowerCase().includes(k.toLowerCase())) return { ...DEFAULT_MAPPING, ...v };
      }
    } catch {
      /* fall through */
    }
  }

  return {
    enerfloRoles: resolveEnerfloRoles(label),
    terrosRoles: resolveTerrosRoles(label),
    welcomeTemplate: resolveWelcomeTemplate(label),
  };
}
