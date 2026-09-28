import { resolveConditionConfig } from "../config/conditionConfig.js";
import { createModuleResult, formatNumber, numericAssessment, sourceStatus } from "./moduleContract.js";

export function mechanicalModule(feature, temporal, options = {}) {
  const config = resolveConditionConfig(options);
  const assessment = numericAssessment("mechanical", feature, temporal, config);
  if (assessment.result) return assessment.result;
  const { properties, score, warning, current } = assessment;
  const slopePerSecond = temporal.slope / 60;
  return createModuleResult({ ...properties, score, status: sourceStatus(properties.source),
    features: { ...properties.features, slopePerSecond }, reasons: [
      `Vibration ${formatNumber(current)} ADC, ${temporal.direction} at ${formatNumber(slopePerSecond)} ADC/s for ${formatNumber(temporal.persistenceMs / 1000)} seconds, ${formatNumber((feature.timeAboveThresholdMs?.[warning] ?? 0) / 1000)} seconds at/above warning threshold ${warning} ADC.`,
      "ADC-level trend assessment; waveform diagnostics and confirmed bearing faults unavailable.",
    ] });
}
