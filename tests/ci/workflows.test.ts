import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const ci = parse(readFileSync('.github/workflows/ci.yaml', 'utf8'));
const release = parse(readFileSync('.github/workflows/promote-images.yaml', 'utf8'));
const action = parse(readFileSync('.github/actions/promote-image/action.yml', 'utf8'));

test('native matrix builds on real architectures and gates publication', () => {
  expect(ci.on.push).toEqual({ branches: ['main'] });
  expect(ci.on).toHaveProperty('pull_request');
  expect(ci.jobs.native.strategy.matrix.include).toEqual([
    { architecture: 'amd64', runner: 'ubuntu-24.04' },
    { architecture: 'arm64', runner: 'ubuntu-24.04-arm' },
  ]);
  expect(ci.jobs.native['runs-on']).toBe('${{ matrix.runner }}');
  expect(ci.jobs.native.needs).toBe('validate');
  expect(ci.jobs.publish.needs).toEqual(['validate', 'native']);
  expect(ci.jobs.publish.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
  expect(ci.jobs.publish.concurrency['cancel-in-progress']).toBe(false);
  expect(ci.jobs.publish.steps.some((step: any) => step.uses?.includes('build-push'))).toBe(false);
  expect(JSON.stringify(ci)).not.toContain('qemu');
});

test('PR builds load locally; main builds push candidates and smoke-test by digest', () => {
  const steps = ci.jobs.native.steps;
  const login = steps.find((step: any) => step.uses?.includes('login-action'));
  const build = steps.find((step: any) => step.id === 'build');
  expect(login.if).toBe(ci.jobs.publish.if);
  expect(build.with.push).toBe("${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}");
  expect(build.with.load).toBe("${{ github.event_name == 'pull_request' }}");
  expect(build.with['cache-to']).toContain('scope=image-${{ matrix.architecture }}');
  expect(build.with.platforms).toBe('linux/${{ matrix.architecture }}');
  const smoke = steps.find((step: any) => step.name === 'Smoke-test exact native image');
  expect(smoke.env.DIGEST).toBe('${{ steps.build.outputs.digest }}');
  expect(smoke.run).toContain('reference="$IMAGE@$DIGEST"');
  expect(smoke.run).toContain('docker pull "$reference"');
  expect(smoke.run).toContain('bun scripts/docker-smoke.ts "$reference"');
});

test('tag promotion executes main automation after strict version resolution', () => {
  expect(release.on).toEqual({ push: { tags: ['[0-9]*.[0-9]*.[0-9]*'] } });
  const job = release.jobs.promote;
  expect(job.permissions).toEqual({ contents: 'read', packages: 'write' });
  expect(job.concurrency['cancel-in-progress']).toBe(false);
  expect(job.steps[0].with).toEqual({ ref: 'main', 'persist-credentials': false });
  const resolve = job.steps.findIndex((step: any) => step.id === 'release');
  const login = job.steps.findIndex((step: any) => step.uses?.includes('login-action'));
  expect(resolve).toBeLessThan(login);
  const promote = job.steps.at(-1);
  expect(promote.uses).toBe('./.github/actions/promote-image');
  expect(promote.with['source-sha']).toBe('${{ steps.release.outputs.sha }}');
  expect(promote.with['destination-tag']).toBe('${{ github.ref_name }}');
  expect(JSON.stringify(release)).not.toContain('build-push-action');
});

test('composite action uses its own path and exposes the public contract', () => {
  expect(Object.keys(action.inputs).sort()).toEqual(['destination-tag', 'image', 'source-sha']);
  expect(Object.keys(action.outputs).sort()).toEqual(['digest', 'image']);
  expect(action.runs.using).toBe('composite');
  expect(action.runs.steps[0].env.ACTION_PATH).toBe('${{ github.action_path }}');
});

test('all workflow action dependencies are pinned', () => {
  for (const workflow of [ci, release]) {
    for (const job of Object.values(workflow.jobs) as any[]) {
      for (const step of job.steps) {
        if (step.uses && !step.uses.startsWith('./')) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      }
    }
  }
});
