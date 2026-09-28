export const MODULE_LABELS = Object.freeze({ mechanical: "Mechanical", thermal: "Thermal", tracking: "Tracking", vision: "Vision", energy: "Energy" });
const STATUSES = ["active", "unavailable", "demo", "collecting"];

export function conditionBand(score) {
  if (!Number.isFinite(score) || score < 0 || score > 100) return { condition: "Unavailable", risk: "Unavailable", tone: "unavailable" };
  if (score >= 80) return { condition: "Normal", risk: "Low", tone: "normal" };
  if (score >= 60) return { condition: "Watch", risk: "Moderate", tone: "watch" };
  if (score >= 40) return { condition: "Warning", risk: "High", tone: "warning" };
  if (score >= 20) return { condition: "High Risk", risk: "Very High", tone: "highRisk" };
  return { condition: "Critical", risk: "Critical", tone: "critical" };
}

export function createModuleResult({ id, label = MODULE_LABELS[id], status = "unavailable", source = "unavailable",
  score = null, reasons = [], features = {}, observationWindow = { start: null, end: null, sampleCount: 0 },
  nodeId, configVersion, quality = "missing" }) {
  if (!MODULE_LABELS[id] || !STATUSES.includes(status)) throw new TypeError("Invalid condition module identity/status.");
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) throw new TypeError("Module score must be null or 0–100.");
  return { id, label, status, source, score: ["collecting", "unavailable"].includes(status) ? null : score,
    reasons: [...reasons], features: { ...features }, observationWindow: { ...observationWindow }, nodeId, configVersion,
    quality, method: "prototype condition indicator" };
}

export function contextMatches(source, context, sources = [source]) {
  const allowed = context === "hardware" ? ["hardware"] : context === "demo" ? ["demo", "manual"] : [];
  return sources.length > 0 && sources.every(item => allowed.includes(item));
}

export const sourceStatus = source => source === "hardware" ? "active" : "demo";
export const formatNumber = value => Number.isFinite(value) ? Number(value.toFixed(3)).toString() : "unavailable";

export function numericWindow(feature) {
  const samples = feature?.samples ?? [];
  return { start: samples[0]?.t ?? feature?.observedAt ?? null,
    end: samples.at(-1)?.t ?? feature?.observedAt ?? null, sampleCount: samples.length };
}

export function numericAssessment(id, feature = {}, temporal = {}, config) {
  const thresholds = feature.config?.thresholds ?? (id === "mechanical" ? [500, 800] : [35, 40]);
  const current = feature.current;
  const valid = feature.quality === "valid" && Number.isFinite(current) && (id !== "mechanical" || current >= 0);
  const critical = valid && current >= thresholds[1];
  const properties = {
    id, nodeId: config.moduleNodes[id], configVersion: config.version,
    source: feature.source ?? "unavailable", quality: feature.quality ?? "missing", observationWindow: numericWindow(feature),
    features: { current, unit: feature.unit, thresholds, quality: feature.quality, trendDirection: temporal.direction ?? null,
      slopePerMinute: temporal.slope ?? null, persistenceMs: temporal.persistenceMs ?? null,
      timeAboveThresholdMs: feature.timeAboveThresholdMs ?? {}, baselineDeviation: feature.baselineDeviation ?? null,
      criticalIndicators: critical ? [`${id === "mechanical" ? "Vibration" : "Temperature"} ${formatNumber(current)} ${feature.unit} at/above critical threshold ${thresholds[1]} ${feature.unit}.`] : [] },
  };
  if (!valid || !["hardware", "demo", "manual"].includes(properties.source)) {
    return { result: createModuleResult({ ...properties, reasons: [`Current ${id} observation is ${properties.quality}; condition score unavailable.`] }) };
  }
  if (!feature.sufficient || !["rising", "stable", "falling"].includes(temporal.direction) || !Number.isFinite(temporal.slope)) {
    return { result: createModuleResult({ ...properties, status: "collecting", reasons: [
      "Insufficient data: condition scoring requires 10 valid samples and 30 seconds of continuous observations.",
      ...properties.features.criticalIndicators,
    ] }) };
  }
  const [warning, limit] = thresholds;
  let score = current >= limit ? 15 : current >= warning ? 75 - 30 * (current - warning) / (limit - warning)
    : id === "mechanical" ? 100 - 20 * Math.max(0, current) / warning
      : 100 - 20 * Math.min(1, Math.max(0, (current - (warning - 10)) / 10));
  const penalties = config.scoring;
  if (temporal.direction === "rising") {
    score -= penalties.risingPenalty;
    if (temporal.persistenceMs >= penalties.persistenceMs) score -= penalties.persistencePenalty;
  }
  if ((feature.timeAboveThresholdMs?.[warning] ?? 0) >= penalties.elevatedDurationMs) score -= penalties.elevatedDurationPenalty;
  if (critical && (feature.timeAboveThresholdMs?.[limit] ?? 0) >= penalties.sustainedCriticalMs) score -= penalties.sustainedCriticalPenalty;
  score = Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
  return { properties, score, warning, current };
}
