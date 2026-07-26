const test = require("node:test");
const assert = require("node:assert/strict");
const dgram = require("node:dgram");

const {
  ShowKontrolPlaybackState,
  TCNET_LAYER_PLAYING,
  TCNET_ON_AIR_UNKNOWN,
} = require("../dist/main/showkontrol-state.js");
const {
  buildTCNetMetadataRequest,
  buildTCNetOptInPacket,
  listShowKontrolNetworkInterfaces,
  parseTCNetMetadataPacket,
  ShowKontrolReader,
} = require("../dist/main/showkontrol-reader.js");

function statusLayer(overrides = {}) {
  return {
    source: 1,
    status: TCNET_LAYER_PLAYING,
    trackID: 101,
    name: "CDJ 1",
    ...overrides,
  };
}

function timeLayer(overrides = {}) {
  return {
    currentTimeMillis: 15_000,
    totalTimeMillis: 180_000,
    state: TCNET_LAYER_PLAYING,
    onAir: 1,
    ...overrides,
  };
}

function readyState(confirmMs = 10_000, fallbackMs = 45_000) {
  const state = new ShowKontrolPlaybackState(confirmMs, fallbackMs);
  state.applyStatus([statusLayer()], 0);
  state.applyMetadata(0, {
    trackID: 101,
    title: "One More Time",
    artist: "Daft Punk",
  }, 0);
  return state;
}

function writeUtf32Le(buffer, value, offset, byteLength) {
  let cursor = offset;
  for (const character of value) {
    if (cursor + 4 > offset + byteLength) break;
    buffer.writeUInt32LE(character.codePointAt(0), cursor);
    cursor += 4;
  }
}

test("builds valid TCNet discovery and metadata request packets", () => {
  const optIn = buildTCNetOptInPacket(65123, 42, 9, 120);
  assert.equal(optIn.length, 68);
  assert.equal(optIn.readUInt16LE(0), 42);
  assert.equal(optIn.subarray(4, 7).toString("ascii"), "TCN");
  assert.equal(optIn.readUInt8(7), 2);
  assert.equal(optIn.readUInt8(17), 4);
  assert.equal(optIn.readUInt16LE(26), 65123);
  assert.equal(optIn.readUInt8(64), 1);
  assert.equal(optIn.readUInt8(65), 12);

  const request = buildTCNetMetadataRequest(2, 42, 10);
  assert.equal(request.length, 26);
  assert.equal(request.readUInt8(7), 20);
  assert.equal(request.readUInt8(24), 4);
  assert.equal(request.readUInt8(25), 3, "wire layer IDs are one-based");
});

test("decodes TCNet 3.5 UTF-32 metadata", () => {
  const packet = Buffer.alloc(548);
  packet.writeUInt8(4, 24);
  packet.writeUInt8(2, 25);
  writeUtf32Le(packet, "Beyoncé", 29, 256);
  writeUtf32Le(packet, "CUFF IT", 285, 256);
  packet.writeUInt32LE(777, 543);

  assert.deepEqual(parseTCNetMetadataPacket(packet, 5), {
    layerIndex: 1,
    metadata: {
      artist: "Beyoncé",
      title: "CUFF IT",
      trackID: 777,
    },
  });
});

test("decodes legacy UTF-8 metadata", () => {
  const packet = Buffer.alloc(291);
  packet.writeUInt8(4, 24);
  packet.writeUInt8(1, 25);
  packet.write("Prince\0", 29, "utf8");
  packet.write("1999\0", 157, "utf8");
  packet.writeUInt32LE(88, 287);

  assert.deepEqual(parseTCNetMetadataPacket(packet, 4), {
    layerIndex: 0,
    metadata: {
      artist: "Prince",
      title: "1999",
      trackID: 88,
    },
  });
});

test("does not confirm a loaded or cue-only deck", () => {
  const state = readyState();
  assert.deepEqual(state.applyTime([timeLayer({ onAir: 0 })], 0), []);
  assert.deepEqual(state.applyTime([timeLayer({ onAir: 0 })], 20_000), []);
  assert.equal(state.snapshot()[0].confirmationStartedAt, null);
});

test("confirms a continuously on-air track exactly once", () => {
  const state = readyState();
  assert.deepEqual(state.applyTime([timeLayer()], 1_000), []);
  assert.deepEqual(state.applyTime([timeLayer()], 10_999), []);

  const confirmed = state.applyTime([timeLayer()], 11_000);
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].title, "One More Time");
  assert.equal(confirmed[0].artist, "Daft Punk");
  assert.equal(confirmed[0].playbackConfirmed, true);
  assert.equal(confirmed[0].sourceLayer, 0);
  assert.deepEqual(state.applyTime([timeLayer()], 30_000), []);
});

test("uses the conservative fallback when on-air is unavailable", () => {
  const state = readyState(10_000, 45_000);
  const unknown = timeLayer({ onAir: TCNET_ON_AIR_UNKNOWN });
  assert.deepEqual(state.applyTime([unknown], 1_000), []);
  assert.deepEqual(state.applyTime([unknown], 11_000), []);
  assert.equal(state.applyTime([unknown], 46_000).length, 1);
});

test("ignores stale metadata from a previously loaded track", () => {
  const state = readyState();
  state.applyStatus([statusLayer({ trackID: 202 })], 1_000);
  const accepted = state.applyMetadata(0, {
    trackID: 101,
    title: "Old Track",
    artist: "Old Artist",
  }, 2_000);
  assert.equal(accepted, false);
  assert.equal(state.snapshot()[0].title, "");
  assert.deepEqual(state.metadataNeeded(), [0]);
});

test("confirms the incoming deck during a two-deck crossfade without duplicating the outgoing deck", () => {
  const state = new ShowKontrolPlaybackState(10_000, 45_000);
  state.applyStatus([
    statusLayer({ trackID: 101, name: "CDJ 1" }),
    statusLayer({ trackID: 202, name: "CDJ 2", source: 2 }),
  ], 0);
  state.applyMetadata(0, { trackID: 101, title: "Track A", artist: "Artist A" }, 0);
  state.applyMetadata(1, { trackID: 202, title: "Track B", artist: "Artist B" }, 0);

  state.applyTime([timeLayer(), timeLayer({ onAir: 0 })], 0);
  const first = state.applyTime([timeLayer(), timeLayer({ onAir: 0 })], 10_000);
  assert.deepEqual(first.map((track) => track.title), ["Track A"]);

  state.applyTime([timeLayer(), timeLayer()], 20_000);
  const incoming = state.applyTime([timeLayer(), timeLayer()], 30_000);
  assert.deepEqual(incoming.map((track) => track.title), ["Track B"]);
  assert.deepEqual(state.applyTime([timeLayer({ onAir: 0 }), timeLayer()], 40_000), []);
});

function writeHeader(buffer, type, nodeId = 900) {
  buffer.writeUInt16LE(nodeId, 0);
  buffer.writeUInt8(3, 2);
  buffer.writeUInt8(5, 3);
  buffer.write("TCN", 4, 3, "ascii");
  buffer.writeUInt8(type, 7);
  buffer.write("SHOW", 8, 8, "ascii");
  buffer.writeUInt8(1, 16);
  buffer.writeUInt8(2, 17);
}

function fakeMasterOptIn(listenerPort) {
  const packet = Buffer.alloc(68);
  writeHeader(packet, 2);
  packet.writeUInt16LE(listenerPort, 26);
  packet.write("TC-SUPPLY", 32, 16, "ascii");
  packet.write("SHOWKONTROL", 48, 16, "ascii");
  packet.writeUInt8(1, 64);
  packet.writeUInt8(0, 65);
  packet.writeUInt8(0, 66);
  return packet;
}

function fakeStatus(listenerPort) {
  const packet = Buffer.alloc(300);
  writeHeader(packet, 5);
  packet.writeUInt16LE(listenerPort, 26);
  packet.writeUInt8(1, 34);
  packet.writeUInt8(TCNET_LAYER_PLAYING, 42);
  packet.writeUInt32LE(505, 50);
  packet.write("CDJ 1", 172, 16, "ascii");
  return packet;
}

function fakeMetadata() {
  const packet = Buffer.alloc(548);
  writeHeader(packet, 200);
  packet.writeUInt8(4, 24);
  packet.writeUInt8(1, 25);
  writeUtf32Le(packet, "Daft Punk", 29, 256);
  writeUtf32Le(packet, "One More Time", 285, 256);
  packet.writeUInt32LE(505, 543);
  return packet;
}

function fakeTime() {
  const packet = Buffer.alloc(162);
  writeHeader(packet, 254);
  packet.writeUInt32LE(15_000, 24);
  packet.writeUInt32LE(180_000, 56);
  packet.writeUInt8(TCNET_LAYER_PLAYING, 96);
  packet.writeUInt8(1, 154);
  return packet;
}

function bindUdp(socket, port, address) {
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("listening", resolve);
    socket.bind(port, address);
  });
}

function sendUdp(socket, packet, port, address) {
  return new Promise((resolve, reject) => {
    socket.send(packet, port, address, (error) => error ? reject(error) : resolve());
  });
}

function closeUdp(socket) {
  return new Promise((resolve) => {
    try {
      socket.close(resolve);
    } catch {
      resolve();
    }
  });
}

test("receives discovery, metadata, and on-air playback over real UDP sockets", async (t) => {
  if (listShowKontrolNetworkInterfaces().length === 0) {
    t.skip("No active non-loopback IPv4 interface");
    return;
  }

  const master = dgram.createSocket("udp4");
  await bindUdp(master, 0, "127.0.0.1");
  const masterPort = master.address().port;
  const logs = [];
  let resolveTrack;
  const trackPromise = new Promise((resolve) => {
    resolveTrack = resolve;
  });

  const reader = new ShowKontrolReader({
    confirmationSeconds: 0,
    fallbackConfirmationSeconds: 1,
    onTrack: resolveTrack,
  }, {
    info: (...args) => logs.push(["info", ...args]),
    warn: (...args) => logs.push(["warn", ...args]),
    error: (...args) => logs.push(["error", ...args]),
  });

  master.on("message", (message, remote) => {
    if (message.length >= 26 && message.readUInt8(7) === 20 && message.readUInt8(24) === 4) {
      master.send(fakeMetadata(), remote.port, remote.address);
    }
  });

  try {
    await reader.start();
    await sendUdp(master, fakeMasterOptIn(masterPort), 60_000, "127.0.0.1");
    await sendUdp(master, fakeStatus(masterPort), 60_000, "127.0.0.1");

    // Allow the reader's metadata request/response round trip to complete.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await sendUdp(master, fakeTime(), 60_001, "127.0.0.1");

    const track = await Promise.race([
      trackPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("TCNet track timeout")), 2_000)),
    ]);
    assert.equal(track.title, "One More Time");
    assert.equal(track.artist, "Daft Punk");
    assert.equal(track.playbackConfirmed, true);
    assert.equal(reader.getStatus().connected, true);
    assert.equal(reader.getStatus().onAirAvailable, true);
  } finally {
    await reader.stop();
    await closeUdp(master);
  }
});
