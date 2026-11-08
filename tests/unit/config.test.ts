import { describe, test, expect } from 'bun:test';
import { parseConfiguration, parseRecurring } from '../../src/config';
import { config, env } from '../helpers';

describe('profile configuration', () => {
  test('secure defaults, names, frozen isolated profiles, ssl port', () => {
    const c = config();
    expect(c.profiles.primary).toMatchObject({ port: 587, security: 'starttls', maxConnections: 5, maxMessages: 100, maxPending: 1000, from: { name: 'Service' } });
    expect(c.profiles.notifications).toMatchObject({ port: 465, security: 'ssl', from: { address: 'notifications@example.test' } });
    expect(Object.isFrozen(c.profiles.primary.from)).toBe(true);
    expect(c.profiles.primary.auth).toBeUndefined();
  });
  test('port, credentials and limits override; password is preserved', () => {
    expect(config({ SMTP_PRIMARY_PORT: '2525', SMTP_PRIMARY_USER: 'user', SMTP_PRIMARY_PASSWORD: ' pass ', SMTP_PRIMARY_MAX_CONNECTIONS: '9', SMTP_PRIMARY_MAX_MESSAGES: '42', SMTP_PRIMARY_MAX_PENDING: '12' }).profiles.primary).toMatchObject({ port: 2525, auth: { user: 'user', pass: ' pass ' }, maxConnections: 9, maxMessages: 42, maxPending: 12 });
  });
  for (const name of [undefined, '', '   ']) test(`address-only sender for ${String(name)}`, () => {
    expect(config({ SMTP_PRIMARY_FROM_NAME: name }).profiles.primary.from.name).toBeUndefined();
  });
  for (const value of ['0', '-1', '1.5', '2x', '', ' 2', '9007199254740992']) {
    for (const key of ['PORT', 'MAX_CONNECTIONS', 'MAX_MESSAGES', 'MAX_PENDING']) test(`rejects ${key}=${value}`, () => {
      expect(() => config({ [`SMTP_PRIMARY_${key}`]: value })).toThrow();
    });
  }
  test('port upper bound', () => expect(() => config({ SMTP_PRIMARY_PORT: '65536' })).toThrow());
  for (const key of ['SMTP_PROFILES', 'SMTP_DEFAULT_PROFILE', 'SMTP_PRIMARY_HOST', 'SMTP_PRIMARY_FROM']) {
    for (const value of [undefined, '', ' ']) test(`requires ${key}: ${String(value)}`, () => expect(() => config({ [key]: value })).toThrow());
  }
  for (const value of ['primary,primary', 'primary,', 'Primary', 'primary,bad-name', 'primary,,notifications']) test(`invalid profiles ${value}`, () => expect(() => config({ SMTP_PROFILES: value })).toThrow());
  test('default must exist', () => expect(() => config({ SMTP_DEFAULT_PROFILE: 'unknown' })).toThrow());
  test('validates every profile', () => expect(() => config({ SMTP_NOTIFICATIONS_HOST: '' })).toThrow());
  test('no legacy fallback', () => expect(() => config({ SMTP_PRIMARY_HOST: undefined, SMTP_HOST: 'legacy' })).toThrow());
  test('invalid security', () => expect(() => config({ SMTP_PRIMARY_SECURITY: 'plain' })).toThrow());
  for (const pair of [{ SMTP_PRIMARY_USER: 'u' }, { SMTP_PRIMARY_PASSWORD: 'secret' }, { SMTP_PRIMARY_USER: '', SMTP_PRIMARY_PASSWORD: 'secret' }, { SMTP_PRIMARY_USER: 'u', SMTP_PRIMARY_PASSWORD: '' }]) test(`invalid credential pair ${Object.keys(pair).join('/')}`, () => {
    expect(() => config(pair)).toThrow('SMTP_PRIMARY_USER/PASSWORD');
    try { config(pair); } catch (e) { expect(String(e)).not.toContain('secret'); }
  });
});
describe('recurring message', () => {
  test('defaults, recipients and content preserved', () => expect(parseRecurring({ ...env, MAIL_TO: ' a@test, b@test ', MAIL_TEXT: ' body ' }, config())).toEqual({ to: ['a@test', 'b@test'], subject: 'Subject', text: ' body ', profile: 'primary' }));
  test('explicit profile', () => expect(parseRecurring({ ...env, MAIL_SMTP_PROFILE: 'notifications' }, config()).profile).toBe('notifications'));
  for (const key of ['MAIL_TO', 'MAIL_SUBJECT', 'MAIL_TEXT']) {
    for (const value of [undefined, '', ' ']) test(`requires ${key} ${String(value)}`, () => expect(() => parseRecurring({ ...env, [key]: value }, config())).toThrow());
  }
  for (const value of ['', 'unknown', ' primary ']) test(`invalid recurring profile ${value}`, () => expect(() => parseRecurring({ ...env, MAIL_SMTP_PROFILE: value }, config())).toThrow());
  test('rejects empty recipients', () => expect(() => parseRecurring({ ...env, MAIL_TO: 'a@test,,b@test' }, config())).toThrow());
});
