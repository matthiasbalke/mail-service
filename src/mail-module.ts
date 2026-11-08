import 'reflect-metadata';
import { Module, type DynamicModule } from '@nestjs/common';
import { MailService } from './mail-service';
import { type Configuration } from './config';
import { type ErrorLogger } from './logger';
import { createTransport, type TransportFactory } from './transport';
export const MAIL_CONFIGURATION = Symbol('MAIL_CONFIGURATION');
export const MAIL_LOGGER = Symbol('MAIL_LOGGER');
export const MAIL_TRANSPORT_FACTORY = Symbol('MAIL_TRANSPORT_FACTORY');
@Module({})
export class MailModule {
  static register(config: Configuration, logger: ErrorLogger, factory: TransportFactory = createTransport): DynamicModule {
    return {
      module: MailModule,
      providers: [
        { provide: MAIL_CONFIGURATION, useValue: config },
        { provide: MAIL_LOGGER, useValue: logger },
        { provide: MAIL_TRANSPORT_FACTORY, useValue: factory },
        { provide: MailService, useFactory: (c: Configuration, l: ErrorLogger, f: TransportFactory) => new MailService(c, l, f),
          inject: [MAIL_CONFIGURATION, MAIL_LOGGER, MAIL_TRANSPORT_FACTORY] },
      ], exports: [MailService],
    };
  }
}
