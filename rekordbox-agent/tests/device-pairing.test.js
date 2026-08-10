const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getBridgeAuthHeaders,
  getEffectiveEventId,
  getPairedSourceId,
  hasBridgeCredential,
} = require("../dist/main/bridge-auth.js");

const legacyConfig = {
  eventId: "legacy-event",
  pushToken: "legacy-token",
  sourceId: "legacy-source",
};

test("legacy credentials keep using x-push-token", () => {
  assert.equal(hasBridgeCredential(legacyConfig), true);
  assert.deepEqual(getBridgeAuthHeaders(legacyConfig), {
    "x-push-token": "legacy-token",
  });
  assert.equal(getEffectiveEventId(legacyConfig), "legacy-event");
  assert.equal(getPairedSourceId(legacyConfig), "");
});

test("complete paired credentials take priority over legacy credentials", () => {
  const pairedConfig = {
    ...legacyConfig,
    deviceId: "device-123",
    deviceToken: "device-token",
    pairedEventId: "saas-event",
    pairedSourceId: "saas-source",
  };

  assert.deepEqual(getBridgeAuthHeaders(pairedConfig), {
    Authorization: "Bearer device-token",
    "x-device-id": "device-123",
  });
  assert.equal(getEffectiveEventId(pairedConfig), "saas-event");
  assert.equal(getPairedSourceId(pairedConfig), "saas-source");
  assert.equal(pairedConfig.eventId, "legacy-event");
  assert.equal(pairedConfig.pushToken, "legacy-token");
  assert.equal(pairedConfig.sourceId, "legacy-source");
});

test("partial paired credentials safely fall back to legacy credentials", () => {
  const incompleteConfig = {
    ...legacyConfig,
    deviceId: "device-without-token",
    pairedEventId: "saas-event",
  };

  assert.deepEqual(getBridgeAuthHeaders(incompleteConfig), {
    "x-push-token": "legacy-token",
  });
  assert.equal(getEffectiveEventId(incompleteConfig), "legacy-event");
  assert.equal(getPairedSourceId(incompleteConfig), "");
});
