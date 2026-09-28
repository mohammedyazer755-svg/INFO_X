import test from "node:test";
import assert from "node:assert/strict";
import { calcThroughputBeltLoad, calcThroughputGeometry, PRESETS } from "../calculations/throughput.js";
import { accumulateSample, addStateTransition, calcAvailability, classifyTimeState, createAccountingSession,
  pauseAccounting, projectShiftTonnes, suspendAccounting } from "../calculations/accounting.js";

const sample = (at, changes = {}) => ({ sampleId: `s-${at}`, at, context: "demo", tph: 360,
  quality: "valid", source: "demo", provenance: ["demo", "manual"], identity: "demo-A",
  state: "scheduledRunning", expectedThroughput: 360, ...changes });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("throughput examples, valid zero and strict invalid-input validation", () => {
  assert.equal(calcThroughputBeltLoad(PRESETS.beltLoad360.load, PRESETS.beltLoad360.speed), 360);
  const p = PRESETS.geometry360;
  assert.equal(calcThroughputGeometry(p.area, p.speed, p.density), 360);
  assert.equal(calcThroughputBeltLoad(50, 2.35), 423);
  assert.equal(calcThroughputBeltLoad(50, 0), 0);
  assert.equal(calcThroughputBeltLoad(0, 2), 0);
  assert.equal(calcThroughputGeometry(0.025, 0, 2000), 0);
  assert.equal(calcThroughputGeometry(0, 2, 2000), 0);
  for (const invalid of [NaN, Infinity, -1, undefined, null, "", "50"]) {
    const result = calcThroughputBeltLoad(invalid, 2);
    assert.equal(result.unavailable, true);
    assert.ok(result.reason);
  }
  assert.match(calcThroughputGeometry(0.025, 2, -1).reason, /density/);
  assert.equal(calcThroughputBeltLoad(undefined, 0).unavailable, true);
  assert.equal(calcThroughputBeltLoad(Number.MAX_VALUE, 2).unavailable, true);
});

test("left-hold accumulation uses elapsed time including low-speed and valid zero flow", () => {
  let session = createAccountingSession("demo");
  session = accumulateSample(session, sample(1000));
  session = accumulateSample(session, sample(2500, { tph: 180 }));
  session = accumulateSample(session, sample(5000, { tph: 0 }));
  session = accumulateSample(session, sample(6000, { tph: 0 }));
  near(session.accumulatedTonnes, 360 * 1.5 / 3600 + 180 * 2.5 / 3600);
  assert.equal(session.timeMs.scheduledRunning, 5000);
  assert.equal(calcAvailability(session), 100);
  let low = accumulateSample(createAccountingSession("demo"), sample(1000, { tph: 0.18 }));
  low = accumulateSample(low, sample(2000, { tph: 0.18 }));
  near(low.accumulatedTonnes, 0.18 / 3600);
});

test("duplicates and late samples cannot double-count or rewind totals", () => {
  let session = accumulateSample(createAccountingSession("demo"), sample(1000));
  session = accumulateSample(session, sample(2000));
  assert.equal(accumulateSample(session, sample(2000)), session);
  assert.equal(accumulateSample(session, sample(1500)), session);
  assert.equal(accumulateSample(session, sample(3000, { sampleId: "s-2000" })), session);
  near(session.accumulatedTonnes, 0.1);
});

test("state and expected-rate transitions split a single observed interval", () => {
  let session = accumulateSample(createAccountingSession("demo"), sample(1000));
  session = addStateTransition(session, { at: 2000, state: "confirmedUnplannedStop", expectedThroughput: 360 });
  session = addStateTransition(session, { at: 3000, state: "confirmedUnplannedStop", expectedThroughput: 720 });
  session = addStateTransition(session, { at: 4000, state: "plannedIdle", expectedThroughput: 720 });
  session = accumulateSample(session, sample(5000, { state: "plannedIdle", tph: 0, expectedThroughput: 720 }));
  assert.deepEqual(session.timeMs, { scheduledRunning: 1000, confirmedUnplannedStop: 2000, plannedIdle: 1000, unknown: 0 });
  near(session.accumulatedTonnes, 0.1);
  near(session.lostTonnes, 0.3);
  near(calcAvailability(session), 100 / 3);
});

test("unknown segments and planned idle do not accumulate flow or loss", () => {
  let session = accumulateSample(createAccountingSession("demo"), sample(1000, { state: "unknown" }));
  session = addStateTransition(session, { at: 2000, state: "plannedIdle", expectedThroughput: 360 });
  session = accumulateSample(session, sample(4000, { state: "plannedIdle" }));
  assert.equal(session.accumulatedTonnes, 0);
  assert.equal(session.lostTonnes, 0);
  assert.equal(session.timeMs.unknown, 1000);
  assert.equal(session.timeMs.plannedIdle, 2000);
  assert.equal(calcAvailability(session).unavailable, true);
});

test("gaps, stale/invalid endpoints and changed sources reject the whole interval", () => {
  for (const change of [{ quality: "stale" }, { quality: "invalid" }, { identity: "demo-B" }, { at: 10000, sampleId: "late" }]) {
    let session = accumulateSample(createAccountingSession("demo"), sample(1000));
    session = accumulateSample(session, sample(2000, change));
    assert.equal(session.accumulatedTonnes, 0);
    assert.equal(session.lostTonnes, 0);
    assert.ok(session.timeMs.unknown > 0);
  }
  let suspended = accumulateSample(createAccountingSession("demo"), sample(1000));
  suspended = suspendAccounting(suspended);
  suspended = accumulateSample(suspended, sample(2000));
  assert.equal(suspended.accumulatedTonnes, 0);
  suspended = accumulateSample(suspended, sample(3000));
  near(suspended.accumulatedTonnes, 0.1);
});

test("reload and inactive-context gaps start with a new interval boundary", () => {
  let session = accumulateSample(createAccountingSession("demo"), sample(1000));
  session = accumulateSample(session, sample(2000));
  session = pauseAccounting(session);
  session = accumulateSample(session, sample(90000));
  near(session.accumulatedTonnes, 0.1);
  const reloaded = accumulateSample(createAccountingSession("demo"), sample(90000));
  assert.equal(reloaded.accumulatedTonnes, 0);
  assert.equal(accumulateSample(reloaded, sample(91000, { context: "hardware" })), reloaded);
});

test("stoppage requires explicit confirmation and a scheduled observed interval", () => {
  assert.equal(classifyTimeState({ speed: 0, quality: "valid" }), "unknown");
  assert.equal(classifyTimeState({ speed: 0.01, quality: "valid" }), "scheduledRunning");
  assert.equal(classifyTimeState({ speed: 0, quality: "valid", confirmedState: "confirmedUnplannedStop" }), "confirmedUnplannedStop");
  assert.equal(classifyTimeState({ speed: 0, quality: "valid", scheduled: false, confirmedState: "confirmedUnplannedStop" }), "plannedIdle");
  assert.equal(classifyTimeState({ speed: 0, quality: "stale", confirmedState: "confirmedUnplannedStop" }), "unknown");
  let session = accumulateSample(createAccountingSession("demo"), sample(0, { state: "confirmedUnplannedStop", tph: 0 }));
  session = accumulateSample(session, sample(7200000, { state: "confirmedUnplannedStop", tph: 0 }), { maxGapMs: 7200000 });
  assert.equal(session.lostTonnes, 720);
  assert.equal(session.accumulatedTonnes, 0);
});

test("invalid loss baseline is recorded as unknown loss rather than zero", () => {
  let session = accumulateSample(createAccountingSession("demo"), sample(1000, { state: "confirmedUnplannedStop", expectedThroughput: "" }));
  session = accumulateSample(session, sample(2000, { state: "confirmedUnplannedStop", expectedThroughput: "" }));
  assert.equal(session.lossUnknownMs, 1000);
});

test("shift projection is a separate assumed result", () => {
  assert.equal(projectShiftTonnes(0, 8, 360, 1), 2880);
  assert.equal(projectShiftTonnes(100, 2, 360, 0.5), 460);
  assert.equal(projectShiftTonnes(100, 0, 360, 1), 100);
  assert.equal(projectShiftTonnes(0, 8, 360, 1.2).unavailable, true);
});
