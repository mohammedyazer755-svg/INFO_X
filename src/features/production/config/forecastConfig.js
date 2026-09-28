export const DEFAULT_FORECAST_CONFIG = Object.freeze({
  method: "rollingBaseline", windowMs: 120000, minCount: 10, minDurationMs: 30000,
  horizonMs: 120000, maxHorizonMs: 900000, maxGapMs: 5000, freshnessMs: 5000,
  physicalBounds: null,
});
