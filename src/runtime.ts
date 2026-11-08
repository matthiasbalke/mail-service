import { setTimeout as delay } from 'node:timers/promises';
import type { MailMessage } from './mail-service';
export type Wait = (milliseconds: number, signal: AbortSignal) => Promise<unknown>;
export const wait: Wait = (milliseconds, signal) => delay(milliseconds, undefined, { signal });
export async function runLoop(
  sender: { send(message: MailMessage): Promise<unknown> }, message: MailMessage,
  signal: AbortSignal, sleep: Wait = wait,
): Promise<void> {
  while (!signal.aborted) {
    try { await sleep(20_000, signal); }
    catch (error) { if (signal.aborted) return; throw error; }
    if (signal.aborted) return;
    try { await sender.send(message); }
    catch { /* The sender logs failures; the next scheduled attempt is independent. */ }
  }
}
