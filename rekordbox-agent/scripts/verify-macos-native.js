// Read binary headers only. Never execute an Intel slice on an Apple Silicon Mac:
// doing that can register a Rosetta deprecation warning against the app bundle.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MACHO = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);

function auditNativeMac(appPath) {
  const root = path.resolve(appPath);
  if (!fs.statSync(root).isDirectory()) throw new Error('Expected an app bundle directory');
  const binaries = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue; // Framework aliases have real files under Versions/.
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) { visit(filename); continue; }
      if (!entry.isFile()) continue;
      const head = Buffer.alloc(4);
      const fd = fs.openSync(filename, 'r');
      try { fs.readSync(fd, head, 0, 4, 0); } finally { fs.closeSync(fd); }
      if (!MACHO.has(head.toString('hex'))) continue;
      const architectures = execFileSync('/usr/bin/lipo', ['-archs', filename], { encoding: 'utf8' }).trim().split(/\s+/);
      binaries.push({ file: path.relative(root, filename), architectures });
    }
  }
  visit(root);
  if (!binaries.length) throw new Error('No native binaries found in the app bundle');
  const incompatible = binaries.filter(binary => !binary.architectures.includes('arm64'));
  if (incompatible.length) throw new Error('Apple Silicon support missing: ' + incompatible.map(binary => binary.file).join(', '));
  return binaries;
}

module.exports = { auditNativeMac };
if (require.main === module) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node scripts/verify-macos-native.js APP_BUNDLE');
    const binaries = auditNativeMac(process.argv[2]);
    console.log(JSON.stringify({ passed: true, nativeBinaries: binaries.length, allSupportAppleSilicon: true }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
