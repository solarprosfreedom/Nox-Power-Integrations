export type WelcomeTemplateId = "sales_rep" | "appt_setter";

export interface WelcomeTemplateParams {
  username: string;
  password: string;
  /** M365 / Terros login (no +alias). */
  terrosEmail?: string;
  /** Sequifi installer tabs the rep was onboarded to. */
  installerTabs?: string[];
  /** Enerflo login emails — one per installer (+suffix@noxpwr.com). */
  enerfloEmails?: string[];
  /** When true, use Axia-specific subject and Planner tips. */
  onboardAxia?: boolean;
  /** Axia Enerflo email for Aurora/Enfin line (sales rep template). */
  auroraEmail?: string;
}

const AXIA_SUBJECT = "Welcome to Axia — your Nox Power email";
const GENERIC_SUBJECT = "Welcome — your Nox Power email";

const INTRO_TAIL =
  "We have created a new email for you. See below. You will be receiving emails shortly from different financiers and our internal systems, Enerflo and Terros.";

const INTRO_WITH_INSTALLERS = `You have been onboarded to the following installer(s): {{installerList}}.

${INTRO_TAIL}`;

const INTRO_GENERIC = `You have been onboarded. ${INTRO_TAIL}`;

const CREDENTIALS_BLOCK = `We have created a new company email for you. Please login through outlook.com.

Username: {{username}}

Password: {{password}}`;

const PLATFORM_LOGINS = `Your Terros login is {{terrosEmail}} (same as your company email above).

Your Enerflo login(s) — one per installer you were onboarded to:
{{enerfloEmails}}`;

const PLANNER_TIPS = `Here are a few other tips to get you started!

- Here is a link to an overview video for the Planner can be viewed here: https://www.youtube.com/watch?v=GWPFeKZBqSQ. This is to schedule site surveys, when you are ready.

  Exactus Planner Scheduling Guidelines: https://drive.google.com/file/d/1fqKC3p20PwbAm6itwBNy0hiSIvBEZDVD/view?pli=1

- Keep in mind your email to access Enfin and Aurora is going to be {{auroraEmail}}.

`;

const LOGIN_SUPPORT = `If you need further login assistance, you can try to use the resources below.

LOGIN SUPPORT:

- Aurora: support@aurorasolar.com
- EnFin: Text (717) 853-1183
- Recheck: Support@Recheck.co or https://recheck.co/contact/

Please let us know if you have any questions/issues.

Thanks,

Admin Team`;

function fill(template: string, p: WelcomeTemplateParams): string {
  const installerList = p.installerTabs?.length ? p.installerTabs.join(", ") : "";
  const enerfloList =
    p.enerfloEmails?.length ?
      p.enerfloEmails.map(e => `  - ${e}`).join("\n")
    : "";
  return template
    .replace(/\{\{username\}\}/g, p.username)
    .replace(/\{\{password\}\}/g, p.password)
    .replace(/\{\{terrosEmail\}\}/g, p.terrosEmail ?? p.username)
    .replace(/\{\{installerList\}\}/g, installerList)
    .replace(/\{\{enerfloEmails\}\}/g, enerfloList)
    .replace(/\{\{auroraEmail\}\}/g, p.auroraEmail ?? "");
}

function buildIntro(params: WelcomeTemplateParams): string {
  if (params.installerTabs?.length) {
    return INTRO_WITH_INSTALLERS;
  }
  return INTRO_GENERIC;
}

function buildSalesRepBody(onboardAxia: boolean, params: WelcomeTemplateParams): string {
  const intro = buildIntro(params);
  const parts = [`Hello,\n\n${intro}\n\n${CREDENTIALS_BLOCK}`];
  if (params.enerfloEmails?.length) {
    parts.push(`\n\n${fill(PLATFORM_LOGINS, params)}`);
  }
  if (onboardAxia) {
    parts.push(`\n\n${fill(PLANNER_TIPS, params)}`);
  }
  parts.push(`\n\n${LOGIN_SUPPORT}`);
  return fill(parts.join(""), params);
}

function buildApptSetterBody(params: WelcomeTemplateParams): string {
  const intro = buildIntro(params);
  const platformBlock =
    params.enerfloEmails?.length ?
      `\n\n${fill(PLATFORM_LOGINS, params)}`
    : "";
  return fill(
    `Hello,

${intro}

${CREDENTIALS_BLOCK}${platformBlock}

Please let us know if you have any questions/issues.

Thanks,

Admin Team`,
    params
  );
}

export function renderWelcomeTemplate(
  id: WelcomeTemplateId,
  params: WelcomeTemplateParams
): { subject: string; body: string } {
  const onboardAxia = params.onboardAxia === true;
  const body =
    id === "sales_rep"
      ? buildSalesRepBody(onboardAxia, params)
      : buildApptSetterBody(params);
  return {
    subject: onboardAxia ? AXIA_SUBJECT : GENERIC_SUBJECT,
    body,
  };
}

export const WELCOME_TEMPLATE_OPTIONS: { id: WelcomeTemplateId; label: string }[] = [
  { id: "sales_rep", label: "Sales Rep" },
  { id: "appt_setter", label: "Appt Setter" },
];
