import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ACTION = Path(__file__).resolve().parents[1]
SHA = 'a' * 40
DIGEST = 'sha256:' + 'b' * 64
IMAGE = 'ghcr.io/example/image'
MANIFEST = {'digest': DIGEST, 'mediaType': 'application/vnd.oci.image.index.v1+json'}

# Implements only the Docker boundary; every policy decision executes the real action.
DOCKER = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
state = Path(os.environ['REGISTRY_STATE'])
data = json.loads(state.read_text())
args = sys.argv[1:]
with open(os.environ['CALL_LOG'], 'a') as log: log.write(json.dumps(args) + '\\n')
if args[:3] == ['buildx', 'imagetools', 'inspect']:
    item = data.get(args[3])
    if isinstance(item, str):
        print(item, file=sys.stderr); sys.exit(1)
    if item is None:
        print('ERROR: manifest unknown', file=sys.stderr); sys.exit(1)
    print(json.dumps(item)); sys.exit(0)
if args[:3] == ['buildx', 'imagetools', 'create']:
    assert '--prefer-index=false' in args
    destination = args[args.index('--tag') + 1]
    source = args[-1]
    assert '@sha256:' in source
    data[destination] = data[source]
    if os.environ.get('MISMATCH'): data[destination] = dict(data[source], digest='sha256:' + 'c'*64)
    state.write_text(json.dumps(data)); sys.exit(0)
raise Exception('Unexpected Docker command: ' + repr(args))
'''


class Promotion(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.action = self.root / 'standalone-action'
        shutil.copytree(ACTION, self.action)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        (self.bin / 'docker').write_text(DOCKER)
        (self.bin / 'docker').chmod(0o755)
        self.state = self.root / 'registry.json'
        self.log = self.root / 'calls'
        self.output = self.root / 'output'
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}',
                        REGISTRY_STATE=str(self.state), CALL_LOG=str(self.log),
                        IMAGE=IMAGE, SOURCE_SHA=SHA, DESTINATION_TAG='1.2.3',
                        GITHUB_OUTPUT=str(self.output), GITHUB_STEP_SUMMARY=str(self.root / 'summary'))
        self.data = {f'{IMAGE}:sha-{SHA}': MANIFEST, f'{IMAGE}@{DIGEST}': MANIFEST}

    def run_action(self, **overrides):
        self.state.write_text(json.dumps(self.data))
        return subprocess.run(['bash', str(self.action / 'promote.sh')],
                              cwd=self.root, env=dict(self.env, **overrides), text=True, capture_output=True)

    def writes(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()
                if json.loads(line)[2] == 'create'] if self.log.exists() else []

    def test_standalone_copy_and_outputs(self):
        result = self.run_action()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f'digest={DIGEST}', self.output.read_text())
        self.assertIn(f'image={IMAGE}@{DIGEST}', self.output.read_text())
        self.assertEqual(len(self.writes()), 1)
        self.assertEqual(self.writes()[0][-1], f'{IMAGE}@{DIGEST}')
        self.assertIn('github.action_path', (self.action / 'action.yml').read_text())

    def test_repeat_is_noop(self):
        self.data[f'{IMAGE}:1.2.3'] = MANIFEST
        self.assertEqual(self.run_action().returncode, 0)
        self.assertEqual(self.writes(), [])

    def test_conflict_preserved(self):
        self.data[f'{IMAGE}:1.2.3'] = dict(MANIFEST, digest='sha256:' + 'c'*64)
        self.assertNotEqual(self.run_action().returncode, 0)
        self.assertEqual(self.writes(), [])
        self.assertEqual(json.loads(self.state.read_text()), self.data)

    def test_invalid_inputs_before_docker(self):
        for override in [{'IMAGE': ''}, {'IMAGE': IMAGE + ':tag'}, {'IMAGE': 'x/$(id)'},
                         {'SOURCE_SHA': 'abc'}, {'SOURCE_SHA': SHA.upper()},
                         {'DESTINATION_TAG': ''}, {'DESTINATION_TAG': '1.2.3+build'},
                         {'DESTINATION_TAG': 'x'*129}, {'DESTINATION_TAG': '-option'}]:
            with self.subTest(override=override):
                self.assertNotEqual(self.run_action(**override).returncode, 0)
                self.assertFalse(self.log.exists())

    def test_source_missing(self):
        del self.data[f'{IMAGE}:sha-{SHA}']
        result = self.run_action()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Complete main publication', result.stderr)
        self.assertEqual(self.writes(), [])

    def test_registry_errors_never_mean_absence(self):
        for ref in [f'{IMAGE}:sha-{SHA}', f'{IMAGE}:1.2.3']:
            for error in ['unauthorized: not found', 'denied: manifest unknown',
                          'forbidden', 'context deadline exceeded', 'connection reset', 'HTTP 500']:
                with self.subTest(ref=ref, error=error):
                    original = self.data.copy()
                    self.data[ref] = error
                    self.assertNotEqual(self.run_action().returncode, 0)
                    self.assertEqual(self.writes(), [])
                    self.data = original

    def test_malformed_manifest(self):
        self.data[f'{IMAGE}:sha-{SHA}'] = {'digest': 'invalid', 'mediaType': MANIFEST['mediaType']}
        self.assertNotEqual(self.run_action().returncode, 0)
        self.assertEqual(self.writes(), [])

    def test_post_copy_mismatch_fails(self):
        self.assertNotEqual(self.run_action(MISMATCH='1').returncode, 0)
        self.assertFalse(self.output.exists())

    def test_single_platform_supported(self):
        manifest = dict(MANIFEST, mediaType='application/vnd.oci.image.manifest.v1+json')
        self.data = {f'{IMAGE}:sha-{SHA}': manifest, f'{IMAGE}@{DIGEST}': manifest}
        self.assertEqual(self.run_action().returncode, 0)

    def test_custom_destination_tag(self):
        self.assertEqual(self.run_action(DESTINATION_TAG='custom-release').returncode, 0)


if __name__ == '__main__':
    unittest.main()
