import test from "node:test";
import assert from "node:assert/strict";
import { createTelemetryStore } from "../telemetry/telemetryStore.js";
import { createFeatureEngineeringController } from "../hooks/featureEngineeringController.js";
import { analyzeNumericTrend } from "../calculations/temporal.js";

function fixture(options = {}) {
  let time = 1000;
  const store = createTelemetryStore({ now: () => time, schedule: () => 1, cancel: () => {}, ...options });
  const controller = createFeatureEngineeringController(store);
  const disconnect = controller.connect();
  return { store, controller, disconnect, at: value => { time = value; }, snapshot: controller.getSnapshot,
    publish(field, value, source = "hardware", extra = {}) {
      store.publish({ field, value, source, acquiredAt: time, receivedAt: time, ...extra });
    } };
}

test("historical acquisition quality supports a 30-second trend while old display samples age stale", () => {
  const f = fixture();
  try {
    for (let index = 0; index < 11; index++) {
      f.at(1000 + index * 3000); f.publish("tempC", 34 + index * 0.02);
    }
    assert.equal(f.store.getSnapshot().tempC.history[0].quality, "stale");
    assert.equal(f.store.getRecordedHistory("tempC")[0].quality, "valid");
    const feature = f.snapshot().tempC;
    assert.equal(feature.samples.length, 11);
    const trend = analyzeNumericTrend(feature, feature.config);
    assert.equal(trend.direction, "rising");
    assert.ok(Math.abs(trend.slope - 0.4) < 1e-9);
  } finally { f.disconnect(); }
});

test("qualified baseline survives rolling eviction while its signed deviation can be negative", () => {
  const f = fixture({ maxEntries: 12 });
  try {
    for (let index = 0; index < 12; index++) { f.at(1000 + index * 3000); f.publish("tempC", 34); }
    assert.equal(f.snapshot().tempC.baseline.value, 34);
    for (let index = 12; index < 25; index++) { f.at(1000 + index * 3000); f.publish("tempC", 32); }
    assert.equal(f.snapshot().tempC.baseline.value, 34);
    assert.equal(f.snapshot().tempC.baselineDeviation, -2);
  } finally { f.disconnect(); }
});

test("stale timeout and recovery reset baseline and trend warm-up", () => {
  const f = fixture();
  try {
    for (let index = 0; index < 11; index++) { f.at(1000 + index * 3000); f.publish("tempC", 34); }
    assert.equal(f.snapshot().tempC.baseline.value, 34);
    f.at(37000); f.store.refresh();
    assert.equal(f.snapshot().tempC.quality, "stale");
    assert.equal(f.snapshot().tempC.samples.length, 0);
    assert.equal(f.snapshot().tempC.baseline, null);
    f.at(38000); f.publish("tempC", 33);
    assert.equal(f.snapshot().tempC.samples.length, 1);
    assert.equal(f.snapshot().tempC.baseline, null);
  } finally { f.disconnect(); }
});

test("source/device/calibration changes reset the relevant channel without resetting others", () => {
  const f = fixture();
  try {
    for (let index = 0; index < 11; index++) {
      f.at(1000 + index * 3000); f.publish("tempC", 34); f.publish("piezoVal", 350);
    }
    f.at(32000); f.publish("tempC", 33, "manual");
    assert.equal(f.snapshot().tempC.samples.length, 1);
    assert.equal(f.snapshot().tempC.baseline, null);
    assert.equal(f.snapshot().piezoVal.samples.length, 11);
    f.at(33000); f.publish("piezoVal", 600, "hardware", { deviceId: "node-B" });
    assert.equal(f.snapshot().piezoVal.samples.length, 1);
    f.at(34000); f.publish("piezoVal", 600, "hardware", { deviceId: "node-B", calibrationStatus: "cal-v2" });
    assert.equal(f.snapshot().piezoVal.samples.length, 1);
  } finally { f.disconnect(); }
});

test("a persistent rising trend becomes a degradation indicator after qualified observations", () => {
  const f = fixture();
  try {
    for (let index = 0; index <= 25; index++) { f.at(1000 + index * 4000); f.publish("piezoVal", 350 + index); }
    const feature = f.snapshot().piezoVal;
    const trend = analyzeNumericTrend(feature, feature.config);
    assert.equal(trend.direction, "rising");
    assert.equal(trend.slope, 15);
    assert.equal(trend.persistenceMs, 64000);
    assert.equal(trend.degrading, true);
    const before = f.snapshot().piezoVal.samples.length;
    f.publish("irLeft", 1);
    assert.equal(f.snapshot().piezoVal.samples.length, before);
    assert.equal(analyzeNumericTrend(f.snapshot().piezoVal, feature.config).persistenceMs, 64000);
  } finally { f.disconnect(); }
});

test("Hall interruption remains visible after freshness expires", () => {
  const f = fixture();
  try {
    f.publish("magState", 1);
    f.at(2000); f.publish("magState", 0);
    f.at(3000); f.publish("magState", 0);
    f.at(9000); f.store.refresh();
    assert.equal(f.snapshot().hall.quality, "stale");
    assert.equal(f.snapshot().hall.interruptedEvents[0].durationMs, 1000);
    assert.equal(f.snapshot().hall.currentEvent, null);
  } finally { f.disconnect(); }
});
