import { env } from "@/lib/env";
import { normalizeEmail } from "@/lib/inactive-reps/identity";
import type { InactiveRepCandidate } from "@/lib/inactive-reps/types";
import { getGraphAccessToken, GRAPH_BASE, requireAzureConfig } from "@/lib/microsoft/graph-auth";

interface SentMessage {
  id: string;
  subject: string;
  sentDateTime: string;
}

function htmlEscape(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

async function findSentMessage(subject: string, recipient: string): Promise<SentMessage | null> {
  const { from } = requireAzureConfig();
  const token = await getGraphAccessToken();
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(from)}/mailFolders/SentItems/messages?$top=50&$orderby=sentDateTime%20desc&$select=id,subject,sentDateTime,toRecipients`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) return null;
  const payload = (await res.json()) as {
    value?: Array<{
      id?: string;
      subject?: string;
      sentDateTime?: string;
      toRecipients?: Array<{ emailAddress?: { address?: string } }>;
    }>;
  };
  const match = (payload.value ?? []).find(
    message =>
      message.id &&
      message.subject === subject &&
      message.sentDateTime &&
      message.toRecipients?.some(
        item => normalizeEmail(item.emailAddress?.address) === normalizeEmail(recipient),
      ),
  );
  return match
    ? { id: match.id!, subject: match.subject!, sentDateTime: match.sentDateTime! }
    : null;
}

function accountCounts(candidates: InactiveRepCandidate[]): Record<string, number> {
  const counts: Record<string, number> = { enerflo: 0, microsoft: 0, terros: 0 };
  for (const candidate of candidates) {
    for (const target of candidate.targets) counts[target.platform] = (counts[target.platform] ?? 0) + 1;
  }
  return counts;
}

export async function sendInactiveRepReport(options: {
  subject: string;
  reportDate: string;
  recipient: string;
  csv: string;
  candidates: InactiveRepCandidate[];
}): Promise<{ from: string; messageId: string; sentAt: string; alreadySent: boolean }> {
  const { from } = requireAzureConfig();
  const expectedRecipient = env.inactiveRepEmailTo?.trim() || "noxpwr@gmail.com";
  if (normalizeEmail(options.recipient) !== normalizeEmail(expectedRecipient)) {
    throw new Error("Inactive-rep recipient does not match INACTIVE_REP_EMAIL_TO");
  }

  const existing = await findSentMessage(options.subject, options.recipient);
  if (existing) {
    return { from, messageId: existing.id, sentAt: existing.sentDateTime, alreadySent: true };
  }

  const token = await getGraphAccessToken();
  const counts = accountCounts(options.candidates);
  const body = `
    <p>Attached is the inactive sales-rep account report for <strong>${htmlEscape(options.reportDate)}</strong>.</p>
    <ul>
      <li>Unique representatives: ${options.candidates.length}</li>
      <li>Enerflo accounts: ${counts.enerflo}</li>
      <li>Microsoft accounts: ${counts.microsoft}</li>
      <li>Terros accounts: ${counts.terros}</li>
    </ul>
    <p>Criteria: eligible Sales Rep, Setter, or Closer; no login within the rolling 30-day window on every existing platform account; and no confidently attributable sales activity within the rolling 30-day window.</p>
    <p>A no-login-history account is included only when it is more than 30 days old. A recent login on any existing platform protects the representative.</p>
    <p>Every person will be checked again against live role, login, sales, account, and license data before action. Eligible accounts are processed no sooner than 24 hours after this email is confirmed in Sent Items.</p>
  `;
  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: options.subject,
        body: { contentType: "HTML", content: body },
        toRecipients: [{ emailAddress: { address: options.recipient } }],
        attachments: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: `inactive-rep-deactivation-${options.reportDate}.csv`,
            contentType: "text/csv",
            contentBytes: Buffer.from(options.csv, "utf8").toString("base64"),
          },
        ],
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Microsoft Graph sendMail failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const sent = await findSentMessage(options.subject, options.recipient);
    if (sent) return { from, messageId: sent.id, sentAt: sent.sentDateTime, alreadySent: false };
  }
  throw new Error("Microsoft Graph accepted the report but it was not confirmed in Sent Items");
}
