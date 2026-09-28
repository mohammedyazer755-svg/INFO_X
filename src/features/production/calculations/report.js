import { CONDITION_CONFIG } from "../config/conditionConfig.js";
import { ANALYSIS_CONFIG } from "../config/analysisConfig.js";
import { INTEGRATION_POLICY } from "./accounting.js";

export const REPORT_VERSION = "navix-production-report/1.0.0";
export const REPORT_BANDS = Object.freeze([
  { min: 80, max: 100, maxInclusive: true, condition: "Normal", risk: "Low" },
  { min: 60, max: 80, maxInclusive: false, condition: "Watch", risk: "Moderate" },
  { min: 40, max: 60, maxInclusive: false, condition: "Warning", risk: "High" },
  { min: 20, max: 40, maxInclusive: false, condition: "High Risk", risk: "Very High" },
  { min: 0, max: 20, maxInclusive: false, condition: "Critical", risk: "Critical" },
]);
const numeric = value => Number.isFinite(value) ? value : null;
const pick = (object = {}, keys) => Object.fromEntries(keys.map(key => [key, object?.[key] ?? null]));
const window = value => pick(value, ["start", "end", "sampleCount"]);
const featureKeys = ["current", "unit", "quality", "trendDirection", "slopePerMinute", "slopePerSecond", "persistenceMs", "baselineDeviation",
  "criticalIndicators", "sources", "currentState", "eventCount", "frequencyPerMinute", "obstructionMs", "frequencyQualified", "durationMs", "incomplete"];
function features(value = {}) {
  const numericKeys = ["current", "slopePerMinute", "slopePerSecond", "persistenceMs", "baselineDeviation", "eventCount", "frequencyPerMinute", "obstructionMs", "durationMs"];
  const result = Object.fromEntries(numericKeys.map(key => [key, numeric(value[key])]));
  for (const key of featureKeys.filter(key => !numericKeys.includes(key))) result[key] =
    ["criticalIndicators", "sources"].includes(key) ? (Array.isArray(value[key]) ? value[key].filter(item => typeof item === "string") : [])
      : ["frequencyQualified", "incomplete"].includes(key) ? typeof value[key] === "boolean" ? value[key] : null
        : typeof value[key] === "string" ? value[key] : null;
  result.thresholds = (value.thresholds ?? []).map(numeric);
  result.timeAboveThresholdMs = Object.fromEntries(Object.entries(value.timeAboveThresholdMs ?? {}).filter(([key]) => /^\d+(\.\d+)?$/.test(key)).map(([key, v]) => [key, numeric(v)]));
  if (value.sideDistribution) result.sideDistribution = { basis: value.sideDistribution.basis,
    durationMs: pick(value.sideDistribution.durationMs, ["left", "right", "both", "clear", "unknown"]) };
  if (value.laserState) result.laserState = pick(value.laserState, ["value", "source", "quality"]);
  return result;
}
const moduleReport = module => ({ ...pick(module, ["id", "label", "status", "source", "quality", "reasons", "nodeId", "configVersion"]),
  score: ["unavailable", "collecting"].includes(module.status) ? null : numeric(module.score),
  features: features(module.features), window: window(module.observationWindow) });
const metric = (value = {}) => ({ value: value.unavailable ? null : numeric(value.value), unit: value.unit ?? null,
  source: value.source ?? "unavailable", quality: value.quality ?? "missing", unavailable: value.unavailable ?? true,
  reason: value.reason ?? null, label: value.label ?? null, provenance: value.provenance ?? [] });
const recommendations = values => values.map(item => pick(item, ["id", "priority", "nodeId", "location", "text", "evidence", "contributingModules", "context", "layoutType", "suggestedInspectionNode"]));
function scrubText(value) {
  return value.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[connection detail omitted]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[address omitted]")
    .replace(/\b(?:password|token|api[_-]?key|authorization|credential|endpoint|ssid|deviceId)\s*[:=]\s*\S+/gi, "[connection detail omitted]");
}

/** Explicit allowlists: never serialize provider/store objects or firmware metadata. */
export function createProductionReport(state, { generatedAt = Date.now() } = {}) {
  if (!Number.isFinite(generatedAt)) throw new TypeError("Invalid report generation time.");
  const { production, telemetry, condition, drone, features: extracted, scenario } = state;
  const { settings, metrics, accountingSession: session, forecast } = production;
  const configuration = condition.configuration ?? CONDITION_CONFIG;
  const timestamps = Object.values(telemetry).flatMap(channel => channel.history.map(item => item.acquiredAt));
  if (session.startedAt !== null) timestamps.push(session.startedAt);
  if (session.lastAt !== null) timestamps.push(session.lastAt);
  const param = (value, unit) => ({ value: numeric(value), unit, source: "manual" });
  const report = {
    version: REPORT_VERSION, generatedAt: new Date(generatedAt).toISOString(),
    description: "Rule-based condition assessment, trend-based observation, estimated production accounting, and simulated drone inspection.",
    observationPeriod: { start: timestamps.length ? Math.min(...timestamps) : null, end: timestamps.length ? Math.max(...timestamps) : null,
      timestampUnit: "UTC epoch ms", clock: scenario?.source === "scenario" ? "shared scenario simulation clock" : "live acquisition clock" },
    inputs: { mode: settings.mode, context: settings.context, speedMode: settings.speedMode, params: {
      beltLoad: param(settings.load, "kg/m"), area: param(settings.area, "m²"), density: param(settings.density, "kg/m³"),
      speed: { value: production.flow.unavailable ? null : numeric(production.flow.speedMps), unit: "m/s", source: settings.speedMode === "preset" ? "demo" : telemetry.speed.latest.source },
      demoFixedSpeed: { ...param(settings.fixedSpeed, "m/s"), source: "demo" },
      designCapacity: param(settings.designCapacity, "t/h"), expectedThroughput: param(settings.expectedThroughput, "t/h"),
      assumedFutureThroughput: param(settings.assumedFutureThroughput, "t/h"), shiftDuration: param(settings.shiftDurationHrs, "h"),
      assumedFutureUptime: param(settings.assumedUptime, "fraction"), orePrice: param(settings.orePrice, "currency units/t") },
      operatingState: settings.confirmedState, scheduled: settings.scheduled },
    provenance: Object.fromEntries(Object.entries(telemetry).map(([field, channel]) => [field,
      pick(channel.latest, ["source", "quality", "unit", "signalType", "acquiredAt", "receivedAt", "calibrationStatus", "nodeId", "scenarioTag"])])),
    modules: Object.fromEntries(condition.modules.map(module => [module.id, moduleReport(module)])),
    conditionEngine: { health: condition.score, condition: condition.condition, risk: condition.risk, source: condition.source, context: condition.context,
      corroboration: condition.corroborations.map(item => pick(item, ["id", "label", "moduleIds", "nodeIds", "requestedModifier", "appliedModifier", "suppressionReason", "reason"])),
      coverage: { included: condition.coverage.included, total: condition.coverage.total, text: condition.coverage.text,
        excluded: condition.coverage.excluded.map(item => pick(item, ["id", "label", "reason"])) }, bands: REPORT_BANDS,
      criticalIndicators: condition.criticalIndicators.map(item => pick(item, ["moduleId", "nodeId", "source", "reason", "score", "status"])),
      supportingEvidence: condition.supportingEvidence.map(moduleReport), trendDirections: pick(condition.trendDirections, ["mechanical", "thermal", "tracking", "vision", "energy"]) },
    recommendations: recommendations(condition.recommendations),
    throughput: { current: metric(production.flow), accumulated: metric(metrics.accumulated), projected: metric(metrics.projected), lost: metric(metrics.loss),
      forecast: { ...metric(metrics.forecast), method: forecast.method, window: window(forecast.observationWindow),
        horizonMs: forecast.config.horizonMs, maximumHorizonMs: forecast.config.maxHorizonMs, assumptions: forecast.assumptions },
      forecastProjected: { value: numeric(production.dataProjection.value), unavailable: production.dataProjection.unavailable,
        source: production.dataProjection.source ?? metrics.accumulated.source, quality: production.dataProjection.quality ?? (production.dataProjection.unavailable ? "missing" : metrics.accumulated.quality),
        unit: "t", reason: production.dataProjection.reason ?? null, assumedRate: numeric(production.dataProjection.assumedRate) } },
    accounting: { running: metric(metrics.time.scheduledRunning), stopped: metric(metrics.time.confirmedUnplannedStop), idle: metric(metrics.time.plannedIdle),
      unknown: metric(metrics.time.unknown), coverage: metric(metrics.coverage), availability: metric(metrics.availability),
      policy: INTEGRATION_POLICY, sessionContext: session.context, startedAt: session.startedAt, lastObservedAt: session.lastAt,
      remainingScheduledHours: numeric(production.remainingScheduledHours), lossUnknownSeconds: session.lossUnknownMs / 1000 },
    droneFindings: drone.mission.findings.map(finding => ({ ...pick(finding, ["id", "nodeId", "location", "capturedAt", "missionElapsedMs", "context", "description", "inspectionDurationMs"]),
      tag: "SIMULATION", modules: finding.modules.map(moduleReport), supportingEvidence: finding.supporting.map(moduleReport) })),
    configuration: { version: condition.configVersion, weights: pick(configuration.weights, ["mechanical", "thermal", "tracking", "vision", "energy"]),
      thresholds: { piezoADC: extracted.piezoVal.config.thresholds, temperatureC: extracted.tempC.config.thresholds },
      analysis: pick(extracted.config ?? ANALYSIS_CONFIG, ["windowMs", "minCount", "minDurationMs", "persistenceMs", "debounceMs"]),
      scoring: pick(configuration.scoring, Object.keys(CONDITION_CONFIG.scoring)), tracking: pick(configuration.tracking, Object.keys(CONDITION_CONFIG.tracking)),
      nodeMap: { type: condition.layout.type, lengthKm: condition.layout.lengthKm,
        nodes: Object.fromEntries(Object.entries(condition.layout.nodes).map(([id, node]) => [id, pick(node, ["label", "description", "km", "moduleIds", "supportingIds"])])) },
      forecast: pick(production.forecastOptions, ["method", "windowMs", "minCount", "minDurationMs", "horizonMs", "maxHorizonMs", "maxGapMs", "freshnessMs"]),
      physicalBounds: production.forecastOptions.physicalBounds ? pick(production.forecastOptions.physicalBounds, ["min", "max"]) : null,
      droneTiming: pick(drone.mission.config, ["timeScale", "speedMps", "takeoffMs", "inspectMs", "landingMs", "batteryDrainPerSecond"]),
      scenario: scenario ? pick(scenario, ["name", "source", "seed", "timeScale", "elapsedMs", "running"]) : null },
    limitations: ["Speed is demo-generated, not calibrated from rotation pulses",
      settings.mode === "geometry" ? "Throughput estimated via geometry model, not measured by belt scale" : "Throughput estimated via manually assumed belt loading, not measured by belt scale",
      "Condition scores are rule-based prototype indicators, not trained predictions",
      "Vibration analysis uses ADC level trends, not calibrated waveform diagnostics",
      "Drone findings are simulation, not independent measurement", "Initial four-node, 2.4 km location map is illustrative demo configuration",
      "Incomplete module coverage cannot establish an all-normal condition; no validated failure prediction is claimed"],
  };
  return JSON.parse(JSON.stringify(report, (_key, value) => typeof value === "string" ? scrubText(value) : value));
}

export function downloadProductionReport(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a"); link.href = url;
    link.download = `navix-production-v1-${report.generatedAt.replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link); link.click(); link.remove();
  } finally { URL.revokeObjectURL(url); }
}
