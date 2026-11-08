import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseConfiguration, parseRecurring } from './config';
import { createLogger, logFailure } from './logger';
import { MailModule } from './mail-module';
import { MailService } from './mail-service';
import { runLoop } from './runtime';

export async function main(): Promise<void> {
  const logger = createLogger();
  const controller = new AbortController();
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  let closing: Promise<void> | undefined;
  const stop = () => {
    controller.abort();
    if (app) closing ??= app.close();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    const config = parseConfiguration(process.env);
    const message = parseRecurring(process.env, config);
    app = await NestFactory.createApplicationContext(MailModule.register(config, logger), { logger: false, abortOnError: false });
    if (controller.signal.aborted) return;
    await runLoop(app.get(MailService), message, controller.signal);
  } catch (error) {
    logFailure(logger, 'application', error);
    process.exitCode = 1;
  } finally {
    controller.abort();
    await (closing ?? app?.close());
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}
if (import.meta.main) await main();
