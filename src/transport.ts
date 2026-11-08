import nodemailer from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import type { Profile } from './config';
import type { SendMailOptions } from 'nodemailer';
export type SubmissionResult = SMTPPool.SentMessageInfo;
export interface MailTransport {
  sendMail(message: SendMailOptions): Promise<SubmissionResult>;
  close(): void;
}
export type TransportFactory = (profile: Profile) => MailTransport;
export function transportOptions(profile: Profile): SMTPPool.Options {
  return {
    pool: true, host: profile.host, port: profile.port,
    secure: profile.security === 'ssl', requireTLS: profile.security === 'starttls',
    tls: { rejectUnauthorized: true }, auth: profile.auth,
    maxConnections: profile.maxConnections, maxMessages: profile.maxMessages,
    maxRequeues: 0,
    connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 60_000,
    logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true,
  };
}
export const createTransport: TransportFactory = profile => {
  const transport = nodemailer.createTransport(transportOptions(profile));
  return { sendMail: message => transport.sendMail(message), close: () => transport.close({ force: true }) };
};
