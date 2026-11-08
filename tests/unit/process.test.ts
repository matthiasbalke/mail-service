import { test, expect } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { env } from '../helpers';

for (const signal of ['SIGTERM', 'SIGINT'] as const) test(`source main terminates on ${signal} while waiting`, async () => {
  const child = Bun.spawn([process.execPath, '--eval', 'import { main } from "./src/main"; const running = main(); console.log("READY"); await running;'], { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' });
  try {
    const ready = await Promise.race([child.stdout.getReader().read(), Bun.sleep(5000).then(() => { throw new Error('startup timeout'); })]);
    expect(new TextDecoder().decode(ready.value)).toContain('READY');
    await Bun.sleep(50); expect(child.exitCode).toBeNull(); child.kill(signal);
    expect(await Promise.race([child.exited, Bun.sleep(2000).then(() => 'timeout')])).toBe(0);
    expect(await new Response(child.stderr).text()).toBe('');
  } finally { child.kill('SIGKILL'); }
}, 8000);

test('invalid startup emits error-level console output only and no files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mail-logs-'));
  try {
    const child = Bun.spawn([process.execPath, resolve('src/main.ts')], { cwd: directory, env: { PATH: process.env.PATH, SMTP_PRIMARY_PASSWORD: 'never-log-me' }, stdout: 'pipe', stderr: 'pipe' });
    expect(await child.exited).toBe(1);
    const stderr = await new Response(child.stderr).text();
    expect(stderr).toContain('ERROR'); expect(stderr).toContain('CONFIGURATION'); expect(stderr).not.toContain('never-log-me');
    expect(await new Response(child.stdout).text()).toBe(''); expect(await readdir(directory)).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
