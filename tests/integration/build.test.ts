import { test, expect } from 'bun:test';
import { env } from '../helpers';

test('production API is importable without starting application', async () => {
  const builtPath = '../../dist/index.js';
  const api = await import(builtPath);
  expect(typeof api.MailService).toBe('function');
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) test(`built main terminates on ${signal}`, async () => {
  const child = Bun.spawn([process.execPath, '--eval', 'const { main } = await import("./dist/main.js"); const running = main(); console.log("READY"); await running;'], { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' });
  try {
    const ready = await Promise.race([child.stdout.getReader().read(), Bun.sleep(5000).then(() => { throw new Error('startup timeout'); })]);
    expect(new TextDecoder().decode(ready.value)).toContain('READY');
    await Bun.sleep(50); expect(child.exitCode).toBeNull(); child.kill(signal);
    expect(await Promise.race([child.exited, Bun.sleep(2000).then(() => 'timeout')])).toBe(0);
    expect(await new Response(child.stderr).text()).toBe('');
  } finally { child.kill('SIGKILL'); }
}, 8000);
