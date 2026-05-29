import type { WelcomeTemplateId } from "@/lib/onboarding/welcome-templates";

export interface RoleMapping {
  enerfloRoles: string[];
  terrosRoles: string[];
  welcomeTemplate: WelcomeTemplateId;
}

const DEFAULT_MAPPING: RoleMapping = {
  enerfloRoles: ["Self Gen & Closer"],
  terrosRoles: ["Self Gen & Closer"],
  welcomeTemplate: "sales_rep",
};

function isApptSetter(roleLabel: string): boolean {
  return /appt\s*setter/i.test(roleLabel.trim());
}

function resolveEnerfloRoles(roleLabel: string): string[] {
  const label = roleLabel.trim();
  if (!label) return DEFAULT_MAPPING.enerfloRoles;

  if (/appt\s*setter/i.test(label) || /\bsetter\b/i.test(label)) {
    return ["Setter"];
  }
  if (/sales\s*rep\s*manager/i.test(label)) {
    return ["Sales Rep Manager"];
  }
  if (/divisional|regional/i.test(label)) {
    return ["Sales Rep Manager"];
  }
  if (/\bmanager\b/i.test(label)) {
    return ["Sales Rep Manager"];
  }
  if (/sales\s*rep/i.test(label)) {
    return ["Sales Rep"];
  }

  return DEFAULT_MAPPING.enerfloRoles;
}

function resolveTerrosRoles(roleLabel: string): string[] {
  if (isApptSetter(roleLabel)) return ["Setter"];
  return DEFAULT_MAPPING.terrosRoles;
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
