export class MailServiceError extends Error {
  constructor(public readonly code: 'CONFIGURATION' | 'VALIDATION' | 'CAPACITY' | 'PROFILE' | 'SHUTDOWN', message: string, public readonly setting?: string) {
    super(message);
    this.name = 'MailServiceError';
  }
}
export class CapacityError extends MailServiceError {
  constructor() { super('CAPACITY', 'SMTP profile pending capacity reached'); }
}
export class ShutdownError extends MailServiceError {
  constructor() { super('SHUTDOWN', 'SMTP sender is shutting down'); }
}
