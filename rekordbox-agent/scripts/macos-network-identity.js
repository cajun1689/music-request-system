// Give each app executable a stable, private LC_UUID before signing. Stock
// Electron UUIDs are shared by unrelated apps, confusing macOS LAN consent.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function patchUUIDs(bytes, identity) {
  const result = Buffer.from(bytes);
  let changed = 0;
  function thin(start, length) {
    if (length < 32 || start < 0 || start + length > result.length) throw new Error('Invalid Mach-O slice');
    const magic = result.readUInt32LE(start);
    if (magic !== 0xfeedfacf && magic !== 0xfeedface) throw new Error('Unsupported Mach-O header');
    const count = result.readUInt32LE(start + 16), size = result.readUInt32LE(start + 20);
    const header = magic === 0xfeedfacf ? 32 : 28;
    const end = start + header + size;
    if (end > start + length) throw new Error('Invalid Mach-O commands');
    const cpu = result.readUInt32LE(start + 4), sub = result.readUInt32LE(start + 8);
    let cursor = start + header, found = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 8 > end) throw new Error('Truncated Mach-O command');
      const command = result.readUInt32LE(cursor), n = result.readUInt32LE(cursor + 4);
      if (n < 8 || cursor + n > end) throw new Error('Invalid Mach-O command size');
      if (command === 0x1b) {
        if (n !== 24) throw new Error('Invalid LC_UUID');
        const uuid = crypto.createHash('sha256').update(`djbridge-network-v1|${identity}|${cpu}|${sub}`).digest().subarray(0, 16);
        uuid[6] = (uuid[6] & 15) | 0x50; uuid[8] = (uuid[8] & 63) | 0x80;
        uuid.copy(result, cursor + 8); found++; changed++;
      }
      cursor += n;
    }
    if (found !== 1) throw new Error('Expected exactly one LC_UUID per executable slice');
  }
  const magic = result.readUInt32BE(0);
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const count = result.readUInt32BE(4), wide = magic === 0xcafebabf;
    if (count < 1 || count > 8 || 8 + count * (wide ? 32 : 20) > result.length) throw new Error('Invalid universal header');
    for (let i = 0; i < count; i++) {
      const at = 8 + i * (wide ? 32 : 20);
      const start = wide ? Number(result.readBigUInt64BE(at + 8)) : result.readUInt32BE(at + 8);
      const length = wide ? Number(result.readBigUInt64BE(at + 16)) : result.readUInt32BE(at + 12);
      thin(start, length);
    }
  } else thin(0, result.length);
  return { bytes: result, slices: changed };
}
async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const name = context.packager.appInfo.productFilename;
  const app = path.join(context.appOutDir, `${name}.app`);
  const appId = context.packager.appInfo.id;
  let patched = 0;
  function visit(directory) {
    for (const e of fs.readdirSync(directory, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const file = path.join(directory, e.name);
      if (e.isDirectory()) visit(file);
      else if (e.isFile() && path.basename(directory) === 'MacOS') {
        const original = fs.readFileSync(file);
        const result = patchUUIDs(original, `${appId}|${path.relative(app, file)}`);
        fs.writeFileSync(file, result.bytes); patched += result.slices;
      }
    }
  }
  visit(path.join(app, 'Contents'));
  if (!patched) throw new Error('No app executable identities were updated');
  console.log(`Assigned stable DJ Bridge network identities to ${patched} executable slices`);
}
module.exports = afterPack;
module.exports.patchUUIDs = patchUUIDs;
