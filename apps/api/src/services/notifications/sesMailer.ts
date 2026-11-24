/**
 * Email through Amazon SES (API v2) in ca-central-1, so messages are sent from Canada.
 *
 * Configured by environment only (lib/config.ts): MAIL_PROVIDER=ses, MAIL_FROM (a verified sender
 * such as "FlexcityHeadquarters <notices@example.ca>"), SES_REGION (default ca-central-1) and an
 * optional SES_CONFIGURATION_SET (bounce and complaint events). Credentials come from the standard
 * AWS provider chain (the ECS task role in production); no keys live in code or config files.
 * MAIL_PROVIDER=console (the default) keeps the console mailer for development and tests.
 */
import { SESv2Client, SendEmailCommand, type SendEmailCommandInput } from '@aws-sdk/client-sesv2';
import { config } from '../../config.js';
import { ConsoleMailer, type Mail, type Mailer } from './mailer.js';

/** What the SES client needs to do here (the real one, or a stand-in in tests). */
export interface SesClientLike {
  send(command: SendEmailCommand): Promise<{ MessageId?: string }>;
}

export class SesMailer implements Mailer {
  constructor(
    private readonly client: SesClientLike,
    private readonly from: string,
    private readonly configurationSet?: string,
  ) {}

  /** The SES request for one message (exported for tests). */
  input(mail: Mail): SendEmailCommandInput {
    return {
      FromEmailAddress: this.from,
      Destination: { ToAddresses: [mail.to] },
      Content: {
        Simple: {
          Subject: { Data: mail.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: mail.text, Charset: 'UTF-8' }, ...(mail.html ? { Html: { Data: mail.html, Charset: 'UTF-8' } } : {}) },
          ...(mail.headers && Object.keys(mail.headers).length ? { Headers: Object.entries(mail.headers).map(([Name, Value]) => ({ Name, Value })) } : {}),
        },
      },
      ...(this.configurationSet ? { ConfigurationSetName: this.configurationSet } : {}),
    };
  }

  async send(mail: Mail): Promise<void> {
    await this.client.send(new SendEmailCommand(this.input(mail)));
  }
}

/** The mailer the environment asks for: SES in production, the console everywhere else. */
export function mailerFromEnv(): Mailer {
  const c = config();
  if (c.MAIL_PROVIDER === 'ses') {
    if (!c.MAIL_FROM) throw new Error('MAIL_PROVIDER=ses needs MAIL_FROM (a sender verified in SES).');
    // Bounded: a stalled call gives up instead of hanging (the SDK's default request timeout is none).
    // Two tries of at most 3 s to connect and 10 s to answer, so a send finishes or fails well within a minute.
    const client = new SESv2Client({ region: c.SES_REGION, maxAttempts: 2, requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 } });
    return new SesMailer(client, c.MAIL_FROM, c.SES_CONFIGURATION_SET);
  }
  return new ConsoleMailer();
}
