import { test, expect } from 'bun:test';
import nodemailer from 'nodemailer';
import { MailService } from '../../src/mail-service';
import { parseConfiguration } from '../../src/config';
import { transportOptions } from '../../src/transport';
import { smtpFixture } from '../smtp-fixture';
import { env, logger, message } from '../helpers';

for (const secure of [false, true]) test(`verified ${secure ? 'SSL' : 'STARTTLS'} authentication, pooling and concurrent burst`, async () => {
  const fixture = await smtpFixture({ secure, auth: true });
  const c = parseConfiguration({ ...env, SMTP_PROFILES: 'primary', SMTP_PRIMARY_HOST: 'localhost', SMTP_PRIMARY_PORT: String(fixture.port), SMTP_PRIMARY_SECURITY: secure ? 'ssl' : 'starttls', SMTP_PRIMARY_USER: 'user', SMTP_PRIMARY_PASSWORD: 'pass', SMTP_PRIMARY_MAX_CONNECTIONS: '2' });
  const service = new MailService(c, logger(), profile => {
    const options = transportOptions(profile); const transport = nodemailer.createTransport({ ...options, tls: { ...options.tls, ca: fixture.cert } });
    return { sendMail: m => transport.sendMail(m), close: () => transport.close({ force: true }) };
  });
  try {
    const started = performance.now();
    const outcomes = await Promise.all(Array.from({ length: 8 }, (_, i) => service.send({ ...message, subject: `message ${i}`, from: { address: `sender${i}@example.test`, name: `Sender ${i}` } })));
    expect(outcomes.length).toBe(8); expect(fixture.messages.length).toBe(8);
    expect(fixture.connections).toBe(2); expect(fixture.maxActive).toBe(2);
    expect(fixture.messages.join('\n')).toContain('Sender 7');
    console.log(`SMTP ${secure ? 'SSL' : 'STARTTLS'}: ${outcomes.length} submissions, ${fixture.connections} connections, ${Math.round(performance.now() - started)} ms`);
  } finally { await service.close(); await fixture.close(); }
}, 15000);

test('untrusted certificates fail with console errors', async () => {
  const fixture = await smtpFixture({ secure: true }); const log = logger();
  const service = new MailService(parseConfiguration({ ...env, SMTP_PROFILES: 'primary', SMTP_PRIMARY_HOST: 'localhost', SMTP_PRIMARY_PORT: String(fixture.port), SMTP_PRIMARY_SECURITY: 'ssl' }), log);
  try { await expect(service.send(message)).rejects.toThrow(); expect(fixture.messages).toHaveLength(0); expect(log.error).toHaveBeenCalledTimes(1); }
  finally { await service.close(); await fixture.close(); }
}, 15000);

test('STARTTLS required: no plaintext fallback', async () => {
  const fixture = await smtpFixture({ noStarttls: true }); const log = logger();
  const service = new MailService(parseConfiguration({ ...env, SMTP_PROFILES: 'primary', SMTP_PRIMARY_HOST: 'localhost', SMTP_PRIMARY_PORT: String(fixture.port) }), log);
  try { await expect(service.send(message)).rejects.toThrow(); expect(fixture.messages).toHaveLength(0); expect(log.error).toHaveBeenCalledTimes(1); }
  finally { await service.close(); await fixture.close(); }
}, 15000);
