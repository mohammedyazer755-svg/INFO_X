import test from "node:test";
import assert from "node:assert/strict";
import { NODE_REGISTRY, getWaypoints } from "../config/nodes.js";
import { createDroneMission, droneStateMachine as send, missionTelemetry, snapshotLinkedEvidence } from "../simulation/droneStateMachine.js";
import { createDroneController } from "../simulation/droneController.js";

const tick = (state, deltaMs, condition = null) => send(state, { type: "tick", deltaMs, condition, capturedAt: 1000 });
const condition = { context: "hardware", modules: [{ id: "mechanical", label: "Mechanical", nodeId: "NODE 01", status: "active", source: "hardware",
  score: 60, quality: "valid", reasons: ["Vibration 620 ADC"], features: { current: 620 }, observationWindow: { start: 0, end: 1000, sampleCount: 10 } }], supportingEvidence: [] };

test("FSM accepts only valid commands and follows the full declared mission sequence", () => {
  let state = createDroneMission();
  for (const type of ["pause", "resume", "returnToBase", "inspect", "complete", "tick"]) assert.equal(send(state, { type, deltaMs: 5000 }), state);
  state = send(state, { type: "start", nodeId: "NODE 01" });
  assert.equal(state.phase, "takingOff");
  assert.equal(send(state, { type: "start" }), state);
  state = tick(state, 5000); assert.equal(state.phase, "travelling");
  state = tick(state, 12500, condition); assert.equal(state.phase, "inspecting");
  assert.equal(state.positionM, 150);
  assert.equal(state.findings.length, 0);
  state = tick(state, 9999, condition); assert.equal(state.phase, "inspecting");
  state = tick(state, 1, condition); assert.equal(state.phase, "returning");
  assert.equal(state.findings.length, 1);
  assert.equal(state.findings[0].tag, "SIMULATION");
  assert.equal(state.findings[0].modules[0].score, 60);
  state = tick(state, 12500); assert.equal(state.phase, "returning"); // Landing, not yet complete.
  state = tick(state, 5000); assert.equal(state.phase, "complete");
  assert.equal(state.positionM, 0);
  assert.equal(state.distanceM, 300);
  assert.equal(state.elapsedMissionMs, 45000);
  assert.equal(state.batteryPct, 97.75);
  assert.equal(missionTelemetry(state).progress, 1);
  assert.equal(send(state, { type: "start" }), state);
});

test("tick boundaries are deterministic at irregular tick sizes and multiple waypoints", () => {
  const start = send(createDroneMission(), { type: "start" });
  const batch = tick(start, 1000000);
  let incremental = start;
  for (let i = 0; i < 5000 && incremental.phase !== "complete"; i++) incremental = tick(incremental, 137);
  assert.equal(batch.phase, "complete");
  assert.equal(batch.findings.length, 4);
  assert.deepEqual(batch.findings.map(item => item.nodeId), ["NODE 01", "NODE 02", "NODE 03", "NODE 04"]);
  assert.ok(Math.abs(incremental.elapsedMissionMs - batch.elapsedMissionMs) < 1e-6);
  assert.ok(Math.abs(incremental.distanceM - 4700) < 1e-6);
  assert.ok(Math.abs(incremental.batteryPct - batch.batteryPct) < 1e-6);
});

test("pause/resume freezes all telemetry; early return skips unfinished evidence and reset cleans mission state", () => {
  let state = tick(send(createDroneMission(), { type: "start" }), 10000);
  assert.equal(missionTelemetry(state).speedMps, 12);
  state = send(state, { type: "pause" });
  assert.equal(missionTelemetry(state).speedMps, 0);
  assert.equal(tick(state, 100000), state);
  state = send(state, { type: "resume" });
  state = tick(state, 7500, condition);
  assert.equal(state.phase, "inspecting");
  state = send(send(state, { type: "pause" }), { type: "returnToBase" });
  assert.equal(state.phase, "returning"); assert.equal(state.paused, false);
  assert.equal(state.pendingFinding, null);
  state = tick(state, 17500);
  assert.equal(state.findings.length, 0); assert.equal(state.phase, "complete");
  const fresh = send(state, { type: "reset" });
  assert.equal(fresh.phase, "idle"); assert.equal(fresh.elapsedMissionMs, 0); assert.equal(fresh.batteryPct, 100);
  assert.deepEqual(fresh.findings, []); assert.deepEqual(fresh.route, []);
  assert.equal(fresh.pendingFinding, null);
});

test("registry maps evidence to configured nodes and validates coordinates, timing and dispatch", () => {
  assert.deepEqual(getWaypoints().map(node => node.positionM), [150, 850, 1600, 2350]);
  assert.deepEqual(getWaypoints(NODE_REGISTRY, "NODE 03")[0].supportingIds, ["hall"]);
  const custom = { type: "demo", lengthKm: 1, baseKm: 0.1, nodes: { ZONE: { label: "Configured zone", km: 0.6, moduleIds: ["thermal"] } } };
  const started = send(createDroneMission(custom), { type: "start", nodeId: "ZONE" });
  assert.equal(started.route[0].label, "Configured zone");
  assert.equal(started.positionM, 100);
  assert.equal(tick(started, 1000000).positionM, 100);
  const idle = createDroneMission();
  assert.equal(send(idle, { type: "start", nodeId: "unknown" }), idle);
  assert.throws(() => getWaypoints({ ...custom, lengthKm: -1 }), TypeError);
  assert.throws(() => createDroneMission(NODE_REGISTRY, { timeScale: 0 }), TypeError);
});

test("findings are immutable linked evidence snapshots, with freshness/context isolation and no invented sensors", () => {
  const node = getWaypoints()[0];
  const evidence = structuredClone(condition);
  const snapshot = snapshotLinkedEvidence(node, evidence, 1000, 17500);
  evidence.modules[0].features.current = 900;
  evidence.modules[0].reasons.push("Changed later");
  assert.equal(snapshot.modules[0].features.current, 620);
  assert.deepEqual(snapshot.modules[0].reasons, ["Vibration 620 ADC"]);
  assert.match(snapshot.description, /Linked sensor evidence/);
  assert.equal(snapshotLinkedEvidence(node, condition, 6001, 0).modules[0].score, null);
  assert.equal(snapshotLinkedEvidence(node, { ...condition, context: "demo" }, 1000, 0).modules[0].status, "unavailable");
  assert.deepEqual(snapshotLinkedEvidence(getWaypoints()[3], condition, 1000, 0).modules, []);
  const camera = { id: "vision", label: "Vision", nodeId: "NODE 03", status: "unavailable", source: "unavailable", score: null,
    quality: "missing", reasons: ["Camera not integrated."], features: {}, observationWindow: { start: null, end: null, sampleCount: 0 } };
  const missing = snapshotLinkedEvidence(getWaypoints()[2], { ...condition, modules: [camera] }, 1000, 0).modules[0];
  assert.equal(missing.quality, "missing");
  assert.ok(missing.reasons.includes("Camera not integrated."));
  const hall = { id: "hall", label: "Hall", nodeId: "NODE 03", source: "hardware", quality: "valid", reasons: ["Supporting evidence"],
    features: { eventCount: 2 }, observationWindow: { start: 0, end: 1000, sampleCount: 10 } };
  const splice = snapshotLinkedEvidence(getWaypoints()[2], { ...condition, supportingEvidence: [hall] }, 1000, 0);
  assert.equal(splice.supporting[0].score, null);
});

function controllerFixture() {
  let time = 0, nextId = 0;
  const timers = new Map();
  const controller = createDroneController({ now: () => time, wallNow: () => time, getCondition: () => condition,
    schedule: (callback, delay) => { timers.set(++nextId, { callback, delay }); return nextId; }, cancel: id => timers.delete(id) });
  const disconnect = controller.connect();
  return { controller, timers, disconnect, advance(ms) {
    time += ms; const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(item => item.callback());
  } };
}

test("controller pauses while viewport is hidden without wall-clock catch-up, and cleans timers on reset/disconnect", () => {
  const f = controllerFixture();
  try {
    f.controller.start(); assert.equal(f.timers.size, 0);
    f.controller.setVisible(true); assert.equal(f.timers.size, 1);
    f.advance(100); assert.equal(f.controller.getSnapshot().mission.elapsedMissionMs, 1000);
    f.controller.setVisible(false); assert.equal(f.timers.size, 0);
    const hidden = f.controller.getSnapshot().mission;
    f.advance(60000); assert.equal(f.controller.getSnapshot().mission, hidden);
    f.controller.setVisible(true); f.advance(100);
    assert.equal(f.controller.getSnapshot().mission.elapsedMissionMs, 2000);
    f.controller.pause(); assert.equal(f.timers.size, 0);
    f.controller.resume(); assert.equal(f.timers.size, 1);
    f.controller.reset(); assert.equal(f.timers.size, 0);
    assert.equal(f.controller.getSnapshot().mission.phase, "idle");
    f.controller.start(); assert.equal(f.timers.size, 1);
    f.disconnect(); assert.equal(f.timers.size, 0);
  } finally { f.disconnect(); }
});

test("reduced motion uses discrete one-second updates with the same declared simulation scale", () => {
  const f = controllerFixture();
  try {
    f.controller.setReducedMotion(true); f.controller.setVisible(true); f.controller.start("NODE 01");
    assert.equal([...f.timers.values()][0].delay, 1000);
    f.advance(1000);
    assert.equal(f.controller.getSnapshot().mission.elapsedMissionMs, 10000);
    assert.equal(f.controller.getSnapshot().mission.positionM, 60);
    assert.equal(f.controller.getSnapshot().telemetry.batteryPct, 99.5);
    f.controller.setReducedMotion(false);
    assert.equal([...f.timers.values()][0].delay, 100);
  } finally { f.disconnect(); }
});
