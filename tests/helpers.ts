import { mock } from 'bun:test';
import { parseConfiguration, type Environment } from '../src/config';
import type { MailTransport, SubmissionResult } from '../src/transport';
import type { SendMailOptions } from 'nodemailer';
export const env: Record<string, string> = {
  SMTP_PROFILES: 'primary,notifications', SMTP_DEFAULT_PROFILE: 'primary',
  SMTP_PRIMARY_HOST: 'smtp.example.test', SMTP_PRIMARY_FROM: 'sender@example.test', SMTP_PRIMARY_FROM_NAME: 'Service',
  SMTP_NOTIFICATIONS_HOST: 'other.example.test', SMTP_NOTIFICATIONS_FROM: 'notifications@example.test', SMTP_NOTIFICATIONS_SECURITY: 'ssl',
  MAIL_TO: 'recipient@example.test', MAIL_SUBJECT: 'Subject', MAIL_TEXT: 'Private message',
};
export const config = (overrides: Environment = {}) => parseConfiguration({ ...env, ...overrides });
export const result = (id = 'id'): SubmissionResult => ({ messageId: id, envelope: { from: 'sender@example.test', to: ['recipient@example.test'] }, accepted: ['recipient@example.test'], rejected: [], pending: [], response: '250 OK', envelopeTime: 1, messageTime: 1, messageSize: 1 });
export const message = { to: 'recipient@example.test', subject: 'Subject', text: 'Secret content' };
export const logger = () => ({ error: mock((_message: string) => {}) });
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function fakeTransport() {
  const requests: { message: SendMailOptions; job: ReturnType<typeof deferred<SubmissionResult>> }[] = [];
  const transport: MailTransport = {
    sendMail: mock((message: SendMailOptions) => { const job = deferred<SubmissionResult>(); requests.push({ message, job }); return job.promise; }),
    close: mock(() => {}),
  };
  return { transport, requests };
}
