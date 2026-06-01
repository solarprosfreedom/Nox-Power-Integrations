export type WelcomeTemplateId = "sales_rep" | "appt_setter";

export interface WelcomeTemplateParams {
  username: string;
  password: string;
  /** When true, use Axia-specific subject, intro, Planner tips, and Aurora/Enfin alias line. */
  onboardAxia?: boolean;
  /** Used only when onboardAxia is true (e.g. firstnamelastname+axia@noxpwr.com). */
  auroraEmail?: string;
}

const AXIA_SUBJECT = "Welcome to Axia — your Nox Power email";
const GENERIC_SUBJECT = "Welcome — your Nox Power email";

function fill(template: string, p: WelcomeTemplateParams): string {
  return template
    .replace(/\{\{username\}\}/g, p.username)
    .replace(/\{\{password\}\}/g, p.password)
    .replace(/\{\{auroraEmail\}\}/g, p.auroraEmail ?? "");
}

const INTRO_AXIA =
  "You have been onboarded with Axia. We have created a new email for you. See below. You will be receiving emails shortly from different financiers and our internal systems, Enerflo and Terros.";
const INTRO_GENERIC =
  "You have been onboarded. We have created a new email for you. See below. You will be receiving emails shortly from different financiers and our internal systems, Enerflo and Terros.";

const CREDENTIALS_BLOCK = `We have created a new company email for you. Please login through outlook.com.

Username: {{username}}

Password: {{password}}`;

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

function buildSalesRepBody(onboardAxia: boolean, params: WelcomeTemplateParams): string {
  const intro = onboardAxia ? INTRO_AXIA : INTRO_GENERIC;
  const parts = [`Hello,\n\n${intro}\n\n${CREDENTIALS_BLOCK}`];
  if (onboardAxia) {
    parts.push(`\n\n${fill(PLANNER_TIPS, params)}`);
  }
  parts.push(`\n\n${LOGIN_SUPPORT}`);
  return fill(parts.join(""), params);
}

function buildApptSetterBody(onboardAxia: boolean, params: WelcomeTemplateParams): string {
  const intro = onboardAxia ? INTRO_AXIA : INTRO_GENERIC;
  return fill(
    `Hello,

${intro}

${CREDENTIALS_BLOCK}

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
      : buildApptSetterBody(onboardAxia, params);
  return {
    subject: onboardAxia ? AXIA_SUBJECT : GENERIC_SUBJECT,
    body,
  };
}

export const WELCOME_TEMPLATE_OPTIONS: { id: WelcomeTemplateId; label: string }[] = [
  { id: "sales_rep", label: "Sales Rep" },
  { id: "appt_setter", label: "Appt Setter" },
];
