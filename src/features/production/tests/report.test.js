import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createProductionReport, downloadProductionReport, REPORT_VERSION, REPORT_BANDS } from "../calculations/report.js";
import { createTelemetryStore } from "../telemetry/telemetryStore.js";
import { createThroughputController } from "../hooks/throughputController.js";
import { createFeatureEngineeringController } from "../hooks/featureEngineeringController.js";
import { deriveTemporalAnalysis } from "../hooks/useTemporalAnalysis.js";
import { mechanicalModule } from "../modules/mechanicalModule.js";
import { thermalModule } from "../modules/thermalModule.js";
import { trackingModule } from "../modules/trackingModule.js";
import { visionModule } from "../modules/visionModule.js";
import { energyModule } from "../modules/energyModule.js";
import { conditionEngine } from "../modules/conditionEngine.js";
import { conditionBand } from "../modules/moduleContract.js";
import { generateRecommendations } from "../modules/recommendations.js";
import { createDroneMission, droneStateMachine } from "../simulation/droneStateMachine.js";

function fixture(populated = true) {
  let time = 1700000000000;
  const store = createTelemetryStore({ now: () => time, schedule: () => 0, cancel: () => {} });
  const production = createThroughputController(store), feature = createFeatureEngineeringController(store);
  const cleanups = [production.connect(), feature.connect()];
  if (populated) for (let i = 0; i <= 30; i++) {
    time = 1700000000000 + i * 1000;
    for (const [field, value] of Object.entries({ tempC: 32, piezoVal: 180, irLeft: 1, irRight: 1, speed: 2 })) store.publish({ field, value,
      source: "demo", acquiredAt: time, receivedAt: time, deviceId: "http://user:super-secret@192.168.2.5:5000/api/sensors", scenarioTag: "normal" });
  }
  const features = feature.getSnapshot(), trend = deriveTemporalAnalysis(features);
  const modules = [mechanicalModule(features.piezoVal, trend.piezoVal), thermalModule(features.tempC, trend.tempC), trackingModule(features.tracking), visionModule(), energyModule()];
  const condition = conditionEngine(modules, { context: "demo", now: time, config: { weights: { mechanical: 0.31 } } });
  condition.recommendations = generateRecommendations(condition);
  let mission = droneStateMachine(createDroneMission(), { type: "start", nodeId: "NODE 01" });
  mission = droneStateMachine(mission, { type: "tick", deltaMs: 28000, capturedAt: time, condition });
  return { state: { production: production.getSnapshot(), telemetry: store.getSnapshot(), features, condition, drone: { mission },
    scenario: { name: "normal", source: "scenario", seed: 42, timeScale: 10, elapsedMs: 30000, running: false } }, close: () => cleanups.forEach(fn => fn()) };
}

test("versioned report includes units, provenance, actual weights, coverage and independent projections", () => {
  const f = fixture();
  try {
    const report = createProductionReport(f.state, { generatedAt: 1700000040000 });
    assert.equal(report.version, REPORT_VERSION);
    assert.equal(report.generatedAt, "2023-11-14T22:14:00.000Z");
    assert.deepEqual(report.observationPeriod, { start: 1700000000000, end: 1700000030000, timestampUnit: "UTC epoch ms", clock: "shared scenario simulation clock" });
    assert.equal(report.inputs.params.beltLoad.unit, "kg/m");
    assert.equal(report.inputs.params.area.unit, "m²");
    assert.equal(report.inputs.params.density.unit, "kg/m³");
    assert.equal(report.provenance.speed.source, "demo"); assert.equal(report.provenance.speed.quality, "valid");
    assert.equal(report.provenance.tempC.scenarioTag, "normal");
    assert.equal(report.throughput.current.value, 360); assert.equal(report.throughput.current.source, "demo");
    assert.equal(report.throughput.accumulated.value, f.state.production.metrics.accumulated.value);
    assert.equal(report.throughput.projected.label, "ASSUMED");
    assert.equal(report.configuration.weights.mechanical, 0.31);
    assert.equal(report.modules.vision.score, null); assert.equal(report.modules.energy.status, "unavailable");
    assert.equal(report.modules.mechanical.window.sampleCount, 31);
    assert.equal(report.conditionEngine.coverage.total, 5);
    assert.equal(report.accounting.running.unit, "s");
    assert.equal(report.droneFindings[0].tag, "SIMULATION");
    assert.equal(report.droneFindings[0].modules[0].source, "demo");
    assert.ok(report.limitations.some(text => text.includes("manually assumed belt loading")));
    f.state.production.settings.mode = "geometry";
    assert.ok(createProductionReport(f.state).limitations.includes("Throughput estimated via geometry model, not measured by belt scale"));
  } finally { f.close(); }
});

test("report allowlists and text redaction exclude credentials, raw connection metadata and unknown fields", () => {
  const f = fixture();
  try {
    f.state.password = "super-secret";
    f.state.configuration = { endpoint: "http://secret-host" };
    f.state.condition.modules[0].features.credentials = { token: "super-secret" };
    f.state.condition.modules[0].features.current = { password: "super-secret" };
    f.state.condition.modules[0].features.latest = f.state.telemetry.tempC.latest;
    f.state.condition.modules[0].reasons.push("Diagnostic URL http://user:super-secret@192.168.2.5:5000/api; password=super-secret");
    const text = JSON.stringify(createProductionReport(f.state));
    for (const value of ["super-secret", "192.168.2.5", "secret-host", "deviceId", "credentials", "http://"]) assert.equal(text.includes(value), false, value);
    assert.ok(text.includes("connection detail omitted"));
    assert.equal(createProductionReport(f.state).modules.mechanical.features.current, null);
    assert.doesNotThrow(() => JSON.parse(text));
  } finally { f.close(); }
});

test("report preserves unavailable null, valid zero, unknown coverage and instantaneous critical evidence", () => {
  const f = fixture(false);
  try {
    let report = createProductionReport(f.state);
    assert.equal(report.throughput.current.value, null); assert.equal(report.conditionEngine.health, null);
    assert.equal(report.accounting.coverage.value, null); assert.equal(report.observationPeriod.start, null);
    f.state.production.flow = { value: 0, unit: "t/h", source: "demo", quality: "valid", unavailable: false };
    f.state.condition.criticalIndicators = [{ moduleId: "mechanical", score: null, status: "collecting", reason: "900 ADC current critical", nodeId: "NODE 01" }];
    report = createProductionReport(f.state);
    assert.equal(report.throughput.current.value, 0);
    assert.equal(report.conditionEngine.criticalIndicators[0].score, null);
    assert.ok(report.conditionEngine.coverage.excluded.length > 0);
    f.state.production.flow = { value: null, source: "demo", quality: "stale", unavailable: true };
    assert.equal(createProductionReport(f.state).throughput.current.value, null);
  } finally { f.close(); }
});

test("exported bands match condition evaluation including score 64 Watch/Moderate", () => {
  assert.deepEqual(conditionBand(64), { condition: "Watch", risk: "Moderate", tone: "watch" });
  for (const score of [0, 19.9, 20, 39.9, 40, 59.9, 60, 64, 79.9, 80, 100]) {
    const band = REPORT_BANDS.find(item => score >= item.min && (item.maxInclusive ? score <= item.max : score < item.max));
    assert.equal(band.condition, conditionBand(score).condition); assert.equal(band.risk, conditionBand(score).risk);
  }
});

test("JSON download creates a parseable blob and revokes its URL without storage writes", async () => {
  const f = fixture(); const dom = new JSDOM('<!doctype html><body></body>');
  const previousDocument = globalThis.document, previousCreate = URL.createObjectURL, previousRevoke = URL.revokeObjectURL;
  globalThis.document = dom.window.document;
  let blob, filename, revoked;
  URL.createObjectURL = value => { blob = value; return "blob:report-test"; };
  URL.revokeObjectURL = value => { revoked = value; };
  dom.window.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
  try {
    downloadProductionReport(createProductionReport(f.state));
    assert.equal(blob.type, "application/json");
    assert.equal(JSON.parse(await blob.text()).version, REPORT_VERSION);
    assert.match(filename, /^navix-production-v1-.*\.json$/);
    assert.equal(revoked, "blob:report-test");
    assert.equal(document.querySelector("a"), null);
  } finally { f.close(); dom.window.close(); globalThis.document = previousDocument; URL.createObjectURL = previousCreate; URL.revokeObjectURL = previousRevoke; }
});
