import type { Configuration, Sender } from './config';
import { CapacityError, MailServiceError, ShutdownError } from './errors';
import { logFailure, type ErrorLogger } from './logger';
import { createTransport, type MailTransport, type SubmissionResult, type TransportFactory } from './transport';

export interface MailMessage {
  readonly to: string | readonly string[]; readonly subject: string;
  readonly text?: string; readonly html?: string; readonly profile?: string; readonly from?: Sender;
}
interface Pending { fail(error: unknown): void }
interface Pool { transport: MailTransport; maxPending: number; pending: Set<Pending> }
export class MailService {
  private readonly pools = new Map<string, Pool>();
  private closing = false;
  private closePromise?: Promise<void>;
  private drained?: () => void;
  constructor(private readonly config: Configuration, private readonly logger: ErrorLogger, factory: TransportFactory = createTransport) {
    try {
      for (const profile of Object.values(config.profiles)) {
        this.pools.set(profile.id, { transport: factory(profile), maxPending: profile.maxPending, pending: new Set() });
      }
    } catch (error) {
      for (const pool of this.pools.values()) pool.transport.close();
      logFailure(logger, 'transport initialization', error);
      throw error;
    }
  }
  async send(message: MailMessage): Promise<SubmissionResult> {
    let profileId: string | undefined;
    try {
      if (this.closing) throw new ShutdownError();
      profileId = message.profile ?? this.config.defaultProfile;
      const pool = this.pools.get(profileId);
      const profile = this.config.profiles[profileId];
      if (!pool || !profile) throw new MailServiceError('PROFILE', 'Unknown SMTP profile');
      const to = typeof message.to === 'string' ? message.to.split(',').map(v => v.trim()) : [...message.to];
      if (!to.length || to.some(v => typeof v !== 'string' || !v.trim()) || typeof message.subject !== 'string'
        || !(typeof message.text === 'string' && message.text.length || typeof message.html === 'string' && message.html.length)) {
        throw new MailServiceError('VALIDATION', 'Message needs recipients, subject, and body');
      }
      const sender = message.from ?? profile.from;
      if (typeof sender.address !== 'string' || !sender.address.trim() || (sender.name !== undefined && typeof sender.name !== 'string')) {
        throw new MailServiceError('VALIDATION', 'Invalid sender');
      }
      if (pool.pending.size >= pool.maxPending) throw new CapacityError();
      const options = { to, subject: message.subject, text: message.text, html: message.html,
        from: { address: sender.address, ...(sender.name ? { name: sender.name } : {}) } };
      return await new Promise<SubmissionResult>((resolve, reject) => {
        let settled = false;
        const finish = (error?: unknown, result?: SubmissionResult) => {
          if (settled) return;
          settled = true;
          pool.pending.delete(pending);
          if (this.closing && this.pendingCount() === 0) this.drained?.();
          if (error !== undefined) reject(error); else resolve(result!);
        };
        const pending: Pending = { fail: error => finish(error) };
        pool.pending.add(pending);
        try { pool.transport.sendMail(options).then(result => {
          if (result.rejected?.length) logFailure(this.logger, 'recipient rejection', Object.assign(new Error(), { code: 'EENVELOPE' }), profileId);
          finish(undefined, result);
        }, error => finish(error ?? new Error('SMTP submission failed'))); }
        catch (error) { finish(error); }
      });
    } catch (error) {
      logFailure(this.logger, 'mail submission', error, profileId && this.pools.has(profileId) ? profileId : undefined);
      throw error;
    }
  }
  private pendingCount(): number {
    let count = 0;
    for (const pool of this.pools.values()) count += pool.pending.size;
    return count;
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.drain();
    return this.closePromise;
  }
  private async drain(): Promise<void> {
    if (this.pendingCount()) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 10_000);
        this.drained = () => { clearTimeout(timer); resolve(); };
      });
    }
    for (const pool of this.pools.values()) {
      for (const pending of pool.pending) pending.fail(new ShutdownError());
      try { pool.transport.close(); } catch (error) { logFailure(this.logger, 'pool close', error); }
    }
  }
  onModuleDestroy(): Promise<void> { return this.close(); }
}
