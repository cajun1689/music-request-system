const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { auditNativeMac } = require('../scripts/verify-macos-native');

test('release check rejects Intel-only helpers without executing them', { skip: process.platform !== 'darwin' }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-architecture-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const helper = path.join(directory, 'Receiver');
  const original = path.resolve('resources/lighting/DJLightingReceiver');
  execFileSync('/usr/bin/lipo', [original, '-thin', 'arm64', '-output', helper]);
  assert.equal(auditNativeMac(directory).length, 1);
  fs.unlinkSync(helper);
  execFileSync('/usr/bin/lipo', [original, '-thin', 'x86_64', '-output', helper]);
  assert.throws(() => auditNativeMac(directory), /Apple Silicon support missing: Receiver/);
  fs.unlinkSync(helper);
  assert.throws(() => auditNativeMac(directory), /No native binaries/);
});
