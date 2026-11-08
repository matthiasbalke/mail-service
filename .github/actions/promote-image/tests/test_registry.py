"""Real registry tests with small synthetic OCI fixtures; no CPU emulation or builds."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import urllib.request
from urllib.parse import urlparse

ACTION = Path(__file__).resolve().parents[1]
MANIFEST = 'application/vnd.oci.image.manifest.v1+json'
INDEX = 'application/vnd.oci.image.index.v1+json'
SHA = 'a' * 40


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


class Registry:
    def __enter__(self):
        self.name = docker('run', '-d', '--rm', '-p', '127.0.0.1::5000', 'registry:2')
        port = docker('inspect', '--format', '{{(index (index .NetworkSettings.Ports "5000/tcp") 0).HostPort}}', self.name)
        self.image = f'localhost:{port}/test/image'
        self.base = f'http://localhost:{port}'
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            for _ in range(50):
                try:
                    self.request('/v2/')
                    return self
                except OSError:
                    time.sleep(.1)
            raise RuntimeError('Registry failed to start')
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *args):
        docker('rm', '-f', self.name)

    def request(self, path, method='GET', data=None, media=None):
        request = urllib.request.Request(self.base + path, data=data, method=method)
        if media:
            request.add_header('Content-Type', media)
        request.add_header('Accept', f'{INDEX}, {MANIFEST}')
        return self.http.open(request, timeout=10)

    def blob(self, data, media):
        digest = 'sha256:' + hashlib.sha256(data).hexdigest()
        response = self.request('/v2/test/image/blobs/uploads/', 'POST', b'')
        location = response.headers['Location']
        parsed = urlparse(location)
        path = parsed.path + '?' + parsed.query + '&digest=' + digest
        self.request(path, 'PUT', data, media).close()
        return {'mediaType': media, 'digest': digest, 'size': len(data)}

    def manifest(self, tag, data):
        raw = json.dumps(data, separators=(',', ':')).encode()
        self.request('/v2/test/image/manifests/' + tag, 'PUT', raw, data['mediaType']).close()
        return {'mediaType': data['mediaType'], 'digest': 'sha256:' + hashlib.sha256(raw).hexdigest(), 'size': len(raw)}

    def platform(self, arch):
        config = json.dumps({'architecture': arch, 'os': 'linux', 'config': {},
                             'rootfs': {'type': 'layers', 'diff_ids': []}}).encode()
        descriptor = self.manifest('fixture-' + arch, {
            'schemaVersion': 2, 'mediaType': MANIFEST,
            'config': self.blob(config, 'application/vnd.oci.image.config.v1+json'), 'layers': []})
        descriptor['platform'] = {'os': 'linux', 'architecture': arch}
        return descriptor

    def candidates(self, prefix):
        descriptors = []
        for arch in ['amd64', 'arm64']:
            platform = self.platform(arch)
            attestation = self.manifest('attestation-' + arch, {
                'schemaVersion': 2, 'mediaType': MANIFEST,
                'config': self.blob(b'{"architecture":"unknown","os":"unknown","rootfs":{"type":"layers","diff_ids":[]}}', 'application/vnd.oci.image.config.v1+json'),
                'layers': [self.blob(json.dumps({'_type': 'https://in-toto.io/Statement/v0.1', 'subject': [{'digest': {'sha256': platform['digest'].split(':')[1]}}]}).encode(), 'application/vnd.in-toto+json')]})
            attestation.update(platform={'os': 'unknown', 'architecture': 'unknown'}, annotations={
                'vnd.docker.reference.type': 'attestation-manifest',
                'vnd.docker.reference.digest': platform['digest']})
            descriptors.extend([platform, attestation])
            self.manifest(prefix + '-' + arch, {'schemaVersion': 2, 'mediaType': INDEX, 'manifests': [platform, attestation]})
        return descriptors

    def raw(self, tag):
        return self.request('/v2/test/image/manifests/' + tag).read()

    def inspect(self, tag):
        return json.loads(docker('buildx', 'imagetools', 'inspect', self.image + ':' + tag, '--format', '{{json .Manifest}}'))

    def promote(self, sha, destination, cwd=None):
        return subprocess.run(['bash', str(ACTION / 'promote.sh')], cwd=cwd,
                              env=dict(os.environ, IMAGE=self.image, SOURCE_SHA=sha, DESTINATION_TAG=destination),
                              text=True, capture_output=True)


class RealRegistry(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = Registry().__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.registry.__exit__(None, None, None)

    def test_manifest_index_and_conflicts(self):
        registry = self.registry
        single = registry.platform('amd64')
        raw = registry.raw('fixture-amd64')
        registry.request('/v2/test/image/manifests/sha-' + SHA, 'PUT', raw, MANIFEST).close()
        result = registry.promote(SHA, '1.2.3')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(registry.raw('1.2.3'), raw)
        self.assertEqual(registry.inspect('1.2.3')['digest'], single['digest'])
        self.assertEqual(registry.promote(SHA, '1.2.3').returncode, 0)
        self.assertNotEqual(registry.promote('f'*40, 'missing').returncode, 0)

        descriptors = registry.candidates('candidate')
        index = registry.manifest('sha-' + 'b'*40, {'schemaVersion': 2, 'mediaType': INDEX, 'manifests': descriptors})
        result = registry.promote('b'*40, '2.0.0-rc.1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(registry.inspect('2.0.0-rc.1')['digest'], index['digest'])
        self.assertEqual(registry.raw('2.0.0-rc.1'), registry.raw('sha-' + 'b'*40))
        self.assertEqual(len(json.loads(registry.raw('2.0.0-rc.1'))['manifests']), 4)
        self.assertNotEqual(registry.promote('b'*40, '1.2.3').returncode, 0)
        self.assertEqual(registry.raw('1.2.3'), raw)


if __name__ == '__main__':
    unittest.main()
