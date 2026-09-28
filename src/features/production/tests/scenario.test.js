import test from "node:test";
import assert from "node:assert/strict";
import { createTelemetryStore } from "../telemetry/telemetryStore.js";
import { createScenarioEngine, scenarioFixture, SCENARIOS, SCENARIO_EPOCH } from "../simulation/scenarioEngine.js";
import { createThroughputController, DEFAULT_INPUTS } from "../hooks/throughputController.js";
import { createFeatureEngineeringController } from "../hooks/featureEngineeringController.js";
import { deriveTemporalAnalysis } from "../hooks/useTemporalAnalysis.js";
import { mechanicalModule } from "../modules/mechanicalModule.js";
import { thermalModule } from "../modules/thermalModule.js";
import { trackingModule } from "../modules/trackingModule.js";
import { visionModule } from "../modules/visionModule.js";
import { energyModule } from "../modules/energyModule.js";
import { conditionEngine } from "../modules/conditionEngine.js";
import { generateRecommendations } from "../modules/recommendations.js";
import { createDroneController } from "../simulation/droneController.js";

function fixture(name = "normal", scale = 10) {
  let liveTime = SCENARIO_EPOCH + 1000000000, production, drone;
  const live = createTelemetryStore({ now: () => liveTime, schedule: () => 0, cancel: () => {} });
  const engine = createScenarioEngine(live, { schedule: () => 0, cancel: () => {},
    onContext: context => { production?.updateInputs({ context }); drone?.reset(); },
    onReset: () => { production?.updateInputs({ ...DEFAULT_INPUTS, context: "demo" }); production?.resetSession(); drone?.reset(); },
    onFrame: frame => production?.updateInputs({ mode: "beltLoad", load: frame.load, speedMode: "telemetry", scheduled: true, confirmedState: frame.confirmedState }) });
  production = createThroughputController(engine.store);
  const features = createFeatureEngineeringController(engine.store);
  const condition = () => {
    const feature = features.getSnapshot(), trend = deriveTemporalAnalysis(feature);
    const modules = [mechanicalModule(feature.piezoVal, trend.piezoVal), thermalModule(feature.tempC, trend.tempC),
      trackingModule(feature.tracking), visionModule(), energyModule()];
    const result = conditionEngine(modules, { context: production.getSnapshot().settings.context, now: engine.store.getCurrentTime() });
    return { ...result, recommendations: generateRecommendations(result) };
  };
  drone = createDroneController({ getCondition: condition });
  const disconnects = [production.connect(), features.connect(), drone.connect()];
  engine.configure({ name, timeScale: scale });
  return { live, engine, production, features, drone, condition,
    start() { engine.start(); drone.setClock(engine.clock); drone.setVisible(true); },
    advance(seconds) { engine.advance(seconds * 1000 / engine.getSnapshot().timeScale); },
    publishHardware(value = 2) {
      liveTime += 1000;
      for (const [field, reading] of Object.entries({ speed: value, tempC: 32, piezoVal: 180, irLeft: 1, irRight: 1 })) live.publish({ field, value: reading, source: "hardware",
        acquiredAt: liveTime, receivedAt: liveTime, calibrationStatus: "calibrated", deviceId: "ESP32-test" });
    },
    close() { disconnects.forEach(cleanup => cleanup()); engine.pause(); } };
}

test("six explicitly tagged seeded fixtures produce declared rates and only explicit stop confirms downtime", () => {
  assert.equal(Object.keys(SCENARIOS).length, 6);
  for (const name of Object.keys(SCENARIOS)) assert.deepEqual(scenarioFixture(name, 80000, 42), scenarioFixture(name, 80000, 42));
  assert.notEqual(scenarioFixture("normal", 5000, 42).values.piezoVal, scenarioFixture("normal", 5000, 43).values.piezoVal);
  assert.ok(Math.abs(scenarioFixture("risingTemp", 60000).values.tempC - scenarioFixture("risingTemp", 0).values.tempC - 0.4) < 1e-10);
  for (const name of Object.keys(SCENARIOS)) assert.equal(scenarioFixture(name, 80000).confirmedState,
    name === "confirmedDemoStop" ? "confirmedUnplannedStop" : "auto");
});

test("normal and reduced-loading scenarios give stable condition and separate actual flow", () => {
  for (const [name, tph] of [["normal", 360], ["reducedLoading", 252]]) {
    const f = fixture(name);
    try {
      f.start(); f.advance(60);
      assert.equal(f.production.getSnapshot().flow.value, tph);
      assert.ok(f.condition().score >= 80);
      assert.equal(f.engine.store.getSnapshot().tempC.latest.source, "demo");
      assert.equal(f.engine.store.getSnapshot().tempC.latest.scenarioTag, name);
      assert.equal(f.production.getSnapshot().sessions.hardware.accumulatedTonnes, 0);
    } finally { f.close(); }
  }
});

test("accelerated temperature and vibration slopes, persistence and production accounting use simulation time", () => {
  for (const scale of [1, 10, 60]) {
    const f = fixture("combinedThermalMechanical", scale);
    try {
      f.start(); f.advance(120);
      const trend = deriveTemporalAnalysis(f.features.getSnapshot());
      assert.ok(Math.abs(trend.tempC.slope - 0.4) < 1e-10);
      assert.ok(Math.abs(trend.piezoVal.slope - 24) < 1e-10);
      assert.equal(trend.tempC.persistenceMs, 89000); // Qualification starts at second 31 in the retained 120-sample window.
      assert.ok(Math.abs(f.production.getSnapshot().metrics.accumulated.value - 12) < 1e-10);
      assert.equal(f.production.getSnapshot().accountingSession.timeMs.confirmedUnplannedStop, 0);
      assert.equal(f.engine.clock.getTime(), SCENARIO_EPOCH + 120000);
    } finally { f.close(); }
  }
});

test("repeatability is independent of accelerated playback and irregular advance batching", () => {
  const a = fixture("combinedThermalMechanical", 1), b = fixture("combinedThermalMechanical", 30);
  try {
    a.start(); b.start(); a.advance(180);
    for (const seconds of [0.5, 10.5, 0.2, 48.8, 120]) b.advance(seconds);
    assert.deepEqual(a.engine.store.getRecordedHistory("tempC"), b.engine.store.getRecordedHistory("tempC"));
    assert.equal(a.condition().score, b.condition().score);
    assert.deepEqual(a.condition().recommendations, b.condition().recommendations);
    assert.equal(a.production.getSnapshot().metrics.accumulated.value, b.production.getSnapshot().metrics.accumulated.value);
  } finally { a.close(); b.close(); }
});

test("warning, corroboration and recommendation suggest explicit drone inspection at mapped waypoint", () => {
  const f = fixture("combinedThermalMechanical");
  try {
    f.start(); f.advance(90);
    const result = f.condition();
    assert.ok(result.eligibleModules.some(module => module.score < 80));
    assert.equal(result.totalModifier, 15);
    const suggested = result.recommendations.find(item => item.suggestedInspectionNode);
    assert.equal(suggested.suggestedInspectionNode, "NODE 01");
    assert.equal(f.drone.getSnapshot().mission.phase, "idle");
    f.drone.start(suggested.suggestedInspectionNode);
    f.advance(28);
    assert.equal(f.drone.getSnapshot().mission.findings.length, 1);
    const finding = f.drone.getSnapshot().mission.findings[0];
    assert.equal(finding.tag, "SIMULATION");
    assert.equal(finding.modules[0].source, "demo");
    assert.equal(finding.capturedAt, SCENARIO_EPOCH + 108000);
    assert.equal(f.drone.getSnapshot().mission.elapsedMissionMs, 28000);
    assert.equal(f.drone.getSnapshot().telemetry.batteryPct, 98.6);
  } finally { f.close(); }
});

test("confirmed demo stop counts loss only over explicit simulated downtime; rising temperature never stops", () => {
  const stopped = fixture("confirmedDemoStop"), rising = fixture("risingTemp");
  try {
    stopped.start(); rising.start(); stopped.advance(150); rising.advance(150);
    assert.equal(stopped.production.getSnapshot().accountingSession.timeMs.confirmedUnplannedStop, 60000);
    assert.ok(Math.abs(stopped.production.getSnapshot().metrics.loss.value - 6) < 1e-10);
    assert.equal(rising.production.getSnapshot().metrics.loss.value, 0);
    assert.equal(rising.production.getSnapshot().accountingSession.timeMs.confirmedUnplannedStop, 0);
  } finally { stopped.close(); rising.close(); }
});

test("telemetry loss expires analysis and forecasts by simulated freshness then requires new windows", () => {
  const f = fixture("telemetryLoss");
  try {
    f.start(); f.advance(70);
    assert.equal(f.engine.store.getSnapshot().speed.latest.quality, "stale");
    assert.equal(f.condition().score, null);
    assert.equal(f.production.getSnapshot().forecast.unavailable, true);
    assert.equal(f.production.getSnapshot().metrics.loss.value, 0);
    f.advance(50); assert.equal(f.features.getSnapshot().tempC.samples.length, 1);
    assert.equal(deriveTemporalAnalysis(f.features.getSnapshot()).tempC.direction, null);
    f.advance(30); assert.equal(f.production.getSnapshot().forecast.unavailable, false);
    assert.ok(f.production.getSnapshot().accountingSession.timeMs.unknown >= 61000);
  } finally { f.close(); }
});

test("pause freezes the shared clock; hidden drone freezes flight while accounting continues", () => {
  const f = fixture();
  try {
    f.start(); f.drone.start("NODE 01"); f.advance(10);
    assert.equal(f.drone.getSnapshot().mission.positionM, 60);
    f.engine.pause(); f.advance(60);
    assert.equal(f.engine.getSnapshot().elapsedMs, 10000);
    assert.equal(f.drone.getSnapshot().mission.elapsedMissionMs, 10000);
    f.engine.start(); f.drone.setVisible(false); f.advance(20);
    assert.equal(f.drone.getSnapshot().mission.elapsedMissionMs, 10000);
    assert.ok(Math.abs(f.production.getSnapshot().metrics.accumulated.value - 3) < 1e-10);
    f.drone.setVisible(true); f.advance(1);
    assert.equal(f.drone.getSnapshot().mission.elapsedMissionMs, 11000);
  } finally { f.close(); }
});

test("returning to hardware discards incompatible windows and preserves independent hardware totals", () => {
  const f = fixture("combinedThermalMechanical");
  try {
    f.production.updateInputs({ context: "hardware" }); f.publishHardware(); f.publishHardware();
    const hardwareTonnes = f.production.getSnapshot().sessions.hardware.accumulatedTonnes;
    assert.equal(hardwareTonnes, 0.1);
    f.start(); f.advance(90);
    const scenarioLatest = f.engine.store.getSnapshot().tempC.latest;
    f.publishHardware();
    assert.equal(f.engine.store.getSnapshot().tempC.latest, scenarioLatest);
    assert.equal(f.live.getSnapshot().tempC.latest.source, "hardware");
    assert.ok(f.production.getSnapshot().sessions.demo.accumulatedTonnes > hardwareTonnes);
    f.engine.selectSource("live");
    assert.equal(f.engine.store.getRecordedHistory("tempC").length, 0);
    assert.equal(f.engine.demoStore.getRecordedHistory("tempC").length, 0);
    assert.equal(f.features.getSnapshot().tempC.samples.length, 0);
    assert.equal(f.condition().score, null);
    assert.equal(f.production.getSnapshot().sessions.hardware.accumulatedTonnes, hardwareTonnes);
    f.publishHardware(); assert.equal(f.features.getSnapshot().tempC.samples.length, 1);
    assert.equal(f.production.getSnapshot().sessions.hardware.accumulatedTonnes, hardwareTonnes);
    f.publishHardware(); assert.equal(f.production.getSnapshot().sessions.hardware.accumulatedTonnes, hardwareTonnes + 0.1);
    assert.equal(f.engine.getSnapshot().running, false);
  } finally { f.close(); }
});

test("reset clears demo histories, totals, drone findings and permits identical seeded replay", () => {
  const f = fixture("combinedThermalMechanical");
  try {
    f.start(); f.advance(90);
    const first = f.engine.store.getRecordedHistory("tempC"), score = f.condition().score;
    f.drone.start("NODE 01"); f.advance(28);
    assert.equal(f.drone.getSnapshot().mission.findings.length, 1);
    f.engine.reset();
    assert.equal(f.engine.getSnapshot().elapsedMs, 0);
    assert.equal(f.engine.store.getRecordedHistory("tempC").length, 0);
    assert.equal(f.production.getSnapshot().accountingSession.accumulatedTonnes, 0);
    assert.equal(f.drone.getSnapshot().mission.phase, "idle");
    assert.deepEqual(f.drone.getSnapshot().mission.findings, []);
    f.engine.start(); f.advance(90);
    assert.deepEqual(f.engine.store.getRecordedHistory("tempC"), first);
    assert.equal(f.condition().score, score);
    assert.equal(f.production.getSnapshot().forecast.value, 360);
    f.engine.pause(); f.engine.configure({ name: "normal" });
    assert.equal(f.engine.store.getRecordedHistory("tempC").length, 0);
  } finally { f.close(); }
});
