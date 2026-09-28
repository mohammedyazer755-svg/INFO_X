import test from "node:test";
import assert from "node:assert/strict";
import { createObservation } from "../telemetry/observationContract.js";
import { extractPiezoFeatures, extractTemperatureFeatures, extractBinaryFeatures, extractIRFeatures,
  extractHallFeatures, findStableBaseline, numericWindow } from "../calculations/features.js";
import { linearSlope, trendDirection, trendPersistence, isInsufficient, isStale, analyzeNumericTrend } from "../calculations/temporal.js";
import { ANALYSIS_CONFIG } from "../config/analysisConfig.js";

const obs = (field, value, t, changes = {}) => createObservation({ field, value, source: "hardware", acquiredAt: t, receivedAt: t, ...changes });
const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const temperatureConfig = { ...ANALYSIS_CONFIG, ...ANALYSIS_CONFIG.tempC };

test("regression handles irregular epoch timestamps, unordered points and negative slopes", () => {
  const origin = 1790610000000;
  const times = [0, 2000, 5000, 9000, 12000, 15000, 19000, 23000, 27000, 31000, 35000];
  const points = times.map(t => ({ t: origin + t, v: 34 + 0.4 * t / 60000 }));
  near(linearSlope([...points].reverse()) * 60, 0.4);
  near(linearSlope(points.map(point => ({ ...point, v: -point.v }))) * 60, -0.4);
  near(linearSlope(points.map(point => ({ ...point, v: 34 }))), 0);
  assert.equal(linearSlope(points.slice(0, 9)), null);
  assert.equal(isInsufficient(points), false);
});

test("both sample count and actual duration are required", () => {
  const short = Array.from({ length: 31 }, (_, index) => ({ t: index * 500, v: 500 }));
  assert.equal(isInsufficient(short), true);
  assert.equal(isInsufficient([{ t: 0, v: 34 }, { t: 60000, v: 35 }]), true);
  assert.equal(isInsufficient(Array.from({ length: 11 }, (_, index) => ({ t: index * 3000, v: 34 }))), false);
  assert.equal(isInsufficient([{ t: 0, v: NaN }, { t: 30000, v: Infinity }]), true);
});

test("trend hysteresis retains a direction near its exit threshold", () => {
  assert.equal(trendDirection(10, 10, -10, 2), "rising");
  assert.equal(trendDirection(8.5, 10, -10, { margin: 2, previousDirection: "rising" }), "rising");
  assert.equal(trendDirection(7.9, 10, -10, { margin: 2, previousDirection: "rising" }), "stable");
  assert.equal(trendDirection(-8.5, 10, -10, { margin: 2, previousDirection: "falling" }), "falling");
  assert.equal(trendDirection(-11, 10, -10, { margin: 2, previousDirection: "rising" }), "falling");
});

test("trend persistence uses observed timestamps and stops at gaps or invalid records", () => {
  const history = [{ t: 0, direction: "stable" }, { t: 2000, direction: "rising" }, { t: 4500, direction: "rising" }, { t: 7000, direction: "rising" }];
  assert.equal(trendPersistence(history), 5000);
  assert.equal(trendPersistence([...history, { t: 14000, direction: "rising" }]), 0);
  assert.equal(trendPersistence([...history, { t: 8000, direction: "rising", quality: "missing" }]), 0);
  assert.equal(trendPersistence([]), 0);
});

test("freshness rejects invalid/future times and respects its boundary", () => {
  assert.equal(isStale(1000, 5000, 6000), false);
  assert.equal(isStale(1000, 5000, 6001), true);
  assert.equal(isStale(NaN, 5000, 6000), true);
  assert.equal(isStale(7000, 5000, 6000), true);
});

test("piezo summaries and threshold duration use timestamps without waveform diagnoses", () => {
  const records = [obs("piezoVal", 600, 0), obs("piezoVal", 900, 3000), obs("piezoVal", 400, 4000)];
  const feature = extractPiezoFeatures(records);
  assert.equal(feature.current, 400);
  assert.equal(feature.maximum, 900);
  near(feature.mean, 1900 / 3);
  near(feature.standardDeviation, Math.sqrt(((600 - 1900 / 3) ** 2 + (900 - 1900 / 3) ** 2 + (400 - 1900 / 3) ** 2) / 3));
  assert.deepEqual(feature.timeAboveThresholdMs, { 500: 4000, 800: 1000 });
  assert.equal(feature.slope, null);
  for (const key of ["waveformRMS", "crestFactor", "frequencyAnalysis", "bearingFaultDiagnosis"]) {
    assert.equal(feature[key].unavailable, true);
    assert.match(feature[key].reason, /requires waveform acquisition/);
  }
});

test("instantaneous warnings work during trend warm-up", () => {
  assert.equal(extractPiezoFeatures([obs("piezoVal", 800, 0)]).thresholdState, "critical");
  assert.equal(extractTemperatureFeatures([obs("tempC", 36, 0)]).thresholdState, "warning");
  const records = [obs("tempC", 41, 0)];
  const feature = extractTemperatureFeatures(records);
  assert.equal(analyzeNumericTrend(feature, temperatureConfig).direction, null);
  assert.equal(feature.thresholdState, "critical");
});

test("stable window qualifies a reference baseline and cooling yields negative deviation", () => {
  const records = Array.from({ length: 31 }, (_, index) => obs("tempC", 34, index * 1000));
  records.push(obs("tempC", 33, 31000));
  const feature = extractTemperatureFeatures(records);
  assert.equal(feature.baseline.value, 34);
  assert.equal(feature.baselineDeviation, -1);
  assert.ok(feature.slope < 0);
  const hot = extractTemperatureFeatures(records.slice(0, 31).map(item => ({ ...item, value: 45 })));
  assert.equal(hot.baseline.value, 45);
  assert.equal(hot.thresholdState, "critical");
  assert.match(hot.baselineReason, /does not establish equipment health/);
});

test("unstable and short windows do not establish a baseline", () => {
  const unstable = Array.from({ length: 31 }, (_, index) => ({ t: index * 1000, v: index % 2 ? 30 : 40 }));
  assert.equal(findStableBaseline(unstable), null);
  assert.equal(findStableBaseline(unstable.slice(0, 10)), null);
  assert.equal(findStableBaseline([{ t: 0, v: 34 }, { t: 30000, v: 34 }]), null);
});

test("numeric windows reset after gaps, invalid samples and incompatible sources", () => {
  const prefix = Array.from({ length: 31 }, (_, index) => obs("tempC", 34, index * 1000));
  let feature = extractTemperatureFeatures([...prefix, obs("tempC", 35, 40000)]);
  assert.equal(feature.samples.length, 1);
  assert.equal(feature.baseline, null);
  feature = extractTemperatureFeatures([...prefix, obs("tempC", NaN, 31000), obs("tempC", 35, 32000)]);
  assert.equal(feature.samples.length, 1);
  feature = extractTemperatureFeatures([...prefix, obs("tempC", 35, 31000, { source: "manual" })]);
  assert.equal(feature.samples.length, 1);
  assert.equal(numericWindow([...prefix, obs("tempC", 35, 31000, { calibrationStatus: "cal-v2" })]).length, 1);
});

test("stale latest data suppresses current values, warnings, slopes and baselines", () => {
  const records = Array.from({ length: 31 }, (_, index) => obs("tempC", 41, index * 1000));
  const feature = extractTemperatureFeatures(records, { latest: { ...records.at(-1), quality: "stale" } });
  assert.equal(feature.current, null);
  assert.equal(feature.thresholdState, "unavailable");
  assert.equal(feature.baseline, null);
  assert.equal(feature.timeAboveThresholdMs[40], null);
  assert.equal(analyzeNumericTrend(feature, temperatureConfig).direction, null);
});

test("binary debounce rejects brief pulses and records a complete confirmed event", () => {
  const records = [[0, 1], [100, 0], [150, 1], [500, 0], [800, 0], [1000, 1], [1300, 1]].map(([t, v]) => obs("irLeft", v, t));
  const feature = extractBinaryFeatures(records, { debounceMs: 250 });
  assert.equal(feature.eventCount, 1);
  assert.equal(feature.events[0].startedAt, 500);
  assert.equal(feature.events[0].endedAt, 1000);
  assert.equal(feature.events[0].durationMs, 500);
  assert.equal(feature.events[0].incomplete, false);
  near(feature.frequencyPerMinute, 60000 / 1300);
  assert.equal(feature.current, "clear");
});

test("both IR beams blocked is explicit with separate side distribution", () => {
  const left = [[0, 1], [1000, 0], [2000, 0], [3000, 0]].map(([t, v]) => obs("irLeft", v, t));
  const right = [[0, 1], [1000, 1], [2000, 0], [3000, 0]].map(([t, v]) => obs("irRight", v, t));
  const feature = extractIRFeatures(left, right);
  assert.equal(feature.currentState, "bothBlocked");
  assert.equal(feature.bothBlocked, true);
  assert.equal(feature.left.eventCount, 1);
  assert.equal(feature.right.eventCount, 1);
  assert.deepEqual(feature.sideDistribution.durationMs, { left: 1000, right: 0, both: 1000, clear: 1000, unknown: 0 });
  assert.equal(feature.displacement.unavailable, true);
});

test("gaps interrupt obstruction durations and reset event frequency windows", () => {
  const records = [[0, 1], [1000, 0], [2000, 0], [9000, 0], [10000, 0]].map(([t, v]) => obs("irLeft", v, t));
  const feature = extractBinaryFeatures(records);
  assert.equal(feature.interruptedEvents.length, 1);
  assert.equal(feature.interruptedEvents[0].durationMs, 1000);
  assert.equal(feature.eventCount, 0);
  assert.equal(feature.currentEvent.leftCensored, true);
  assert.equal(feature.currentEvent.durationMs, 1000);
  assert.equal(feature.currentEvent.incomplete, true);
});

test("telemetry loss marks an open duration incomplete without extending it through unknown time", () => {
  const records = [[0, 1], [1000, 0], [2000, 0]].map(([t, v]) => obs("magState", v, t));
  const feature = extractHallFeatures(records, { latest: { ...records.at(-1), quality: "stale" } });
  assert.equal(feature.current, "unknown");
  assert.equal(feature.currentEvent, null);
  assert.equal(feature.interruptedEvents[0].durationMs, 1000);
  assert.match(feature.role, /Supporting evidence for splice zone/);
  assert.equal(feature.integrityPercentage.unavailable, true);
});

test("Hall recurring events are supporting evidence and initial blockage is not a transition", () => {
  const initial = extractHallFeatures([obs("magState", 0, 0), obs("magState", 0, 1000)]);
  assert.equal(initial.eventCount, 0);
  assert.equal(initial.events[0].leftCensored, true);
  const values = [1, 0, 0, 1, 1, 0, 0];
  const feature = extractHallFeatures(values.map((value, index) => obs("magState", value, index * 1000)));
  assert.equal(feature.eventCount, 2);
  assert.equal(feature.recurrent, true);
});

test("binary source changes isolate manual events from hardware history", () => {
  const records = [obs("irLeft", 1, 0), obs("irLeft", 0, 1000), obs("irLeft", 0, 2000), obs("irLeft", 0, 3000, { source: "manual" })];
  const feature = extractBinaryFeatures(records);
  assert.equal(feature.eventCount, 0);
  assert.equal(feature.events.length, 1);
  assert.equal(feature.currentEvent.leftCensored, true);
});
