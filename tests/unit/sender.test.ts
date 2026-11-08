import { describe, test, expect, mock } from 'bun:test';
import { MailService } from '../../src/mail-service';
import { CapacityError, ShutdownError } from '../../src/errors';
import { transportOptions } from '../../src/transport';
import { config, message, fakeTransport, logger, result } from '../helpers';

function fixture(maxPending = '2') {
  const a = fakeTransport(), b = fakeTransport(), log = logger();
  const service = new MailService(config({ SMTP_PRIMARY_MAX_PENDING: maxPending }), log, p => p.id === 'primary' ? a.transport : b.transport);
  return { service, a, b, log };
}
test('transport TLS/auth/pooling options', () => {
  const c = config({ SMTP_PRIMARY_USER: 'u', SMTP_PRIMARY_PASSWORD: 'p' });
  expect(transportOptions(c.profiles.primary)).toMatchObject({ pool: true, secure: false, requireTLS: true, tls: { rejectUnauthorized: true }, auth: { user: 'u', pass: 'p' }, maxConnections: 5, maxMessages: 100, maxRequeues: 0, debug: false, logger: false });
  expect(transportOptions(c.profiles.notifications)).toMatchObject({ secure: true, requireTLS: false, auth: undefined });
});
test('concurrent sender overrides do not mutate defaults; independent results', async () => {
  const { service, a } = fixture('3');
  const first = service.send({ ...message, from: { address: 'a@test', name: 'A' } });
  const second = service.send({ ...message, from: { address: 'b@test' }, html: '<b>HTML</b>' });
  const third = service.send({ ...message, to: ['x@test', 'y@test'] });
  expect(a.requests.length).toBe(3);
  expect(a.requests.map(r => r.message.from)).toEqual([{ address: 'a@test', name: 'A' }, { address: 'b@test' }, { address: 'sender@example.test', name: 'Service' }]);
  expect(a.requests[1].message.html).toBe('<b>HTML</b>');
  expect(a.requests[2].message.to).toEqual(['x@test', 'y@test']);
  a.requests[1].job.resolve(result('second')); a.requests[0].job.resolve(result('first')); a.requests[2].job.resolve(result('third'));
  expect((await Promise.all([first, second, third])).map(r => r.messageId)).toEqual(['first', 'second', 'third']);
  await service.close();
});
test('bounded admission rejects overload; isolated pools and failures, then recovers', async () => {
  const { service, a, b, log } = fixture('1');
  const first = service.send(message);
  const observed = first.catch(e => e);
  await expect(service.send(message)).rejects.toBeInstanceOf(CapacityError);
  const other = service.send({ ...message, profile: 'notifications', text: undefined, html: '<p>body</p>' });
  expect(a.requests.length).toBe(1); expect(b.requests.length).toBe(1);
  const failure = Object.assign(new Error('password and mail contents must not be logged'), { code: 'EAUTH' });
  a.requests[0].job.reject(failure); b.requests[0].job.resolve(result('other'));
  expect(await observed).toBe(failure); expect((await other).messageId).toBe('other');
  const next = service.send(message); a.requests[1].job.resolve(result()); await next;
  expect(log.error.mock.calls.flat().join(' ')).toContain('EAUTH');
  expect(log.error.mock.calls.flat().join(' ')).not.toContain(failure.message);
  expect(log.error).toHaveBeenCalledTimes(2);
  await service.close();
});
for (const code of ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ETLS', 'EMESSAGE']) test(`logs ${code} once and propagates`, async () => {
  const { service, a, log } = fixture(); const error = Object.assign(new Error('secret response'), { code });
  const call = service.send(message); const observed = call.catch(e => e);
  a.requests[0].job.reject(error); expect(await observed).toBe(error);
  expect(log.error).toHaveBeenCalledTimes(1); expect(log.error.mock.calls[0][0]).toContain(code); expect(log.error.mock.calls[0][0]).not.toContain('secret');
  await service.close();
});
test('unknown profile and invalid messages never reach transport', async () => {
  const { service, a, log } = fixture();
  for (const change of [{ profile: 'unknown' }, { to: [] }, { to: 'a@test,,b@test' }, { text: undefined }, { from: { address: '' } }]) await expect(service.send({ ...message, ...change })).rejects.toThrow();
  expect(a.requests.length).toBe(0); expect(log.error).toHaveBeenCalledTimes(5); await service.close();
});
test('synchronous transport throw releases capacity', async () => {
  const log = logger(); let attempts = 0;
  const transport = { sendMail: () => { if (!attempts++) throw new Error('oops'); return Promise.resolve(result()); }, close: mock(() => {}) };
  const service = new MailService(config({ SMTP_PRIMARY_MAX_PENDING: '1' }), log, () => transport);
  await expect(service.send(message)).rejects.toThrow('oops'); await expect(service.send(message)).resolves.toMatchObject({ messageId: 'id' }); await service.close();
});
test('shutdown closes admission across pools, drains, and is idempotent', async () => {
  const { service, a, b } = fixture();
  const x = service.send(message), y = service.send({ ...message, profile: 'notifications' });
  const closing = service.close(); expect(service.close()).toBe(closing);
  await expect(service.send(message)).rejects.toBeInstanceOf(ShutdownError);
  expect(a.transport.close).not.toHaveBeenCalled();
  a.requests[0].job.resolve(result('a')); b.requests[0].job.resolve(result('b'));
  await Promise.all([x, y, closing]);
  expect(a.transport.close).toHaveBeenCalledTimes(1); expect(b.transport.close).toHaveBeenCalledTimes(1);
});
test('one shutdown deadline settles pending work in every pool; late callbacks are safe', async () => {
  const { service, a, b } = fixture();
  const calls = [service.send(message).catch(e => e), service.send({ ...message, profile: 'notifications' }).catch(e => e)];
  const realTimer = globalThis.setTimeout;
  const spy = mock((fn: TimerHandler, ms?: number, ...args: unknown[]) => realTimer(fn, ms === 10000 ? 5 : ms, ...args));
  globalThis.setTimeout = spy as unknown as typeof setTimeout;
  try { await service.close(); } finally { globalThis.setTimeout = realTimer; }
  expect(spy.mock.calls.filter(c => c[1] === 10000).length).toBe(1);
  for (const value of await Promise.all(calls)) expect(value).toBeInstanceOf(ShutdownError);
  a.requests[0].job.resolve(result()); b.requests[0].job.reject(new Error('late'));
  await Promise.resolve(); expect(a.transport.close).toHaveBeenCalledTimes(1); expect(b.transport.close).toHaveBeenCalledTimes(1);
});
test('partial recipient rejection logs an error while returning submission outcome', async () => {
  const { service, a, log } = fixture();
  const call = service.send(message);
  const partial = { ...result(), rejected: ['private-recipient@test'] };
  a.requests[0].job.resolve(partial);
  expect(await call).toBe(partial); expect(log.error).toHaveBeenCalledTimes(1);
  expect(log.error.mock.calls[0][0]).toContain('EENVELOPE'); expect(log.error.mock.calls[0][0]).not.toContain('private-recipient');
  await service.close();
});
