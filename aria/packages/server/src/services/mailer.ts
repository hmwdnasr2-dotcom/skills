import nodemailer from 'nodemailer';

// ── Config ─────────────────────────────────────────────────────────────────────
// Set these in .env to enable email delivery:
//   SMTP_HOST   e.g. smtp.gmail.com
//   SMTP_PORT   e.g. 587
//   SMTP_USER   your Gmail address
//   SMTP_PASS   Gmail app password (not your account password)
//   REPORT_EMAIL  where reports are sent (defaults to SMTP_USER)

export function emailEnabled(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS,
  );
}

function makeTransport() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  });
}

export interface MailOptions {
  to?: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(opts: MailOptions): Promise<void> {
  if (!emailEnabled()) return;

  const to = opts.to ?? process.env.REPORT_EMAIL ?? process.env.SMTP_USER!;

  try {
    const transport = makeTransport();
    await transport.sendMail({
      from:    `"ARIA" <${process.env.SMTP_USER}>`,
      to,
      subject: opts.subject,
      text:    opts.text,
      html:    opts.html,
    });
    console.log(`[mailer] Email sent to ${to}: ${opts.subject}`);
  } catch (err) {
    console.error('[mailer] Send failed:', (err as Error).message);
  }
}
