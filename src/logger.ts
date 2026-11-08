import { ConsoleLogger } from '@nestjs/common';
import { MailServiceError } from './errors';

export interface ErrorLogger { error(message: string): void }
export function createLogger(): ErrorLogger {
  return new ConsoleLogger('MailService', { logLevels: ['error'], colors: false });
}
const logged = new WeakSet<object>();
const safeCodes = new Set(['EAUTH', 'ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EDNS', 'ESOCKET', 'ETLS', 'EENVELOPE', 'EMESSAGE', 'EPROTOCOL', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
export function logFailure(logger: ErrorLogger, operation: string, error: unknown, profile?: string): void {
  if (error && typeof error === 'object') {
    if (logged.has(error)) return;
    logged.add(error);
  }
  const code = error instanceof MailServiceError ? error.code
    : error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && safeCodes.has(error.code) ? error.code : 'UNKNOWN';
  const safeProfile = profile && /^[a-z][a-z0-9_]*$/.test(profile) ? ` profile=${profile}` : '';
  const setting = error instanceof MailServiceError && error.setting && /^(SMTP|MAIL)_[A-Z0-9_/]+$/.test(error.setting) ? ` setting=${error.setting}` : '';
  // Do not serialize raw exceptions, SMTP replies, messages, or credentials.
  logger.error(`${operation} failed code=${code}${safeProfile}${setting}`);
}
