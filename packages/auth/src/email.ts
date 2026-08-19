import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { appEnv } from '@esoko/domain';

/**
 * Resolves the email provider for this run mode — same three-tier
 * shape as smsProvider() in sms.ts:
 *   development     → mailhog by default — every email goes to the
 *                     mailhog container (docker-compose.yml), never a
 *                     real inbox, whatever SMTP credentials are lying
 *                     around in .env. View what was "sent" at
 *                     http://localhost:8025. console is still available
 *                     for debugging without even the docker network.
 *   LOCAL_TEST_PROD → mailhog unless EMAIL_PROVIDER is set — production
 *                     behaviour rehearsed locally without spamming a
 *                     real inbox by default.
 *   production      → EMAIL_PROVIDER as set (default console, so a
 *                     misconfigured deploy fails loud in logs rather
 *                     than silently emailing nobody).
 */
export function emailProvider(): string {
  if (appEnv() === 'development') return process.env.EMAIL_PROVIDER === 'console' ? 'console' : 'mailhog';
  if (appEnv() === 'LOCAL_TEST_PROD') return process.env.EMAIL_PROVIDER ?? 'mailhog';
  return process.env.EMAIL_PROVIDER ?? 'console';
}

let transporter: Transporter | null = null;
let transporterProvider: string | null = null;

function getTransporter(provider: string): Transporter {
  if (transporter && transporterProvider === provider) return transporter;

  transporter = provider === 'mailhog'
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? 'mailhog', port: Number(process.env.SMTP_PORT ?? 1025),
      })
    : nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          : undefined,
      });
  transporterProvider = provider;
  return transporter;
}

/**
 * The one email sender in this codebase — mirrors sendSms in sms.ts.
 * In console mode it prints instead of dialling SMTP, so nothing can
 * send a live email from a dev box by accident.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const provider = emailProvider();

  if (provider === 'console') {
    console.log(`\n  ┌─ EMAIL (console) ───────────────────\n  │  to: ${to}\n  │  subject: ${subject}\n  │  ${text}\n  └───────────────────────────────────\n`);
    return;
  }

  try {
    await getTransporter(provider).sendMail({
      from: process.env.EMAIL_FROM ?? 'Esoko <no-reply@esoko.co.ke>',
      to, subject, text,
    });
  } catch (e) {
    console.error('[EMAIL] send failed', e);
    throw new Error('Could not send the email — the email provider is unreachable');
  }
}
