import { sendMailAsUser } from "@/lib/microsoft/graph-mail";

export async function sendInactiveRepOtpEmail(options: {
  email: string;
  code: string;
}): Promise<void> {
  await sendMailAsUser({
    to: options.email,
    subject: "Your Inactive Rep Review sign-in code",
    contentType: "html",
    body: `
      <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5">
        <h2 style="margin-bottom:8px">Inactive Rep Review sign-in</h2>
        <p>Use this one-time code to sign in:</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:20px 0">${options.code}</p>
        <p>This code expires in 10 minutes and can only be used once.</p>
        <p style="color:#6b7280">If you did not request this code, you can ignore this email.</p>
      </div>
    `,
  });
}
