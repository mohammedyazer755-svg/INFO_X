/** Sort unique UTC epoch-millisecond timestamps; values and slopes may be negative. */
export function normalizeSamples(samples = []) {
  const byTime = new Map();
  for (const sample of samples) {
    if (Number.isFinite(sample.t) && sample.t >= 0 && Number.isFinite(sample.v) &&
      (sample.quality === undefined || sample.quality === "valid")) byTime.set(sample.t, sample);
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** Least-squares slope in units/second. Center elapsed time to avoid epoch precision loss. */
export function linearSlope(samples, minCount = 10) {
  const points = normalizeSamples(samples);
  if (points.length < Math.max(2, minCount)) return null;
  const origin = points[0].t;
  const times = points.map(point => (point.t - origin) / 1000);
  const meanT = times.reduce((sum, t) => sum + t, 0) / points.length;
  const meanV = points.reduce((sum, point) => sum + point.v, 0) / points.length;
  let numerator = 0, denominator = 0;
  points.forEach((point, index) => {
    numerator += (times[index] - meanT) * (point.v - meanV);
    denominator += (times[index] - meanT) ** 2;
  });
  const slope = numerator / denominator;
  return denominator > 0 && Number.isFinite(slope) ? slope : null;
}

/** Hysteresis can be a margin or { margin, previousDirection }. */
export function trendDirection(slope, risingThresh = 0.5, fallingThresh = -0.5, hysteresis = 0) {
  if (!Number.isFinite(slope)) return "stable";
  if (!Number.isFinite(risingThresh) || !Number.isFinite(fallingThresh) || fallingThresh >= risingThresh) {
    throw new TypeError("Trend thresholds must be finite and ordered.");
  }
  const margin = typeof hysteresis === "number" ? hysteresis : hysteresis.margin ?? 0;
  const previous = typeof hysteresis === "object" ? hysteresis.previousDirection : "stable";
  if (!Number.isFinite(margin) || margin < 0 || margin >= (risingThresh - fallingThresh) / 2) {
    throw new TypeError("Hysteresis must be nonnegative and smaller than half the threshold span.");
  }
  if (slope >= risingThresh) return "rising";
  if (slope <= fallingThresh) return "falling";
  if (previous === "rising" && slope >= risingThresh - margin) return "rising";
  if (previous === "falling" && slope <= fallingThresh + margin) return "falling";
  return "stable";
}

export function trendPersistence(trendHistory = [], maxGapMs = 5000) {
  const history = [...trendHistory].filter(item => Number.isFinite(item.t)).sort((a, b) => a.t - b.t);
  const latest = history.at(-1);
  if (!latest || !["rising", "stable", "falling"].includes(latest.direction) || (latest.quality !== undefined && latest.quality !== "valid")) return 0;
  let start = latest.t;
  for (let index = history.length - 2; index >= 0; index--) {
    const point = history[index];
    if (point.direction !== latest.direction || (point.quality !== undefined && point.quality !== "valid") || start - point.t > maxGapMs) break;
    start = point.t;
  }
  return latest.t - start;
}

export function isInsufficient(samples, minCount = 10, minDurationMs = 30000) {
  const points = normalizeSamples(samples);
  return points.length < minCount || points.length < 2 || points.at(-1).t - points[0].t < minDurationMs;
}

export function isStale(latestTimestamp, maxAgeMs = 5000, now = Date.now()) {
  return !Number.isFinite(latestTimestamp) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0 ||
    !Number.isFinite(now) || latestTimestamp > now || now - latestTimestamp > maxAgeMs;
}

/** Derive qualified trends from successive prefixes, never from render counts. */
export function analyzeNumericTrend(feature, config) {
  const base = { source: feature.source, quality: feature.quality, baselineDeviation: feature.baselineDeviation ?? null,
    direction: null, slope: null, slopeUnit: config.slopeUnit, persistenceMs: null, degrading: false, history: [],
    sampleCount: feature.samples.length, windowStartedAt: feature.samples[0]?.t ?? null, windowEndedAt: feature.samples.at(-1)?.t ?? null };
  if (feature.quality !== "valid") return { ...base, reason: `Current observation is ${feature.quality}.` };
  if (isInsufficient(feature.samples, config.minCount, config.minDurationMs)) {
    return { ...base, reason: `Insufficient data — collecting observations (at least ${config.minCount} samples and ${config.minDurationMs / 1000} seconds).` };
  }
  let previousDirection = "stable";
  const history = [];
  for (let index = 1; index < feature.samples.length; index++) {
    const prefix = feature.samples.slice(0, index + 1);
    if (isInsufficient(prefix, config.minCount, config.minDurationMs)) continue;
    const slope = linearSlope(prefix, config.minCount);
    if (slope === null) continue;
    const perMinute = slope * 60;
    const direction = trendDirection(perMinute, config.risingThreshold, config.fallingThreshold,
      { margin: config.hysteresis, previousDirection });
    history.push({ t: prefix.at(-1).t, direction, slope: perMinute, quality: "valid" });
    previousDirection = direction;
  }
  const latest = history.at(-1);
  if (!latest) return { ...base, reason: "Insufficient data for regression." };
  const persistenceMs = trendPersistence(history, feature.maxGapMs);
  return { ...base, direction: latest.direction, slope: latest.slope, persistenceMs,
    degrading: latest.direction === "rising" && persistenceMs >= config.persistenceMs,
    history, reason: "Qualified trend within the current continuous observation window." };
}
