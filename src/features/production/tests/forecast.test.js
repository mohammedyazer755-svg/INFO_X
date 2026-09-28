import test from "node:test";
import assert from "node:assert/strict";
import { forecastThroughput, forecastShiftProjection, temperatureCrossing } from "../calculations/forecast.js";
import { projectShiftTonnes } from "../calculations/accounting.js";
import { createTelemetryStore } from "../telemetry/telemetryStore.js";
import { createThroughputController } from "../hooks/throughputController.js";

const series = (rate = 0) => Array.from({ length: 11 }, (_, i) => ({ t: 1000 + i * 3000, v: 360 + rate * i * 3,
  source: "demo", identity: "demo:A:manual-load", quality: "valid", regime: "scheduledRunning", sampleId: `sample-${i}` }));
const assess = (history, options = {}, now = 31000) => forecastThroughput(history, options, now);

test("rolling baseline and linear forecasts preserve stable, rising and falling observations", () => {
  assert.equal(assess(series()).value, 360);
  assert.equal(assess(series(2)).value, 390);
  const rise = assess(series(2), { method: "linearTrend" });
  assert.equal(rise.value, 660);
  assert.equal(rise.averageRate, 540);
  assert.equal(rise.slopePerSecond, 2);
  const fall = assess(series(-1), { method: "linearTrend" });
  assert.equal(fall.value, 210);
  assert.equal(fall.averageRate, 270);
  assert.deepEqual(rise.observed, series(2));
  assert.equal(rise.forecast[0].t, 31000);
  assert.equal(rise.forecast.at(-1).t, 151000);
  assert.equal(Object.hasOwn(rise, "confidence"), false);
});

test("forecast requires configured count, duration and valid horizon", () => {
  assert.equal(assess(series().slice(1)).unavailable, true);
  assert.equal(assess(series(), { minCount: 12 }).unavailable, true);
  assert.equal(assess(series(), { horizonMs: 1000000 }).unavailable, true);
  assert.equal(assess(series(), { method: "unknown" }).unavailable, true);
  assert.equal(assess(series(), { minCount: 2.5 }).unavailable, true);
  assert.equal(assess(series(), { windowMs: 1000 }).unavailable, true);
  const small = assess(series().slice(-2), { method: "linearTrend", minCount: 2, minDurationMs: 3000 });
  assert.equal(small.value, 360);
});

test("forecast stops for stale, missing, invalid, out-of-order and regime/source changes", () => {
  assert.equal(assess([], {}, 31000).unavailable, true);
  assert.equal(assess(series(), {}, 36001).quality, "stale");
  assert.equal(assess(series(), {}, 30000).unavailable, true);
  for (const patch of [{ quality: "missing" }, { v: NaN }, { v: Infinity }, { identity: "other" },
    { source: "hardware" }, { regime: "plannedIdle" }, { t: undefined }]) {
    const history = series(); history[5] = { ...history[5], ...patch };
    assert.equal(assess(history).unavailable, true, JSON.stringify(patch));
  }
  assert.equal(assess(series().filter((_, i) => i !== 5)).unavailable, true);
  const reversed = series(); [reversed[4], reversed[5]] = [reversed[5], reversed[4]];
  assert.equal(assess(reversed).unavailable, true);
  assert.equal(assess(series().map(point => ({ ...point, regime: "unknown" }))).unavailable, true);
});

test("physical limits are optional, disclosed and applied to the rate average exactly", () => {
  const unbounded = assess(series(-2), { method: "linearTrend", horizonMs: 300000 });
  assert.equal(unbounded.value, -300);
  assert.match(unbounded.assumptions.join(" "), /not clipped/);
  const bounded = assess(series(2), { method: "linearTrend", physicalBounds: { min: 0, max: 500 } });
  assert.equal(bounded.value, 500);
  // 40 seconds from 420 to 500, then 80 seconds at 500.
  assert.ok(Math.abs(bounded.averageRate - (40 * 460 + 80 * 500) / 120) < 1e-10);
  assert.match(bounded.assumptions.join(" "), /0 to 500/);
  for (const physicalBounds of [{ min: 20, max: 10 }, { min: 0, max: "" }, { min: -1, max: 10 }]) {
    assert.equal(assess(series(), { physicalBounds }).unavailable, true);
  }
});

test("irregular timestamp regression uses actual elapsed times", () => {
  const times = [1000, 3000, 6000, 10000, 12000, 15000, 19000, 22000, 25000, 28000, 31000];
  const history = series().map((point, i) => ({ ...point, t: times[i], v: 100 + (times[i] - 1000) / 1000 }));
  const forecast = assess(history, { method: "linearTrend" });
  assert.equal(forecast.slopePerSecond, 1);
  assert.equal(forecast.value, 250);
});

test("data-driven shift projection uses the remaining interval, separates what-if and handles complete shifts", () => {
  const hours = 60 / 3600;
  const projected = forecastShiftProjection(10, hours, 0.5, series(2), { method: "linearTrend" }, 31000);
  assert.equal(projected.assumedRate, 480);
  assert.equal(projected.value, 14);
  const delayed = forecastShiftProjection(10, hours, 0.5, series(2), { method: "linearTrend" }, 33000);
  assert.equal(delayed.assumedRate, 484);
  assert.equal(forecastShiftProjection(10, 120 / 3600, 1, series(), {}, 33000).unavailable, true);
  assert.equal(projectShiftTonnes(10, hours, 360, 0.5), 13);
  assert.equal(forecastShiftProjection(10, 0, 1, [], {}, 31000).value, 10);
  assert.equal(forecastShiftProjection(10, 8, 1, series(), {}, 31000).unavailable, true);
  assert.equal(forecastShiftProjection(10, hours, 1, series(), {}, 36001).unavailable, true);
  for (const assumptions of [[NaN, hours, 1], [10, -1, 1], [10, hours, 1.1], [10, hours, ""]]) {
    assert.equal(forecastShiftProjection(...assumptions, series(), {}, 31000).unavailable, true);
  }
});

test("temperature extrapolation handles qualified rise, exceeded threshold, near-zero rate, horizon and stale data", () => {
  const feature = { current: 35, observedAt: 31000, source: "hardware", quality: "valid", sufficient: true };
  const trend = { slope: 1, direction: "rising" };
  const project = (patch = {}, analysis = trend, options = {}) => temperatureCrossing({ ...feature, ...patch }, analysis, 40, { now: 31000, ...options });
  assert.equal(project().value, 300000);
  assert.equal(project().label, "Extrapolation at current rate");
  assert.equal(project({ current: 40 }).value, 0);
  assert.equal(project({ current: 41 }, { slope: -1, direction: "falling" }).value, 0);
  assert.equal(project({}, { slope: 0.001, direction: "rising" }).unavailable, true);
  assert.equal(project({}, { slope: -1, direction: "falling" }).unavailable, true);
  assert.equal(project({}, trend, { maxHorizonMs: 100000 }).unavailable, true);
  assert.equal(project({ sufficient: false }).unavailable, true);
  assert.equal(project({}, trend, { now: 36001 }).unavailable, true);
  assert.equal(project({ current: 41, quality: "stale" }).unavailable, true);
});

function fixture() {
  let time = 1000;
  const store = createTelemetryStore({ now: () => time, schedule: () => 1, cancel: () => {} });
  const controller = createThroughputController(store);
  const disconnect = controller.connect();
  return { store, controller, disconnect, at: value => { time = value; }, snapshot: controller.getSnapshot,
    speed(value = 2, source = "demo") { store.publish({ field: "speed", value, source, acquiredAt: time, receivedAt: time,
      calibrationStatus: source === "hardware" ? "calibrated" : "not-applicable" }); },
    warm(start = 1000) { for (let i = 0; i <= 10; i++) { time = start + i * 3000; this.speed(); } } };
}

test("controller keeps bounded deduplicated history and stops immediately on operating/input changes", () => {
  const f = fixture();
  try {
    f.warm(); assert.equal(f.snapshot().forecast.value, 360);
    f.store.refresh(); assert.equal(f.snapshot().flowHistory.length, 11);
    f.controller.updateInputs({ assumedFutureThroughput: 900, expectedThroughput: 1000, designCapacity: 100 });
    assert.equal(f.snapshot().forecast.value, 360);
    assert.equal(f.snapshot().metrics.projected.value, f.snapshot().metrics.accumulated.value + f.snapshot().remainingHours * 900);
    f.controller.updateForecastOptions({ physicalBounds: { min: 0, max: 300 } });
    assert.equal(f.snapshot().forecast.value, 300);
    assert.equal(f.snapshot().settings.assumedFutureThroughput, 900);
    f.controller.updateInputs({ confirmedState: "confirmedUnplannedStop" });
    assert.equal(f.snapshot().forecast.unavailable, true);
    f.at(32000); f.speed(); assert.equal(f.snapshot().forecast.unavailable, true);
    f.controller.updateInputs({ confirmedState: "scheduledRunning" });
    f.warm(33000); assert.equal(f.snapshot().forecast.unavailable, false);
    f.controller.updateInputs({ load: 70 }); assert.equal(f.snapshot().forecast.unavailable, true);
    f.warm(64000); assert.equal(f.snapshot().forecast.unavailable, false);
    f.controller.updateInputs({ scheduled: false });
    assert.equal(f.snapshot().remainingScheduledHours, 0);
    assert.equal(f.snapshot().metrics.projected.value, f.snapshot().metrics.accumulated.value);
    f.controller.resetSession(); assert.equal(f.snapshot().flowHistory.length, 0);
  } finally { f.disconnect(); }
});

test("controller requires a new complete window after stale data, missing data, gaps and source switching", () => {
  const f = fixture();
  try {
    f.warm(); f.at(36001); f.store.refresh();
    assert.equal(f.snapshot().forecast.unavailable, true);
    f.at(37000); f.speed(); assert.equal(f.snapshot().flowHistory.length, 1);
    f.warm(40000); assert.equal(f.snapshot().forecast.unavailable, false);
    f.at(71000); f.speed(NaN); assert.equal(f.snapshot().forecast.unavailable, true);
    f.warm(72000); assert.equal(f.snapshot().forecast.unavailable, false);
    f.at(110000); f.speed(); assert.equal(f.snapshot().flowHistory.length, 1);
    f.controller.updateInputs({ context: "hardware" }); assert.equal(f.snapshot().forecast.unavailable, true);
    for (let i = 0; i <= 10; i++) { f.at(111000 + i * 3000); f.speed(2, "hardware"); }
    assert.equal(f.snapshot().forecast.source, "derived");
    assert.equal(f.snapshot().forecast.value, 360);
    f.controller.updateInputs({ context: "demo" }); assert.equal(f.snapshot().forecast.unavailable, true);
  } finally { f.disconnect(); }
});

test("controller uses bounded retained window and completed shift totals without extending stale flow", () => {
  const f = fixture();
  try {
    f.controller.updateInputs({ shiftDurationHrs: 0.01 });
    f.warm();
    assert.equal(f.snapshot().dataProjection.unavailable, false);
    for (let i = 11; i <= 100; i++) { f.at(1000 + i * 3000); f.speed(); }
    assert.ok(f.snapshot().flowHistory.length <= 41);
    assert.equal(f.snapshot().remainingHours, 0);
    assert.equal(f.snapshot().dataProjection.value, f.snapshot().metrics.accumulated.value);
    f.at(307000); f.store.refresh();
    assert.equal(f.snapshot().forecast.unavailable, true);
    assert.equal(f.snapshot().dataProjection.value, f.snapshot().metrics.accumulated.value);
  } finally { f.disconnect(); }
});
