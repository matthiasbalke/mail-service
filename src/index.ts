export { MailService, type MailMessage } from './mail-service';
export { MailModule } from './mail-module';
export { parseConfiguration, parseRecurring, type Configuration, type Profile, type Sender } from './config';
export { createLogger, type ErrorLogger } from './logger';
export { CapacityError, ShutdownError, MailServiceError } from './errors';
export { type MailTransport, type TransportFactory, type SubmissionResult } from './transport';
