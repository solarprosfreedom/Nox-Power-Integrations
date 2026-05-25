import { NextResponse } from "next/server";
import { sendMailAsUser, isGraphMailConfigured } from "@/lib/microsoft/graph-mail";

export async function POST(request: Request) {
  if (!isGraphMailConfigured()) {
    return NextResponse.json(
      {
        error:
          "Microsoft Graph not configured. Add AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and WELCOME_EMAIL_FROM to .env.local.",
      },
      { status: 503 }
    );
  }

  let body: {
    to?: string;
    subject?: string;
    body?: string;
    contentType?: "text" | "html";
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = body.to?.trim();
  const subject = body.subject?.trim();
  const text = body.body?.trim();

  if (!to) return NextResponse.json({ error: "Recipient (to) is required" }, { status: 400 });
  if (!subject) return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Email body is required" }, { status: 400 });

  try {
    const result = await sendMailAsUser({
      to,
      subject,
      body: text,
      contentType: body.contentType ?? "text",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Send failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
