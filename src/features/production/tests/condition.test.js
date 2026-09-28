import test from "node:test";
import assert from "node:assert/strict";
import { CONDITION_CONFIG, CONVEYOR_LAYOUT } from "../config/conditionConfig.js";
import { conditionBand, createModuleResult } from "../modules/moduleContract.js";
import { mechanicalModule } from "../modules/mechanicalModule.js";
import { thermalModule } from "../modules/thermalModule.js";
import { trackingModule } from "../modules/trackingModule.js";
import { visionModule } from "../modules/visionModule.js";
import { energyModule } from "../modules/energyModule.js";
import { conditionEngine, hallSupportingEvidence } from "../modules/conditionEngine.js";
import { generateRecommendations } from "../modules/recommendations.js";

function numeric(current, field = "piezoVal", changes = {}) {
  const thermal = field === "tempC";
  const thresholds = thermal ? [35, 40] : [500, 800];
  return { current, source: "hardware", quality: "valid", sufficient: true, unit: thermal ? "°C" : "ADC",
    observedAt: 30000, samples: Array.from({ length: 31 }, (_, index) => ({ t: index * 1000, v: current })),
    config: { thresholds }, timeAboveThresholdMs: { [thresholds[0]]: 0, [thresholds[1]]: 0 }, baselineDeviation: null, ...changes };
}
const trend = (direction = "stable", changes = {}) => ({ direction, slope: direction === "rising" ? 15 : 0, persistenceMs: 0, ...changes });
const beam = (changes = {}) => ({ source: "hardware", quality: "valid", current: "clear", eventCount: 0,
  frequencyPerMinute: 0, observationDurationMs: 30000, windowStartedAt: 0, observedAt: 30000, sampleCount: 31, ...changes });
const tracking = (changes = {}) => ({ left: beam(), right: beam(), currentState: "clear", ...changes });
function module(id, score = 90, changes = {}) {
  return createModuleResult({ id, score, status: "active", source: "hardware", quality: "valid",
    observationWindow: { start: 0, end: 30000, sampleCount: 31 },
    nodeId: CONDITION_CONFIG.moduleNodes[id], configVersion: CONDITION_CONFIG.version,
    features: { trendDirection: "stable", criticalIndicators: [] }, reasons: [`${id} observed evidence.`], ...changes });
}
const assess = (modules, changes = {}) => conditionEngine(modules, { now: 30000, ...changes });

test("five condition bands have consistent exact and fractional boundaries", () => {
  for (const [score, condition, risk] of [[100, "Normal", "Low"], [80, "Normal", "Low"], [79.99, "Watch", "Moderate"],
    [60, "Watch", "Moderate"], [59.99, "Warning", "High"], [40, "Warning", "High"], [39.99, "High Risk", "Very High"],
    [20, "High Risk", "Very High"], [19.99, "Critical", "Critical"], [0, "Critical", "Critical"]]) {
    assert.equal(conditionBand(score).condition, condition);
    assert.equal(conditionBand(score).risk, risk);
  }
  assert.equal(conditionBand(null).condition, "Unavailable");
  assert.equal(conditionBand(NaN).condition, "Unavailable");
});

test("shared result contract preserves valid zero and forces unavailable/collecting scores to null", () => {
  assert.equal(module("mechanical", 0).score, 0);
  assert.equal(module("mechanical", 100, { status: "unavailable" }).score, null);
  assert.equal(module("mechanical", 100, { status: "collecting" }).score, null);
  for (const invalid of [-1, 101, NaN]) assert.throws(() => module("mechanical", invalid), TypeError);
});

test("mechanical level, trend and persistence penalties cover all five score bands", () => {
  const cases = [[0, trend(), "Normal"], [500, trend(), "Watch"], [700, trend(), "Warning"],
    [710, trend("rising", { persistenceMs: 45000 }), "High Risk"], [800, trend(), "Critical"]];
  for (const [current, temporal, expected] of cases) {
    const result = mechanicalModule(numeric(current), temporal);
    assert.equal(conditionBand(result.score).condition, expected);
    assert.equal(result.nodeId, "NODE 01");
    assert.equal(result.method, "prototype condition indicator");
  }
  const result = mechanicalModule(numeric(620, "piezoVal", { timeAboveThresholdMs: { 500: 12000, 800: 0 } }), trend("rising", { slope: 480, persistenceMs: 45000 }));
  assert.match(result.reasons[0], /620 ADC, rising at 8 ADC\/s for 45 seconds, 12 seconds/);
});

test("thermal reasons preserve real rate, duration and negative signed baseline deviation", () => {
  const result = thermalModule(numeric(38, "tempC", { baselineDeviation: -1, timeAboveThresholdMs: { 35: 12000, 40: 0 } }),
    trend("rising", { slope: 0.4, persistenceMs: 45000 }));
  assert.match(result.reasons[0], /38 °C, rising at 0.4 °C\/min for 45 seconds, 12 seconds/);
  assert.match(result.reasons[1], /-1 °C/);
  assert.equal(result.nodeId, "NODE 01");
  assert.ok(thermalModule(numeric(40, "tempC"), trend()).score < 20);
  assert.ok(thermalModule(numeric(30, "tempC"), trend("falling", { slope: -0.4 })).score >= 80);
});

test("threshold duration affects the condition indicator without inventing waveform evidence", () => {
  const regular = mechanicalModule(numeric(620), trend());
  const persistent = mechanicalModule(numeric(620, "piezoVal", { timeAboveThresholdMs: { 500: 30000, 800: 0 } }), trend());
  assert.equal(regular.score - persistent.score, 5);
});

test("numeric modules warm up with null score and use source-appropriate statuses", () => {
  assert.equal(mechanicalModule(numeric(600, "piezoVal", { sufficient: false }), trend()).status, "collecting");
  assert.equal(thermalModule(numeric(38, "tempC"), { direction: null, slope: null }).score, null);
  assert.equal(mechanicalModule(numeric(350), trend()).status, "active");
  assert.equal(mechanicalModule(numeric(350, "piezoVal", { source: "demo" }), trend()).status, "demo");
  const manual = thermalModule(numeric(34, "tempC", { source: "manual" }), trend());
  assert.equal(manual.source, "manual");
  assert.equal(manual.status, "demo");
  assert.equal(thermalModule(numeric(null, "tempC", { quality: "stale" }), trend()).status, "unavailable");
});

test("tracking scores both-blocked, sustained obstruction and recurring events", () => {
  assert.equal(trackingModule(tracking()).score, 95);
  assert.equal(trackingModule(tracking({ currentState: "bothBlocked" })).score, 10);
  assert.equal(trackingModule(tracking({ currentState: "leftBlocked", left: beam({ currentEvent: { durationMs: 31000 } }) })).score, 25);
  assert.equal(trackingModule(tracking({ left: beam({ eventCount: 3, frequencyPerMinute: 0 }) })).score, 55);
  assert.equal(trackingModule(tracking({ left: beam({ eventCount: 5, frequencyPerMinute: 0 }) })).score, 35);
  const short = trackingModule(tracking({ left: beam({ eventCount: 1, frequencyPerMinute: 60, observationDurationMs: 1000 }), right: beam({ observationDurationMs: 1000 }) }));
  assert.equal(short.score, 75);
  assert.equal(short.features.frequencyQualified, false);
});

test("tracking rejects stale/mixed-context or misaligned paired beams", () => {
  assert.equal(trackingModule(tracking({ left: beam({ quality: "stale" }) })).score, null);
  assert.equal(trackingModule(tracking({ left: beam({ source: "manual" }) })).status, "unavailable");
  assert.equal(trackingModule(tracking({ left: beam({ observedAt: 40000 }) })).score, null);
  const mixedDemo = trackingModule(tracking({ left: beam({ source: "manual" }), right: beam({ source: "demo" }) }));
  assert.equal(mixedDemo.status, "demo");
  assert.equal(assess([mixedDemo], { context: "demo" }).coverage.included, 1);
  assert.equal(assess([mixedDemo], { context: "hardware" }).score, null);
});

test("Vision and Energy never invent scores from laser commands or missing instruments", () => {
  for (const source of ["hardware", "demo", "manual"]) {
    const result = visionModule({ quality: "valid", value: 1, source });
    assert.equal(result.status, "unavailable");
    assert.equal(result.score, null);
    assert.equal(result.reasons[0], "Camera not integrated. Laser scan state available.");
  }
  assert.equal(energyModule().score, null);
  assert.equal(energyModule().nodeId, "NODE 04");
});

test("weighted fusion normalizes only eligible modules and reports coverage", () => {
  const result = assess([module("mechanical", 80), module("thermal", 80), module("tracking", 90), visionModule(), energyModule()]);
  assert.equal(result.score, 82.67);
  assert.equal(result.coverage.text, "Based on 3/5 modules. Vision and Energy excluded.");
  assert.equal(result.condition, "Normal");
  assert.equal(result.trendDirections.mechanical, "stable");
});

test("missing, stale, collecting and zero-weight modules cannot produce a healthy fallback", () => {
  for (const modules of [[], [visionModule(), energyModule()], [module("thermal", 100, { status: "collecting" })],
    [module("thermal", 100, { quality: "stale" })]]) {
    const result = assess(modules);
    assert.equal(result.score, null);
    assert.equal(result.condition, "Unavailable");
  }
  assert.equal(assess([module("thermal")], { now: 36000 }).score, null);
  assert.equal(assess([module("thermal")], { config: { weights: { thermal: 0 } } }).score, null);
  assert.equal(assess([module("thermal")], { config: { weights: { thermal: -1 } } }).score, null);
  assert.equal(assess([module("thermal")], { config: { maxModifier: NaN } }).score, null);
  assert.equal(assess([module("thermal")], { config: { freshnessMs: Infinity } }).score, null);
});

test("hardware and demo/manual contexts never mix eligible scores", () => {
  const hardware = module("mechanical", 100);
  const demo = module("thermal", 20, { source: "demo", status: "demo" });
  const manual = module("tracking", 30, { source: "manual", status: "demo" });
  assert.equal(assess([hardware, demo, manual]).score, 100);
  const result = assess([hardware, demo, manual], { context: "demo" });
  assert.equal(result.coverage.included, 2);
  assert.equal(result.eligibleModules.some(item => item.source === "hardware"), false);
  const lowHardware = module("mechanical", 20);
  const highDemo = module("thermal", 100, { source: "demo", status: "demo" });
  const unavailableHigh = { ...module("vision", 100), status: "unavailable" };
  assert.equal(assess([lowHardware, highDemo, unavailableHigh]).score, 20);
});

test("corroboration shares evidence without double-counting overlapping rules or duplicate inputs", () => {
  const mechanical = module("mechanical", 80, { features: { trendDirection: "rising" } });
  const thermal = module("thermal", 80, { features: { trendDirection: "rising" } });
  const tracking = module("tracking", 80, { features: { eventCount: 2 } });
  const result = assess([mechanical, thermal, tracking, mechanical]);
  assert.equal(result.coverage.included, 3);
  assert.equal(result.corroborations.length, 2);
  assert.equal(result.totalModifier, 15);
  assert.equal(result.score, 65);
  assert.equal(result.corroborations.find(rule => rule.id === "alignmentStress").appliedModifier, 0);
  assert.match(result.corroborations.find(rule => rule.id === "alignmentStress").suppressionReason, /Shared evidence/);
  assert.equal(assess([mechanical, tracking]).totalModifier, 10);
  assert.equal(assess([mechanical, thermal], { config: { maxModifier: 10 } }).totalModifier, 10);
  assert.ok(assess([mechanical, thermal, tracking], { config: { maxModifier: 50 } }).totalModifier <= 20);
});

test("corroboration requires aligned windows and explicit compatible locations", () => {
  const mechanical = module("mechanical", 80, { features: { trendDirection: "rising" } });
  const thermal = module("thermal", 80, { features: { trendDirection: "rising" } });
  assert.equal(assess([mechanical, thermal]).totalModifier, 15);
  assert.equal(assess([mechanical, { ...thermal, nodeId: "NODE 03" }]).totalModifier, 0);
  assert.equal(assess([mechanical, { ...thermal, observationWindow: { start: 30000, end: 31000, sampleCount: 10 } }], { now: 31000 }).totalModifier, 0);
  assert.equal(assess([mechanical, { ...thermal, observationWindow: { start: 0, end: 32000, sampleCount: 31 } }], { now: 32000, config: { alignmentToleranceMs: 1000 } }).totalModifier, 0);
  const tracking = module("tracking", 80, { features: { eventCount: 2 } });
  assert.equal(assess([mechanical, tracking], { config: { layout: { ...CONVEYOR_LAYOUT, links: [] } } }).totalModifier, 0);
});

test("individual critical evidence stays visible at a high average and during score warm-up", () => {
  const critical = mechanicalModule(numeric(800), trend());
  const result = assess([critical, module("thermal", 100), module("tracking", 100)],
    { config: { weights: { mechanical: 0.01, thermal: 0.49, tracking: 0.50 } } });
  assert.ok(result.score > 99);
  assert.equal(result.criticalIndicators.length, 1);
  assert.equal(result.criticalIndicators[0].nodeId, "NODE 01");
  const warming = mechanicalModule(numeric(800, "piezoVal", { sufficient: false }), { direction: null, slope: null });
  const warmResult = assess([warming]);
  assert.equal(warmResult.score, null);
  assert.equal(warmResult.criticalIndicators.length, 1);
  assert.equal(generateRecommendations(warmResult)[0].priority, "URGENT");
  assert.equal(assess([warming], { context: "demo" }).criticalIndicators.length, 0);
});

test("recommendations are prioritized with actual node locations and contributing evidence", () => {
  const mechanical = module("mechanical", 50, { features: { trendDirection: "rising" }, reasons: ["Vibration 620 ADC, rising."] });
  const thermal = module("thermal", 50, { features: { trendDirection: "rising" }, reasons: ["Temperature 38 °C, rising."] });
  const result = assess([mechanical, thermal]);
  const recs = generateRecommendations(result);
  const inspection = recs.find(item => item.id === "corroboration-mechanicalStress");
  assert.match(inspection.text, /Inspect motor bearings.*Head Pulley zone \(NODE 01\)/);
  assert.deepEqual(inspection.contributingModules, ["mechanical", "thermal"]);
  assert.equal(inspection.suggestedInspectionNode, "NODE 01");
  assert.ok(inspection.evidence.some(text => text.includes("620 ADC")));
  assert.ok(recs.find(item => item.id === "coverage"));
  assert.equal(recs.some(item => /all normal/i.test(item.text)), false);
});

test("Hall remains separate support for NODE 03, never a sixth scored module", () => {
  const support = hallSupportingEvidence({ source: "hardware", quality: "valid", windowStartedAt: 0, observedAt: 30000,
    sampleCount: 31, current: "blocked", recurrent: true, eventCount: 2, currentEvent: { durationMs: 1000, incomplete: true } });
  const result = assess([module("mechanical")], { supportingEvidence: [support] });
  assert.equal(result.coverage.total, 5);
  assert.equal(result.coverage.included, 1);
  assert.equal(result.score, 90);
  const rec = generateRecommendations(result).find(item => item.id === "support-hall");
  assert.equal(rec.nodeId, "NODE 03");
  assert.match(rec.evidence.join(" "), /Supporting evidence for splice zone/);
  assert.equal(assess([], { context: "demo", supportingEvidence: [support] }).supportingEvidence.length, 0);
});

test("location configuration changes recommendation mapping without hardcoded physical claims", () => {
  const config = { version: "custom-v1", moduleNodes: { mechanical: "NODE A" },
    layout: { type: "demo", lengthKm: 1, nodes: { "NODE A": { label: "North Drive zone", km: 0.1 } }, links: [] } };
  const mechanical = mechanicalModule(numeric(700), trend(), config);
  const result = assess([mechanical], { config });
  const recommendation = generateRecommendations(result).find(item => item.id === "module-mechanical");
  assert.equal(mechanical.configVersion, "custom-v1");
  assert.match(recommendation.text, /North Drive zone \(NODE A\)/);
  assert.equal(recommendation.layoutType, "demo");
});
