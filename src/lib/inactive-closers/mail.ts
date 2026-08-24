import { normalizeEmail } from "@/lib/inactive-reps/identity";
import { getGraphAccessToken, GRAPH_BASE, requireAzureConfig } from "@/lib/microsoft/graph-auth";
import { inactiveCloserEmailHtml } from "@/lib/inactive-closers/build-report";
import { inactiveCloserReportRecipients } from "@/lib/inactive-closers/recipients";
import type { CloserProjectRow } from "@/lib/inactive-closers/types";

interface SentMessage {
  id: string;
  subject: string;
  sentDateTime: string;
}

async function findSentMessage(subject: string, recipients: string[]): Promise<SentMessage | null> {
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
  const expected = new Set(recipients.map(normalizeEmail));
  const match = (payload.value ?? []).find(message => {
    const actual = new Set(
      (message.toRecipients ?? []).map(item => normalizeEmail(item.emailAddress?.address)),
    );
    return (
      message.id &&
      message.subject === subject &&
      message.sentDateTime &&
      [...expected].every(recipient => actual.has(recipient))
    );
  });
  return match
    ? { id: match.id!, subject: match.subject!, sentDateTime: match.sentDateTime! }
    : null;
}

export async function sendInactiveCloserReport(options: {
  subject: string;
  reportDate: string;
  csv: string;
  rows: CloserProjectRow[];
}): Promise<{ from: string; messageId: string; sentAt: string; alreadySent: boolean; recipients: string[] }> {
  const { from } = requireAzureConfig();
  const recipients = inactiveCloserReportRecipients();

  const existing = await findSentMessage(options.subject, recipients);
  if (existing) {
    return {
      from,
      messageId: existing.id,
      sentAt: existing.sentDateTime,
      alreadySent: true,
      recipients,
    };
  }

  const token = await getGraphAccessToken();
  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: options.subject,
        body: {
          contentType: "HTML",
          content: inactiveCloserEmailHtml({
            reportDate: options.reportDate,
            rows: options.rows,
          }),
        },
        toRecipients: recipients.map(address => ({ emailAddress: { address } })),
        attachments: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: `inactive-closers-${options.reportDate}.csv`,
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
    const sent = await findSentMessage(options.subject, recipients);
    if (sent) {
      return {
        from,
        messageId: sent.id,
        sentAt: sent.sentDateTime,
        alreadySent: false,
        recipients,
      };
    }
  }
  throw new Error("Microsoft Graph accepted the closer report but it was not confirmed in Sent Items");
}
