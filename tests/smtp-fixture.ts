import { SMTPServer } from 'smtp-server';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
export async function certificates() {
  const directory = await mkdtemp(join(tmpdir(), 'mail-tls-'));
  const certPath = join(directory, 'cert.pem'), keyPath = join(directory, 'key.pem');
  const child = Bun.spawn(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', keyPath, '-out', certPath, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,DNS:smtp-fixture,IP:127.0.0.1'], { stdout: 'ignore', stderr: 'pipe' });
  if (await child.exited !== 0) throw new Error(await new Response(child.stderr).text());
  return { directory, certPath, keyPath, cert: await readFile(certPath), key: await readFile(keyPath), cleanup: () => rm(directory, { recursive: true, force: true }) };
}
export async function smtpFixture(options: { secure?: boolean; auth?: boolean; noStarttls?: boolean } = {}) {
  const tls = await certificates();
  let connections = 0, active = 0, maxActive = 0;
  const messages: string[] = [];
  const server = new SMTPServer({
    secure: options.secure ?? false, key: tls.key, cert: tls.cert,
    authOptional: !options.auth, ...(options.noStarttls ? { disabledCommands: ['STARTTLS'] } : {}),
    logger: false, onConnect(_session, done) { connections++; done(); },
    onAuth(auth, _session, done) {
      if (auth.username === 'user' && auth.password === 'pass') done(null, { user: 'user' });
      else done(new Error('Authentication denied'));
    },
    onData(stream, _session, done) {
      active++; maxActive = Math.max(maxActive, active); let text = '';
      stream.on('data', chunk => { text += chunk.toString(); });
      stream.on('end', () => { setTimeout(() => { messages.push(text); active--; done(); }, 10); });
    },
  });
  server.on('error', () => {});
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.server.address() as AddressInfo).port;
  return { ...tls, port, messages, get connections() { return connections; }, get maxActive() { return maxActive; },
    async close() { await new Promise<void>(resolve => server.close(() => resolve())); await tls.cleanup(); } };
}
