const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'darwin') { console.log('Native lighting receiver is built on macOS packaging hosts.'); process.exit(0); }
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'native/DJLightingReceiver.swift');
const header = path.join(root, 'native/Lighting-Bridging-Header.h');
const output = path.join(root, 'resources/lighting/DJLightingReceiver');
const cache = path.join(root, '.lighting-build');
const hash = crypto.createHash('sha256').update(fs.readFileSync(source)).update(fs.readFileSync(header)).digest('hex');
fs.mkdirSync(cache, { recursive: true });
if (fs.existsSync(output) && fs.existsSync(path.join(cache, 'hash')) && fs.readFileSync(path.join(cache, 'hash'), 'utf8') === hash) process.exit(0);
const sdk = execFileSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' }).trim();
const pieces = [];
for (const arch of ['arm64', 'x86_64']) {
 const target = path.join(cache, `receiver-${arch}`); pieces.push(target);
 execFileSync('/usr/bin/xcrun', ['swiftc', source, '-sdk', sdk, '-target', `${arch}-apple-macos11.0`, '-O', '-module-cache-path', path.join(cache, 'modules'), '-import-objc-header', header, '-framework', 'AppKit', '-framework', 'CoreMIDI', '-lpcap', '-o', target], { stdio: 'inherit' });
}
execFileSync('/usr/bin/lipo', ['-create', ...pieces, '-output', output]);
fs.chmodSync(output, 0o755); fs.writeFileSync(path.join(cache, 'hash'), hash);
execFileSync(output, ['--self-test'], { stdio: 'inherit' });
