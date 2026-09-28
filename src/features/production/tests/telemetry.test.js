import test from "node:test";
import assert from "node:assert/strict";
import { createObservation } from "../telemetry/observationContract.js";
import { createTelemetryStore } from "../telemetry/telemetryStore.js";
import { createTelemetryBridge } from "../telemetry/telemetryBridge.js";

function fixture(options = {}) {
  let time = 1000;
  const now = () => time;
  const bridge = createTelemetryBridge({ now, ...options });
  return { bridge, store: bridge.store, at: value => { time = value; },
    latest: field => bridge.store.getSnapshot()[field].latest,
    history: field => bridge.store.getSnapshot()[field].history };
}

test("contract preserves zero, binary states and negative temperatures without coercion", () => {
  const base = { source: "hardware", receivedAt: 1000 };
  assert.equal(createObservation({ ...base, field: "piezoVal", value: 0 }).quality, "valid");
  assert.equal(createObservation({ ...base, field: "irLeft", value: 0 }).value, 0);
  assert.equal(createObservation({ ...base, field: "laserState", value: true }).value, 1);
  assert.equal(createObservation({ ...base, field: "tempC", value: -2 }).quality, "valid");
  for (const value of [NaN, Infinity, -Infinity, null, "", "34.2", {}, []]) {
    assert.equal(createObservation({ ...base, field: "tempC", value }).quality, "invalid");
  }
  assert.equal(createObservation({ ...base, field: "irLeft", value: 2 }).quality, "invalid");
  assert.equal(createObservation({ ...base, field: "piezoVal", value: 4096 }).quality, "invalid");
  assert.equal(createObservation({ ...base, field: "tempC", value: 34, acquiredAt: 2000 }).quality, "invalid");
  const missing = createObservation({ field: "motorCurrent", receivedAt: 1000 });
  assert.equal(missing.source, "unavailable");
  assert.equal(missing.quality, "missing");
  assert.equal(missing.value, null);
});

test("partial payloads independently timestamp supplied fields; identical readings are new samples", () => {
  const f = fixture();
  f.bridge.setConnection(true, "device-A");
  f.bridge.publishHardwarePayload({ tempC: 34, piezoVal: 0, irLeft: 0 });
  const firstTemp = f.latest("tempC");
  assert.equal(f.latest("piezoVal").value, 0);
  assert.equal(f.latest("irLeft").signalType, "binary");
  f.at(2000);
  f.bridge.publishHardwarePayload({ tempC: 34 });
  assert.equal(f.latest("piezoVal").receivedAt, 1000);
  assert.equal(f.latest("irLeft").receivedAt, 1000);
  assert.equal(f.latest("tempC").receivedAt, 2000);
  assert.notEqual(f.latest("tempC").sampleId, firstTemp.sampleId);
  assert.equal(f.history("tempC").length, 2);
  const snapshot = f.store.getSnapshot();
  f.at(2500);
  f.bridge.publishHardwarePayload({});
  assert.equal(f.store.getSnapshot(), snapshot);
  for (let index = 0; index < 10; index++) f.store.getSnapshot();
  assert.equal(f.latest("tempC").receivedAt, 2000);
});

test("missing and invalid supplied values cannot refresh previous valid readings", () => {
  const f = fixture();
  f.bridge.setConnection(true, "A");
  f.bridge.publishHardwarePayload({ tempC: 34 });
  for (const value of [NaN, Infinity, null]) {
    f.at(f.latest("tempC").receivedAt + 1000);
    f.bridge.publishHardwarePayload({ tempC: value });
    assert.equal(f.latest("tempC").quality, "invalid");
    assert.equal(f.latest("tempC").value, null);
  }
  f.bridge.publishHardwarePayload({ irRight: undefined });
  assert.equal(f.latest("irRight").quality, "missing");
  f.bridge.publishDemo("tempC", 34);
  assert.equal(f.latest("tempC").source, "hardware");
});

test("store sorts out-of-order samples, bounds history and rejects duplicates", () => {
  const store = createTelemetryStore({ maxEntries: 3, now: () => 5000 });
  const sample = (id, acquiredAt) => ({ field: "tempC", value: 34,
    source: "hardware", acquiredAt, receivedAt: 5000, sampleId: id });
  assert.equal(store.publish(sample("one", 1000)), true);
  store.publish(sample("three", 3000));
  store.publish(sample("two", 2000));
  const beforeDuplicate = store.getSnapshot();
  assert.equal(store.publish(sample("two", 2000)), false);
  assert.equal(store.getSnapshot(), beforeDuplicate);
  assert.deepEqual(store.getSnapshot().tempC.history.map(item => item.acquiredAt), [1000, 2000, 3000]);
  assert.equal(store.getSnapshot().tempC.latest.acquiredAt, 3000);
  store.publish(sample("four", 4000));
  assert.deepEqual(store.getSnapshot().tempC.history.map(item => item.acquiredAt), [2000, 3000, 4000]);
});

test("per-channel freshness uses acquisition time and never refreshes on render", () => {
  const f = fixture({ storeOptions: { freshnessByChannel: { piezoVal: 2000 } } });
  f.bridge.setConnection(true, "A");
  f.bridge.publishHardwarePayload({ tempC: 34, piezoVal: 350 });
  f.at(3001);
  f.store.refresh();
  assert.equal(f.latest("piezoVal").quality, "stale");
  assert.equal(f.latest("tempC").quality, "valid");
  f.at(6001);
  f.store.refresh();
  assert.equal(f.latest("tempC").quality, "stale");
  const staleSnapshot = f.store.getSnapshot();
  f.store.refresh();
  assert.equal(f.store.getSnapshot(), staleSnapshot);
  f.bridge.publishHardwarePayload({ tempC: 34,
    metadata: { fields: { tempC: { acquiredAt: 1000 } } } });
  assert.equal(f.latest("tempC").quality, "stale");
  assert.equal(f.latest("tempC").receivedAt, 6001);
});

test("freshness scheduler expires channels and cleans up StrictMode-style subscriptions", () => {
  let time = 1000;
  const timers = new Map();
  let timerId = 0;
  const store = createTelemetryStore({ now: () => time,
    schedule: callback => { timers.set(++timerId, callback); return timerId; },
    cancel: id => timers.delete(id) });
  let notifications = 0;
  const listener = () => { notifications++; };
  const firstCleanup = store.subscribe(listener);
  assert.equal(timers.size, 1);
  firstCleanup();
  firstCleanup();
  assert.equal(timers.size, 0);
  const secondCleanup = store.subscribe(listener);
  const thirdCleanup = store.subscribe(listener);
  assert.equal(timers.size, 1);
  store.publish({ field: "tempC", value: 34, source: "hardware", receivedAt: time });
  assert.equal(notifications, 2);
  time = 6001;
  for (const tick of timers.values()) tick();
  assert.equal(store.getSnapshot().tempC.latest.quality, "stale");
  secondCleanup();
  assert.equal(timers.size, 1);
  thirdCleanup();
  assert.equal(timers.size, 0);
});

test("connect/disconnect resets hardware windows without fabricating freshness or fallback", () => {
  const f = fixture();
  f.bridge.publishDemo("piezoVal", 350);
  f.at(2000);
  f.bridge.setConnection(true, "A");
  assert.equal(f.latest("piezoVal").source, "demo");
  assert.equal(f.latest("piezoVal").receivedAt, 1000);
  f.bridge.publishHardwarePayload({ piezoVal: 350, tempC: 34 });
  assert.equal(f.history("piezoVal").length, 1);
  assert.equal(f.store.getSnapshot().piezoVal.generation, 1);
  const timestamp = f.latest("tempC").receivedAt;
  f.at(3000);
  f.bridge.setConnection(false, "A");
  assert.equal(f.latest("tempC").receivedAt, timestamp);
  assert.equal(f.latest("tempC").quality, "stale");
  assert.equal(f.history("tempC").length, 0);
  f.bridge.publishDemo("piezoVal", 350);
  assert.equal(f.latest("piezoVal").source, "hardware");
  f.bridge.setConnection(true, "A");
  assert.equal(f.latest("tempC").quality, "stale");
  f.bridge.publishHardwarePayload({ tempC: 34 });
  assert.equal(f.latest("tempC").quality, "valid");
});

test("device/calibration changes isolate histories and reject old in-flight responses", () => {
  const f = fixture();
  f.bridge.setConnection(true, "A");
  const oldRequest = f.bridge.captureContext();
  f.bridge.publishHardwarePayload({ tempC: 34, piezoVal: 350,
    metadata: { deviceId: "node-A", fields: { tempC: { calibrationStatus: "cal-v1" } } } });
  f.at(2000);
  f.bridge.publishHardwarePayload({ tempC: 35,
    metadata: { deviceId: "node-A", fields: { tempC: { calibrationStatus: "cal-v2" } } } });
  assert.equal(f.history("tempC").length, 1);
  assert.equal(f.store.getSnapshot().tempC.generation, 1);
  f.at(3000);
  f.bridge.publishHardwarePayload({ tempC: 36,
    metadata: { deviceId: "node-B", fields: { tempC: { acquiredAt: 2900 } } } });
  assert.equal(f.latest("tempC").value, 36);
  assert.equal(f.latest("piezoVal").quality, "stale");
  assert.equal(f.history("piezoVal").length, 0);
  f.bridge.setConnection(true, "B");
  const before = f.store.getSnapshot();
  f.bridge.publishHardwarePayload({ tempC: 99 }, oldRequest);
  assert.equal(f.store.getSnapshot(), before);
});

test("late samples from previous sources cannot reopen reset windows", () => {
  const store = createTelemetryStore({ now: () => 5000 });
  store.publish({ field: "tempC", value: 34, source: "demo", acquiredAt: 1000, receivedAt: 1000 });
  store.publish({ field: "tempC", value: 35, source: "hardware", acquiredAt: 3000, receivedAt: 3000 });
  assert.equal(store.publish({ field: "tempC", value: 34, source: "demo", acquiredAt: 2000, receivedAt: 4000 }), false);
  assert.equal(store.getSnapshot().tempC.history.length, 1);
  assert.equal(store.getSnapshot().tempC.latest.source, "hardware");
});

test("omitted optional identity metadata preserves device and calibration windows", () => {
  const f = fixture();
  f.bridge.setConnection(true, "endpoint-A");
  f.bridge.publishHardwarePayload({ tempC: 34,
    metadata: { deviceId: "node-A", fields: { tempC: { calibrationStatus: "cal-v1" } } } });
  f.at(2000);
  f.bridge.publishHardwarePayload({ tempC: 35 });
  assert.equal(f.latest("tempC").deviceId, "node-A");
  assert.equal(f.latest("tempC").calibrationStatus, "cal-v1");
  assert.equal(f.history("tempC").length, 2);
  assert.equal(f.store.getSnapshot().tempC.generation, 0);
});

test("manual controls are explicit sources; speed is always demo and motorCurrent unavailable", () => {
  const f = fixture();
  f.bridge.setConnection(true, "A");
  f.bridge.publishHardwarePayload({ tempC: 34, irLeft: 1, speed: 88, motorCurrent: 42 });
  f.at(2000);
  f.bridge.publishManual("tempC", 35);
  f.bridge.publishManual("irLeft", 0);
  f.bridge.publishDemo("speed", 0);
  f.bridge.publishManual("speed", 0);
  f.bridge.publishManual("motorCurrent", 42);
  f.bridge.publishDemo("motorCurrent", 42);
  assert.equal(f.latest("tempC").source, "manual");
  assert.equal(f.history("tempC").length, 1);
  assert.equal(f.latest("irLeft").source, "manual");
  assert.equal(f.latest("irLeft").value, 0);
  assert.equal(f.latest("speed").source, "demo");
  assert.equal(f.latest("speed").value, 0);
  assert.equal(f.latest("motorCurrent").source, "unavailable");
});

test("disabled bridge performs no collection", () => {
  const f = fixture({ enabled: false });
  f.bridge.setConnection(true, "A");
  const before = f.store.getSnapshot();
  f.bridge.publishHardwarePayload({ tempC: 34 });
  f.bridge.publishManual("irLeft", 0);
  f.bridge.publishDemo("speed", 2.35);
  assert.equal(f.store.getSnapshot(), before);
});
