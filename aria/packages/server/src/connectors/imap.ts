import { ImapFlow } from 'imapflow';

export interface EmailMessage {
  uid: number;
  from: string;
  subject: string;
  date: Date;
  snippet: string;
}

function getImapCredentials() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return { user, pass };
}

export function imapEnabled(): boolean {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export async function fetchNewEmails(sinceUid: number): Promise<{ emails: EmailMessage[]; maxUid: number }> {
  const creds = getImapCredentials();
  if (!creds) return { emails: [], maxUid: sinceUid };

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: creds,
    logger: false,
  });

  await client.connect();
  const emails: EmailMessage[] = [];
  let maxUid = sinceUid;

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const searchUid = sinceUid > 0 ? sinceUid + 1 : 1;
      const messages = client.fetch(`${searchUid}:*`, {
        uid: true,
        envelope: true,
        bodyStructure: false,
      });

      for await (const msg of messages) {
        if (!msg.uid || msg.uid <= sinceUid) continue;
        const from = msg.envelope?.from?.[0];
        const fromStr = from
          ? (from.name ? `${from.name} <${from.address}>` : (from.address ?? ''))
          : '';
        emails.push({
          uid:     msg.uid,
          from:    fromStr,
          subject: msg.envelope?.subject ?? '(no subject)',
          date:    msg.envelope?.date ?? new Date(),
          snippet: '',
        });
        if (msg.uid > maxUid) maxUid = msg.uid;
      }
    } finally {
      lock.release();
    }
  } catch {
    // mailbox empty or no new messages — normal case
  } finally {
    await client.logout();
  }

  return { emails, maxUid };
}
