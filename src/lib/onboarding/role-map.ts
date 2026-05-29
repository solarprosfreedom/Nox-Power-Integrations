import type { WelcomeTemplateId } from "@/lib/onboarding/welcome-templates";

export interface RoleMapping {
  enerfloRoles: string[];
  welcomeTemplate: WelcomeTemplateId;
  terrosRole?: string;
}

const DEFAULT_MAPPING: RoleMapping = {
  enerfloRoles: ["Sales Rep"],
  welcomeTemplate: "sales_rep",
};

const KEYWORD_MAP: { match: RegExp; mapping: RoleMapping }[] = [
  { match: /setter|appointment/i, mapping: { enerfloRoles: ["Setter"], welcomeTemplate: "appt_setter" } },
  { match: /closer|sales|rep/i, mapping: { enerfloRoles: ["Sales Rep"], welcomeTemplate: "sales_rep" } },
  { match: /manager/i, mapping: { enerfloRoles: ["Manager"], welcomeTemplate: "sales_rep" } },
];

export function resolveRoleMapping(
  roleLabel: string | null | undefined,
  envJson?: string | null,
): RoleMapping {
  if (envJson?.trim()) {
    try {
      const parsed = JSON.parse(envJson) as Record<string, RoleMapping>;
      const key = (roleLabel ?? "").trim();
      if (key && parsed[key]) return parsed[key];
      for (const [k, v] of Object.entries(parsed)) {
        if (key.toLowerCase().includes(k.toLowerCase())) return v;
      }
    } catch {
      /* fall through */
    }
  }

  const label = (roleLabel ?? "").trim();
  for (const { match, mapping } of KEYWORD_MAP) {
    if (match.test(label)) return mapping;
  }
  return DEFAULT_MAPPING;
}
