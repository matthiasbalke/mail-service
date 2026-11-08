import { test, expect } from 'bun:test';
import { NestFactory } from '@nestjs/core';
import { MailModule } from '../../src/mail-module';
import { MailService } from '../../src/mail-service';
import { runLoop, wait } from '../../src/runtime';
import { config, message, fakeTransport, logger, result, deferred } from '../helpers';

test('Nest resolves injectable sender and closes all transports', async () => {
  const fake = fakeTransport();
  const app = await NestFactory.createApplicationContext(MailModule.register(config(), logger(), () => fake.transport), { logger: false });
  const call = app.get(MailService).send(message); fake.requests[0].job.resolve(result()); await call;
  await app.close(); expect(fake.transport.close).toHaveBeenCalledTimes(2);
});
test('loop waits before every attempt, yields, remains sequential, and continues after failure', async () => {
  const controller = new AbortController(), events: string[] = [];
  const gates = [deferred<void>(), deferred<void>(), deferred<void>()]; let waits = 0, sends = 0;
  const loop = runLoop({ send: async m => {
    expect(m).toBe(message); events.push('send');
    if (++sends === 1) throw new Error('already logged by sender');
  } }, message, controller.signal, async (ms) => { expect(ms).toBe(20000); events.push('wait'); await gates[waits++].promise; });
  expect(events).toEqual(['wait']); gates[0].resolve(); await Bun.sleep(0);
  expect(events).toEqual(['wait', 'send', 'wait']); gates[1].resolve(); await Bun.sleep(0);
  expect(events).toEqual(['wait', 'send', 'wait', 'send', 'wait']); controller.abort(); gates[2].resolve(); await loop;
  expect(sends).toBe(2);
});
test('slow send cannot overlap or start next wait early', async () => {
  const controller = new AbortController(), gate = deferred<void>(); let calls = 0, waits = 0;
  const loop = runLoop({ send: async () => { calls++; await gate.promise; controller.abort(); } }, message, controller.signal, async () => { waits++; });
  await Bun.sleep(0); expect(calls).toBe(1); expect(waits).toBe(1); gate.resolve(); await loop;
});
test('real wait yields and is immediately cancellable', async () => {
  const controller = new AbortController(); const sleeping = wait(20000, controller.signal);
  await Bun.sleep(0); controller.abort(); await expect(sleeping).rejects.toThrow();
});
