import { resolveConditionConfig } from "../config/conditionConfig.js";
import { createModuleResult, formatNumber, sourceStatus } from "./moduleContract.js";

export function trackingModule(tracking = {}, options = {}) {
  const config = resolveConditionConfig(options);
  const { left = {}, right = {} } = tracking;
  const sources = [...new Set([left.source ?? "unavailable", right.source ?? "unavailable"])];
  const sameContext = sources.every(source => source === "hardware") || sources.every(source => ["manual", "demo"].includes(source));
  const source = sources.length === 1 ? sources[0] : "mixed";
  const quality = left.quality === "valid" && right.quality === "valid" ? "valid" : left.quality !== "valid" ? left.quality ?? "missing" : right.quality;
  const start = Number.isFinite(left.windowStartedAt) && Number.isFinite(right.windowStartedAt) ? Math.max(left.windowStartedAt, right.windowStartedAt) : null;
  const end = Number.isFinite(left.observedAt) && Number.isFinite(right.observedAt) ? Math.min(left.observedAt, right.observedAt) : null;
  const current = tracking.currentState ?? "unknown";
  const events = (left.eventCount ?? 0) + (right.eventCount ?? 0);
  const frequency = (left.frequencyPerMinute ?? 0) + (right.frequencyPerMinute ?? 0);
  const frequencyQualified = Math.min(left.observationDurationMs ?? 0, right.observationDurationMs ?? 0) >= 30000;
  const scoredFrequency = frequencyQualified ? frequency : 0;
  const obstructionMs = Math.max(left.currentEvent?.durationMs ?? 0, right.currentEvent?.durationMs ?? 0);
  const base = { id: "tracking", source, quality, nodeId: config.moduleNodes.tracking, configVersion: config.version,
    observationWindow: { start, end, sampleCount: Math.min(left.sampleCount ?? 0, right.sampleCount ?? 0) },
    features: { sources, currentState: current, eventCount: events, frequencyPerMinute: frequency, obstructionMs,
      trendDirection: "event-based", frequencyQualified, sideDistribution: tracking.sideDistribution,
      criticalIndicators: quality === "valid" && sameContext && current === "bothBlocked" ? ["Both IR beams blocked; inspect beam paths and belt edges."] : [] } };
  if (quality !== "valid" || current === "unknown" || !sameContext || start === null || end === null || end < start ||
    Math.abs(left.observedAt - right.observedAt) > config.alignmentToleranceMs) {
    return createModuleResult({ ...base, reasons: [!sameContext ? "IR beam sources belong to different contexts; joint score unavailable." : "Fresh, time-compatible observations from both IR beams are required."] });
  }
  const criteria = config.tracking;
  let score = 95;
  if (current === "bothBlocked") score = 10;
  else if (current === "leftBlocked" || current === "rightBlocked") score = obstructionMs >= criteria.sustainedObstructionMs ? 25 : 35;
  else if (events >= criteria.highRiskEvents || scoredFrequency >= criteria.highRiskFrequency) score = 35;
  else if (events >= criteria.warningEvents || scoredFrequency >= criteria.warningFrequency) score = 55;
  else if (events >= criteria.watchEvents || scoredFrequency >= criteria.watchFrequency) score = 75;
  return createModuleResult({ ...base, status: sourceStatus(source), score, reasons: [
    `IR state ${current}; left ${left.eventCount ?? 0} and right ${right.eventCount ?? 0} debounced transitions, ${formatNumber(frequency)} events/min, ${formatNumber(obstructionMs / 1000)} seconds current observed obstruction.`,
    "Binary obstruction evidence; belt displacement, angle and a confirmed tracking fault are unavailable.",
    ...(!frequencyQualified ? ["Event-frequency scoring awaits 30 seconds; current obstruction and observed transitions remain usable."] : []),
  ] });
}
