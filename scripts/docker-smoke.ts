import { certificates } from '../tests/smtp-fixture';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const image = process.argv[2] ?? 'mail-service:local';
const id = `mail-smoke-${process.pid}-${Date.now()}`;
const fixture = `${id}-smtp`, app = `${id}-app`, invalid = `${id}-invalid`;
const tls = await certificates();
async function docker(...args: string[]): Promise<string> {
  const child = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`docker ${args[0]} failed: ${error}`);
  return output.trim();
}
async function until(predicate: () => Promise<boolean>, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await Bun.sleep(250); }
  throw new Error('Docker smoke check timed out');
}
try {
  const built = await Bun.build({ entrypoints: ['tests/fixture-server.ts'], target: 'bun', outdir: tls.directory });
  assert(built.success);
  await docker('network', 'create', id);
  await docker('volume', 'create', `${id}-ca`);
  // The fixture runs the same pinned Bun runtime but contains no production credentials.
  // Root is used only by this test sink to read its generated key; the app retains its image user.
  await docker('create', '--name', fixture, '--user', '0:0', '--mount', `type=volume,source=${id}-ca,target=/trust`, '--network', id, '--network-alias', 'smtp-fixture', '--entrypoint', '/usr/local/bin/bun', image, '/fixture-server.js');
  await docker('cp', join(tls.directory, 'fixture-server.js'), `${fixture}:/fixture-server.js`);
  await docker('cp', tls.certPath, `${fixture}:/cert.pem`);
  await docker('cp', tls.certPath, `${fixture}:/trust/ca.pem`); await docker('cp', tls.keyPath, `${fixture}:/key.pem`);
  await docker('start', fixture);
  await until(async () => (await docker('logs', fixture)).includes('SMTP_READY'), 10000);
  await docker('create', '--name', invalid, image); await docker('start', invalid);
  assert.equal(await docker('wait', invalid), '1');
  const config = {
    SMTP_PROFILES: 'primary', SMTP_DEFAULT_PROFILE: 'primary',
    SMTP_PRIMARY_HOST: 'smtp-fixture', SMTP_PRIMARY_PORT: '2525', SMTP_PRIMARY_SECURITY: 'starttls',
    SMTP_PRIMARY_FROM: 'sender@example.test', SMTP_PRIMARY_FROM_NAME: 'Fixture', SMTP_PRIMARY_USER: 'user', SMTP_PRIMARY_PASSWORD: 'pass',
    MAIL_TO: 'recipient@example.test', MAIL_SUBJECT: 'Fixture subject', MAIL_TEXT: 'Fixture body', NODE_EXTRA_CA_CERTS: '/trust/ca.pem',
  };
  await docker('create', '--name', app, '--mount', `type=volume,source=${id}-ca,target=/trust,readonly`, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--network', id, ...Object.entries(config).flatMap(([key, value]) => ['-e', `${key}=${value}`]), image);
  await docker('start', app);
  const inspected = JSON.parse(await docker('inspect', app))[0];
  assert.equal(inspected.Config.User, '65532:65532');
  assert.equal(inspected.Config.ExposedPorts, undefined);
  const runtime = JSON.parse(await docker('exec', app, '/usr/local/bin/bun', '-e', `const fs=require('fs'); console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),ca:fs.existsSync('/etc/ssl/certs/ca-certificates.crt'),tests:fs.existsSync('/app/tests'),tsc:fs.existsSync('/app/node_modules/typescript'),files:fs.readdirSync('/app')}))`));
  assert.equal(runtime.uid, 65532); assert.equal(runtime.gid, 65532); assert.equal(runtime.ca, true);
  assert.equal(runtime.tests, false); assert.equal(runtime.tsc, false);
  await until(async () => (await docker('logs', fixture)).includes('MESSAGE_ACCEPTED'), 35000);
  const started = Date.now(); await docker('stop', '--time', '15', app);
  assert(Date.now() - started < 15000); assert.equal(await docker('wait', app), '0');
  const size = JSON.parse(await docker('image', 'inspect', image))[0].Size;
  console.log(`Docker smoke passed: UID/GID 65532:65532, verified STARTTLS delivery, clean SIGTERM, image ${(size / 1024 / 1024).toFixed(1)} MiB (${size} bytes)`);
} finally {
  for (const name of [app, fixture, invalid]) await docker('rm', '-f', name).catch(() => {});
  await docker('network', 'rm', id).catch(() => {});
  await docker('volume', 'rm', `${id}-ca`).catch(() => {});
  await tls.cleanup();
}
