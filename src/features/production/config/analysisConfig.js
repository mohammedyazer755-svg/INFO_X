// Prototype configuration; thresholds are editable, not equipment standards.
export const ANALYSIS_CONFIG = Object.freeze({
  windowMs: 120000,
  minCount: 10,
  minDurationMs: 30000,
  persistenceMs: 60000,
  debounceMs: 250,
  piezoVal: Object.freeze({ thresholds: [500, 800], risingThreshold: 10, fallingThreshold: -10, hysteresis: 2, slopeUnit: "ADC/min" }),
  tempC: Object.freeze({ thresholds: [35, 40], risingThreshold: 0.1, fallingThreshold: -0.1, hysteresis: 0.02,
    slopeUnit: "°C/min", baselineDurationMs: 30000, baselineVarianceThreshold: 0.04 }),
});
