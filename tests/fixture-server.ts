// Standalone local-only SMTP sink used by the Docker smoke test.
import { SMTPServer } from 'smtp-server';
const server = new SMTPServer({
  secure: false, key: await Bun.file('/key.pem').text(), cert: await Bun.file('/cert.pem').text(),
  authOptional: false, logger: false,
  onAuth(auth, _session, done) {
    if (auth.username === 'user' && auth.password === 'pass') done(null, { user: 'user' });
    else done(new Error('Authentication denied'));
  },
  onData(stream, _session, done) {
    let message = '';
    stream.on('data', chunk => { message += chunk.toString(); });
    stream.on('end', () => {
      if (!message.includes('Fixture subject') || !message.includes('Fixture body')) return done(new Error('Unexpected message'));
      console.log('MESSAGE_ACCEPTED'); done();
    });
  },
});
server.listen(2525, '0.0.0.0', () => console.log('SMTP_READY'));
