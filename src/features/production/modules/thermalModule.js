import { resolveConditionConfig } from "../config/conditionConfig.js";
import { createModuleResult, formatNumber, numericAssessment, sourceStatus } from "./moduleContract.js";

export function thermalModule(feature, temporal, options = {}) {
  const config = resolveConditionConfig(options);
  const assessment = numericAssessment("thermal", feature, temporal, config);
  if (assessment.result) return assessment.result;
  const { properties, score, warning, current } = assessment;
  return createModuleResult({ ...properties, score, status: sourceStatus(properties.source), reasons: [
    `Surface temperature ${formatNumber(current)} °C, ${temporal.direction} at ${formatNumber(temporal.slope)} °C/min for ${formatNumber(temporal.persistenceMs / 1000)} seconds, ${formatNumber((feature.timeAboveThresholdMs?.[warning] ?? 0) / 1000)} seconds at/above warning threshold ${warning} °C.`,
    feature.baselineDeviation === null || feature.baselineDeviation === undefined ? "Stable reference baseline unavailable."
      : `Signed baseline deviation ${formatNumber(feature.baselineDeviation)} °C. Stability alone does not establish equipment health.`,
  ] });
}
