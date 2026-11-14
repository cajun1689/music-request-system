// Run with the packaged Electron runtime and its matching rebuilt native module.
// Uses only a temporary synthetic history database; never opens a real Serato library.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3-multiple-ciphers');
const { LightingSeratoReader } = require('../dist/main/lighting-serato');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-bridge-sqlite-'));
  const filename = path.join(directory, 'history.sqlite');
  const writer = new Database(filename);
  const events = [];
  const reader = new LightingSeratoReader(key => events.push(key), undefined, filename);
  try {
    writer.exec('CREATE TABLE history_session(id INTEGER PRIMARY KEY); CREATE TABLE history_entry(id INTEGER PRIMARY KEY, session_id INTEGER, played INTEGER); INSERT INTO history_session VALUES(1); INSERT INTO history_entry VALUES(1,1,1);');
    await reader.poll();
    assert.deepEqual(events, []);
    assert.equal(reader.currentTrackKey(), 'serato:1:1');
    writer.exec('INSERT INTO history_entry VALUES(2,1,0)');
    await reader.poll();
    assert.deepEqual(events, []);
    writer.exec('UPDATE history_entry SET played=1 WHERE id=2; INSERT INTO history_entry VALUES(3,1,0)');
    await reader.poll();
    assert.deepEqual(events, ['serato:1:2']);
    assert.equal(reader.currentTrackKey(), 'serato:1:3');
    await reader.poll();
    assert.equal(events.length, 1);
    assert.throws(() => reader.db.exec('DELETE FROM history_entry'), /readonly|read.only/i);
    reader.close();
    assert.equal(reader.db, null);
    console.log(JSON.stringify({ passed: true, electron: process.versions.electron, checked: 'readonly Serato history, loaded-track suppression, exact played identity, cleanup' }));
  } finally {
    reader.close(); writer.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
