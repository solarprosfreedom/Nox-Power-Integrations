export type WelcomeTemplateId = "sales_rep" | "appt_setter";

export interface WelcomeTemplateParams {
  username: string;
  password: string;
  auroraEmail?: string;
}

const DEFAULT_SUBJECT = "Welcome to Axia — your Nox Power email";

function fill(template: string, p: WelcomeTemplateParams): string {
  return template
    .replace(/\{\{username\}\}/g, p.username)
    .replace(/\{\{password\}\}/g, p.password)
    .replace(/\{\{auroraEmail\}\}/g, p.auroraEmail ?? "(firstname+axia@noxpwr.com)");
}

const SALES_REP_BODY = `Hello,

You have been onboarded with Axia. We have created a new email for you. See below. You will be receiving emails shortly from different financiers and our internal systems, Enerflo and Terros.

We have created a new company email for you. Please login through outlook.com.

Username: {{username}}

Password: {{password}}

Here are a few other tips to get you started!

- Here is a link to an overview video for the Planner can be viewed here: https://www.youtube.com/watch?v=GWPFeKZBqSQ. This is to schedule site surveys, when you are ready.

  Exactus Planner Scheduling Guidelines: https://drive.google.com/file/d/1fqKC3p20PwbAm6itwBNy0hiSIvBEZDVD/view?pli=1

- Keep in mind your email to access Enfin and Aurora is going to be {{auroraEmail}}.

If you need further login assistance, you can try to use the resources below.

LOGIN SUPPORT:

- Aurora: support@aurorasolar.com
- EnFin: Text (717) 853-1183
- Recheck: Support@Recheck.co or https://recheck.co/contact/

Please let us know if you have any questions/issues.

Thanks,

Admin Team`;

const APPT_SETTER_BODY = `Hello,

You have been onboarded with Axia. We have created a new email for you. See below. You will be receiving emails shortly from different financiers and our internal systems, Enerflo and Terros.

We have created a new company email for you. Please login through outlook.com.

Username: {{username}}

Password: {{password}}

Please let us know if you have any questions/issues.

Thanks,

Admin Team`;

export function renderWelcomeTemplate(
  id: WelcomeTemplateId,
  params: WelcomeTemplateParams
): { subject: string; body: string } {
  const body =
    id === "sales_rep"
      ? fill(SALES_REP_BODY, params)
      : fill(APPT_SETTER_BODY, params);
  return { subject: DEFAULT_SUBJECT, body };
}

export const WELCOME_TEMPLATE_OPTIONS: { id: WelcomeTemplateId; label: string }[] = [
  { id: "sales_rep", label: "Sales Rep" },
  { id: "appt_setter", label: "Appt Setter" },
];
