const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { patchUUIDs } = require('../scripts/macos-network-identity');
function thin(cpu) {
  const b = Buffer.alloc(56); b.writeUInt32LE(0xfeedfacf); b.writeUInt32LE(cpu,4);
  b.writeUInt32LE(1,16);b.writeUInt32LE(24,20);b.writeUInt32LE(0x1b,32);b.writeUInt32LE(24,36);return b;
}
test('network UUID is stable across releases, separate for each app, helper and CPU',()=>{
  const b=thin(0x100000c), a=patchUUIDs(b,'com.casperrequests.dj-bridge|main');
  assert.equal(a.slices,1);assert.deepEqual(a.bytes,patchUUIDs(a.bytes,'com.casperrequests.dj-bridge|main').bytes);
  assert.notDeepEqual(a.bytes,patchUUIDs(b,'other-app|main').bytes);
  assert.notDeepEqual(a.bytes,patchUUIDs(b,'com.casperrequests.dj-bridge|helper').bytes);
  assert.notDeepEqual(a.bytes.subarray(40),patchUUIDs(thin(0x1000007),'com.casperrequests.dj-bridge|main').bytes.subarray(40));
  assert.deepEqual(a.bytes.subarray(0,40),b.subarray(0,40));
});
test('both universal slices get independent identities; malformed commands fail closed',()=>{
 const b=Buffer.alloc(176);b.writeUInt32BE(0xcafebabe);b.writeUInt32BE(2,4);
 b.writeUInt32BE(64,16);b.writeUInt32BE(56,20);b.writeUInt32BE(120,36);b.writeUInt32BE(56,40);
 thin(0x1000007).copy(b,64);thin(0x100000c).copy(b,120);
 const a=patchUUIDs(b,'bridge');assert.equal(a.slices,2);assert.deepEqual(a.bytes.subarray(0,64),b.subarray(0,64));
 assert.notDeepEqual(a.bytes.subarray(104,120),a.bytes.subarray(160,176));
 const bad=thin(1);bad.writeUInt32LE(100,36);assert.throws(()=>patchUUIDs(bad,'bridge'),/size/);
});
test('real bundled receiver Mach-O remains structurally valid after identity patching', {skip:process.platform!=='darwin'},()=>{
 const b=fs.readFileSync('resources/lighting/DJLightingReceiver'); const a=patchUUIDs(b,'test-receiver');
 assert.equal(a.slices,2);assert.equal(a.bytes.length,b.length);
 assert.deepEqual(patchUUIDs(a.bytes,'test-receiver').bytes,a.bytes);
});
