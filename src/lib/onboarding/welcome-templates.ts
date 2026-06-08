export type WelcomeTemplateId = "sales_rep" | "appt_setter";

export interface WelcomeTemplateParams {
  username: string;
  password: string;
  /** Used in greeting — e.g. "Hello Jane," */
  firstName?: string;
  /** Sequifi installer tabs the rep was onboarded to. */
  installerTabs?: string[];
  /** When true, use Axia-specific subject and planner tips. */
  onboardAxia?: boolean;
}

const AXIA_SUBJECT = "Welcome to Axia — your Nox Power email";
const GENERIC_SUBJECT = "Welcome — your Nox Power email";

const INTRO_WITH_INSTALLERS = `You have been onboarded to the following installer(s): {{installerList}}.

Your company email is ready. Use it for Outlook, Enerflo, and Terros. You may also receive messages from financiers on this address.`;

const INTRO_GENERIC = `You have been onboarded.

Your company email is ready. Use it for Outlook, Enerflo, and Terros. You may also receive messages from financiers on this address.`;

const CREDENTIALS_BLOCK = `Sign in at outlook.com:

  Username: {{username}}
  Password: {{password}}`;

const PLANNER_TIPS = `Planner tips:
  • Overview video: https://www.youtube.com/watch?v=GWPFeKZBqSQ
  • Scheduling guidelines: https://drive.google.com/file/d/1fqKC3p20PwbAm6itwBNy0hiSIvBEZDVD/view?pli=1

For Enfin and Aurora, use the same email: {{username}}`;

const LOGIN_SUPPORT = `If you need login assistance:

  Aurora: support@aurorasolar.com
  EnFin: Text (717) 853-1183
  Recheck: Support@Recheck.co or https://recheck.co/contact/

Questions? Reply to this email.

Thanks,

Admin Team`;

const APPT_SETTER_CLOSING = `Questions? Reply to this email.

Thanks,

Admin Team`;

function fill(template: string, p: WelcomeTemplateParams): string {
  const installerList = p.installerTabs?.length ? p.installerTabs.join(", ") : "";
  const greeting = p.firstName?.trim() ? `Hello ${p.firstName.trim()},` : "Hello,";
  return template
    .replace(/\{\{greeting\}\}/g, greeting)
    .replace(/\{\{username\}\}/g, p.username)
    .replace(/\{\{password\}\}/g, p.password)
    .replace(/\{\{installerList\}\}/g, installerList);
}

function buildIntro(params: WelcomeTemplateParams): string {
  if (params.installerTabs?.length) {
    return INTRO_WITH_INSTALLERS;
  }
  return INTRO_GENERIC;
}

function buildSalesRepBody(onboardAxia: boolean, params: WelcomeTemplateParams): string {
  const parts = [`{{greeting}}\n\n${buildIntro(params)}\n\n${CREDENTIALS_BLOCK}`];
  if (onboardAxia) {
    parts.push(`\n\n${PLANNER_TIPS}`);
  }
  parts.push(`\n\n${LOGIN_SUPPORT}`);
  return fill(parts.join(""), params);
}

function buildApptSetterBody(params: WelcomeTemplateParams): string {
  return fill(
    `{{greeting}}

${buildIntro(params)}

${CREDENTIALS_BLOCK}

${APPT_SETTER_CLOSING}`,
    params,
  );
}

export function renderWelcomeTemplate(
  id: WelcomeTemplateId,
  params: WelcomeTemplateParams,
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
