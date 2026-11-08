"""Build-to-release contract against a real disposable registry and local Git remote."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import urllib.error

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / '.github/actions/promote-image/tests'))
from test_registry import Registry, SHA


class Publication(unittest.TestCase):
    def test_publication_gate_retry_and_release(self):
        with Registry() as registry, tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gh = root / 'gh'
            gh.write_text('#!/bin/sh\nprintf "%s\\n" "$TEST_MAIN_SHA"\n')
            gh.chmod(0o755)
            env = dict(os.environ, PATH=f'{root}:{os.environ["PATH"]}', IMAGE=registry.image,
                       GITHUB_SHA=SHA, GITHUB_REF='refs/heads/main', GITHUB_EVENT_NAME='push',
                       GITHUB_RUN_ID='123', GITHUB_RUN_ATTEMPT='1', GITHUB_REPOSITORY='example/image',
                       CHECKS_RESULT='success', NATIVE_RESULT='success', TEST_MAIN_SHA=SHA)

            def publish(**override):
                return subprocess.run(['bash', str(ROOT / 'scripts/publish-images.sh')],
                                      env=dict(env, **override), text=True, capture_output=True)

            prefix = 'candidate-' + SHA + '-123-1'
            descriptors = registry.candidates(prefix)
            # Candidate tags alone can never be promoted.
            self.assertNotEqual(registry.promote(SHA, '1.0.0').returncode, 0)
            for override in [{'NATIVE_RESULT': 'failure'}, {'CHECKS_RESULT': 'failure'},
                             {'GITHUB_EVENT_NAME': 'pull_request'}, {'GITHUB_REF': 'refs/tags/1.2.3'}]:
                self.assertNotEqual(publish(**override).returncode, 0)
            with self.assertRaises(urllib.error.HTTPError) as missing:
                registry.raw('sha-' + SHA)
            self.assertEqual(missing.exception.code, 404)
            missing.exception.close()
            result = publish()
            self.assertEqual(result.returncode, 0, result.stderr)
            verified = registry.inspect('sha-' + SHA)
            self.assertEqual(sorted(verified['manifests'], key=lambda x: x['digest']),
                             sorted(descriptors, key=lambda x: x['digest']))
            latest = registry.raw('latest')
            self.assertEqual(latest, registry.raw('sha-' + SHA))
            # Retry preserves the verified digest and needs no run-specific candidates.
            result = publish(GITHUB_RUN_ATTEMPT='2')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(registry.inspect('sha-' + SHA)['digest'], verified['digest'])
            other = 'c'*40
            registry.candidates('candidate-' + other + '-123-1')
            result = publish(GITHUB_SHA=other)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Skipping latest', result.stdout)
            self.assertEqual(registry.raw('latest'), latest)
            # A missing platform cannot publish a verified image.
            self.assertNotEqual(publish(GITHUB_SHA='d'*40).returncode, 0)
            with self.assertRaises(urllib.error.HTTPError) as missing:
                registry.raw('sha-' + 'd'*40)
            self.assertEqual(missing.exception.code, 404)
            missing.exception.close()

            # Resolve lightweight and annotated Git tags to the actual commit, then promote.
            repo = root / 'repo'
            repo.mkdir()
            def git(*args):
                return subprocess.check_output(['git', '-C', str(repo), *args], text=True, stderr=subprocess.DEVNULL).strip()
            git('init', '-b', 'main')
            git('config', 'user.email', 'test@example.invalid')
            git('config', 'user.name', 'Test')
            git('commit', '--allow-empty', '-m', 'fixture')
            commit = git('rev-parse', 'HEAD')
            git('remote', 'add', 'origin', str(repo))
            raw = registry.raw('sha-' + SHA)
            registry.request('/v2/test/image/manifests/sha-' + commit, 'PUT', raw,
                             'application/vnd.oci.image.index.v1+json').close()
            for tag, annotated in [('1.2.3', False), ('1.2.3-rc.1', True)]:
                git('tag', *(['-a', tag, '-m', 'release'] if annotated else [tag]))
                output = root / 'output'
                result = subprocess.run(['bash', str(ROOT / 'scripts/resolve-release.sh')], cwd=repo,
                                        env=dict(os.environ, RELEASE_TAG=tag, GITHUB_REF='refs/tags/' + tag,
                                                 GITHUB_SHA=commit, GITHUB_EVENT_NAME='push', GITHUB_OUTPUT=str(output)),
                                        text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('sha=' + commit, output.read_text())
                self.assertEqual(registry.promote(commit, tag).returncode, 0)
                self.assertEqual(registry.raw(tag), raw)
            for tag in ['v1.2.3', '01.2.3', '1.2', '1.2.3-01', '1.2.3+build.1', '1.2.3-rc..1']:
                result = subprocess.run(['bash', str(ROOT / 'scripts/resolve-release.sh')], cwd=repo,
                                        env=dict(os.environ, RELEASE_TAG=tag, GITHUB_REF='refs/tags/' + tag,
                                                 GITHUB_SHA=commit, GITHUB_EVENT_NAME='push'), capture_output=True)
                self.assertNotEqual(result.returncode, 0, tag)
            git('commit', '--allow-empty', '-m', 'moved')
            git('tag', '-f', '1.2.3')
            result = subprocess.run(['bash', str(ROOT / 'scripts/resolve-release.sh')], cwd=repo,
                                    env=dict(os.environ, RELEASE_TAG='1.2.3', GITHUB_REF='refs/tags/1.2.3',
                                             GITHUB_SHA=commit, GITHUB_EVENT_NAME='push'), text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('may have moved', result.stderr)


if __name__ == '__main__':
    unittest.main()
