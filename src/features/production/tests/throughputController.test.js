import test from "node:test";
import assert from "node:assert/strict";
import { createTelemetryStore } from "../telemetry/telemetryStore.js";
import { createThroughputController } from "../hooks/throughputController.js";

function fixture() {
  let time = 1000;
  const store = createTelemetryStore({ now: () => time, schedule: () => 1, cancel: () => {} });
  const controller = createThroughputController(store, { now: () => time });
  const disconnect = controller.connect();
  return { store, controller, disconnect, at: value => { time = value; },
    snapshot: controller.getSnapshot,
    speed(value, source = "demo", changes = {}) {
      store.publish({ field: "speed", value, source, acquiredAt: time, receivedAt: time,
        calibrationStatus: source === "hardware" ? "calibrated" : "not-applicable", ...changes });
    } };
}

test("controller uses actual generated speed and propagates demo/manual provenance", () => {
  const f = fixture();
  try {
    f.speed(2.35);
    assert.equal(f.snapshot().flow.value, 423);
    assert.equal(f.snapshot().flow.source, "demo");
    assert.deepEqual(f.snapshot().flow.provenance, ["demo", "manual"]);
    f.at(2000); f.speed(2.35);
    assert.equal(f.snapshot().metrics.accumulated.value, 423 / 3600);
    assert.equal(f.snapshot().metrics.forecast.unavailable, true);
    assert.equal(f.snapshot().settings.designCapacity, "");
    f.controller.updateInputs({ designCapacity: 999 });
    assert.equal(f.snapshot().flow.value, 423);
    assert.equal(f.snapshot().settings.expectedThroughput, 360);
  } finally { f.disconnect(); }
});

test("both editable presets show 360 without changing telemetry speed", () => {
  const f = fixture();
  try {
    f.speed(2.35);
    for (const preset of ["beltLoad360", "geometry360"]) {
      f.controller.applyPreset(preset);
      assert.equal(f.snapshot().flow.value, 360);
      assert.equal(f.store.getSnapshot().speed.latest.value, 2.35);
    }
    f.controller.updateInputs({ density: -1 });
    assert.equal(f.snapshot().flow.unavailable, true);
    assert.match(f.snapshot().flow.reason, /density/);
  } finally { f.disconnect(); }
});

test("stale observations suspend preset accounting too and cannot be refreshed by editing inputs", () => {
  const f = fixture();
  try {
    f.controller.applyPreset("beltLoad360");
    f.speed(2);
    f.at(2000); f.speed(2);
    const total = f.snapshot().metrics.accumulated.value;
    f.at(8001); f.store.refresh();
    assert.equal(f.snapshot().flow.quality, "stale");
    assert.equal(f.snapshot().metrics.accumulated.value, total);
    f.controller.updateInputs({ load: 100 });
    assert.equal(f.snapshot().flow.unavailable, true);
    f.at(9000); f.speed(2);
    assert.equal(f.snapshot().metrics.accumulated.value, total);
    assert.equal(f.snapshot().accountingSession.timeMs.unknown, 7000);
  } finally { f.disconnect(); }
});

test("zero demo speed does not confirm downtime; explicit state records loss", () => {
  const f = fixture();
  try {
    f.speed(0);
    f.at(2000); f.speed(0);
    assert.equal(f.snapshot().flow.value, 0);
    assert.equal(f.snapshot().accountingSession.lostTonnes, 0);
    f.at(2500); f.controller.updateInputs({ confirmedState: "confirmedUnplannedStop" });
    f.at(3000); f.speed(0);
    assert.equal(f.snapshot().accountingSession.timeMs.confirmedUnplannedStop, 500);
    assert.equal(f.snapshot().metrics.loss.value, 0.05);
    f.at(3500); f.controller.updateInputs({ scheduled: false });
    f.at(4000); f.speed(0);
    assert.equal(f.snapshot().metrics.loss.value, 0.1);
  } finally { f.disconnect(); }
});

test("hardware and demo totals remain isolated on context switches", () => {
  const f = fixture();
  try {
    f.speed(2); f.at(2000); f.speed(2);
    assert.equal(f.snapshot().sessions.demo.accumulatedTonnes, 0.1);
    f.controller.updateInputs({ context: "hardware" });
    assert.equal(f.snapshot().flow.unavailable, true);
    f.at(3000); f.speed(2, "hardware");
    f.at(4000); f.speed(2, "hardware");
    assert.equal(f.snapshot().sessions.hardware.accumulatedTonnes, 0.1);
    assert.equal(f.snapshot().sessions.demo.accumulatedTonnes, 0.1);
    assert.equal(f.snapshot().flow.label, "ESTIMATED");
    f.controller.updateInputs({ context: "demo" });
    f.at(5000); f.speed(2);
    assert.equal(f.snapshot().sessions.demo.accumulatedTonnes, 0.1);
    f.at(6000); f.speed(2);
    assert.equal(f.snapshot().sessions.demo.accumulatedTonnes, 0.2);
    assert.equal(f.snapshot().sessions.hardware.accumulatedTonnes, 0.1);
  } finally { f.disconnect(); }
});

test("changes to flow assumptions never retroactively apply a new rate to old intervals", () => {
  const f = fixture();
  try {
    f.speed(2); f.at(2000); f.speed(2);
    f.at(2500); f.controller.updateInputs({ load: 100 });
    f.at(3000); f.speed(2);
    assert.equal(f.snapshot().accountingSession.accumulatedTonnes, 0.1);
    assert.equal(f.snapshot().accountingSession.timeMs.unknown, 1000);
    f.at(4000); f.speed(2);
    assert.ok(Math.abs(f.snapshot().accountingSession.accumulatedTonnes - 0.3) < 1e-12);
  } finally { f.disconnect(); }
});

test("invalid settings and duplicate store notifications cannot add tonnes", () => {
  const f = fixture();
  try {
    f.speed(2); f.at(2000); f.speed(2);
    const total = f.snapshot().accountingSession.accumulatedTonnes;
    f.store.publish({ field: "tempC", value: 34, source: "manual", receivedAt: 2000 });
    assert.equal(f.snapshot().accountingSession.accumulatedTonnes, total);
    f.controller.updateInputs({ load: NaN });
    assert.equal(f.snapshot().flow.quality, "invalid");
    f.at(3000); f.speed(2);
    assert.equal(f.snapshot().accountingSession.accumulatedTonnes, total);
  } finally { f.disconnect(); }
});

test("demo stop confirmation cannot leak into a hardware session", () => {
  const f = fixture();
  try {
    f.controller.updateInputs({ confirmedState: "confirmedUnplannedStop" });
    f.controller.updateInputs({ context: "hardware" });
    assert.equal(f.snapshot().settings.confirmedState, "auto");
    f.speed(0, "hardware");
    f.at(2000); f.speed(0, "hardware");
    assert.equal(f.snapshot().sessions.hardware.lostTonnes, 0);
    assert.equal(f.snapshot().sessions.hardware.timeMs.unknown, 1000);
  } finally { f.disconnect(); }
});

test("long gaps cannot bypass freshness if browser timers were suspended", () => {
  const f = fixture();
  try {
    f.controller.updateInputs({ maxGapMs: 10000 });
    f.speed(2);
    f.at(9000); f.speed(2);
    assert.equal(f.snapshot().accountingSession.accumulatedTonnes, 0);
    assert.equal(f.snapshot().accountingSession.timeMs.unknown, 8000);
  } finally { f.disconnect(); }
});
