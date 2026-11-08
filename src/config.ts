import { MailServiceError } from './errors';
export type Environment = Readonly<Record<string, string | undefined>>;
export interface Sender { readonly address: string; readonly name?: string }
export interface Profile {
  readonly id: string; readonly host: string; readonly port: number;
  readonly security: 'starttls' | 'ssl'; readonly from: Sender;
  readonly auth?: Readonly<{ user: string; pass: string }>;
  readonly maxConnections: number; readonly maxMessages: number; readonly maxPending: number;
}
export interface Configuration { readonly defaultProfile: string; readonly profiles: Readonly<Record<string, Profile>> }
function invalid(key: string): never { throw new MailServiceError('CONFIGURATION', `Invalid or missing ${key}`, key); }
function required(env: Environment, key: string): string {
  const value = env[key];
  if (!value?.trim()) return invalid(key);
  return value;
}
function integer(env: Environment, key: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw)) return invalid(key);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) return invalid(key);
  return value;
}
export function parseConfiguration(env: Environment): Configuration {
  const ids = required(env, 'SMTP_PROFILES').split(',').map(id => id.trim());
  if (ids.some(id => !/^[a-z][a-z0-9_]*$/.test(id)) || new Set(ids).size !== ids.length) invalid('SMTP_PROFILES');
  const defaultProfile = required(env, 'SMTP_DEFAULT_PROFILE').trim();
  if (!ids.includes(defaultProfile)) invalid('SMTP_DEFAULT_PROFILE');
  const profiles: Record<string, Profile> = Object.create(null);
  for (const id of ids) {
    const prefix = `SMTP_${id.toUpperCase()}_`;
    const security = env[`${prefix}SECURITY`] ?? 'starttls';
    if (security !== 'starttls' && security !== 'ssl') invalid(`${prefix}SECURITY`);
    const user = env[`${prefix}USER`], pass = env[`${prefix}PASSWORD`];
    if ((user !== undefined || pass !== undefined) && (!user?.trim() || !pass?.length)) invalid(`${prefix}USER/PASSWORD`);
    const name = env[`${prefix}FROM_NAME`]?.trim();
    profiles[id] = Object.freeze({
      id, host: required(env, `${prefix}HOST`).trim(),
      port: integer(env, `${prefix}PORT`, security === 'ssl' ? 465 : 587, 65535), security,
      from: Object.freeze({ address: required(env, `${prefix}FROM`).trim(), ...(name ? { name } : {}) }),
      ...(user !== undefined && pass !== undefined ? { auth: Object.freeze({ user, pass }) } : {}),
      maxConnections: integer(env, `${prefix}MAX_CONNECTIONS`, 5),
      maxMessages: integer(env, `${prefix}MAX_MESSAGES`, 100),
      maxPending: integer(env, `${prefix}MAX_PENDING`, 1000),
    });
  }
  return Object.freeze({ defaultProfile, profiles: Object.freeze(profiles) });
}
export interface RecurringMessage { readonly to: string[]; readonly subject: string; readonly text: string; readonly profile: string }
export function parseRecurring(env: Environment, config: Configuration): RecurringMessage {
  const to = required(env, 'MAIL_TO').split(',').map(value => value.trim());
  if (to.some(value => !value)) invalid('MAIL_TO');
  const profile = env.MAIL_SMTP_PROFILE ?? config.defaultProfile;
  if (!Object.hasOwn(config.profiles, profile)) invalid('MAIL_SMTP_PROFILE');
  return { to, subject: required(env, 'MAIL_SUBJECT'), text: required(env, 'MAIL_TEXT'), profile };
}
