import { DEFAULT_FORECAST_CONFIG } from "../config/forecastConfig.js";
import { linearSlope } from "./temporal.js";
import { projectShiftTonnes } from "./accounting.js";

function averageLinearRate(intercept, slope, durationSeconds, bounds) {
  const clip = value => bounds ? Math.max(bounds.min, Math.min(bounds.max, value)) : value;
  const knots = [0, durationSeconds];
  if (bounds && slope !== 0) for (const bound of [bounds.min, bounds.max]) {
    const crossing = (bound - intercept) / slope;
    if (crossing > 0 && crossing < durationSeconds) knots.push(crossing);
  }
  knots.sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < knots.length; i++) area += (knots[i] - knots[i - 1]) * (clip(intercept + slope * knots[i]) + clip(intercept + slope * knots[i - 1])) / 2;
  return area / durationSeconds;
}

export function forecastThroughput(history, options = {}, now = Date.now()) {
  const config = { ...DEFAULT_FORECAST_CONFIG, ...options };
  const bounds = config.physicalBounds;
  const assumptions = ["Current operating regime and calculation inputs continue.", "Calculated throughput retains its measurement and manual-input assumptions.",
    "Forecast horizon starts at the latest acquisition time.",
    bounds ? `Configured physical bounds applied: ${bounds.min} to ${bounds.max} t/h.` : "No physical bounds configured; extrapolated values are not clipped."];
  const base = { method: config.method, config, assumptions, source: history.at(-1)?.source ?? "unavailable", quality: "missing",
    observationWindow: { start: null, end: null, sampleCount: 0 }, observed: [], forecast: [], value: null, averageRate: null, unavailable: true };
  const fail = (reason, extra = {}) => ({ ...base, ...extra, reason });
  if (!["rollingBaseline", "linearTrend"].includes(config.method) ||
    ![config.windowMs, config.minDurationMs, config.horizonMs, config.maxHorizonMs, config.maxGapMs, config.freshnessMs].every(v => Number.isFinite(v) && v > 0) ||
    !Number.isInteger(config.minCount) || config.minCount < 2 || config.minDurationMs > config.windowMs || config.horizonMs > config.maxHorizonMs ||
    (bounds !== null && (!bounds || !Number.isFinite(bounds.min) || !Number.isFinite(bounds.max) || bounds.min < 0 || bounds.max < bounds.min))) {
    return fail("Invalid forecast configuration or horizon exceeds configured maximum.");
  }
  const latest = history.at(-1);
  if (!latest) return fail("Collecting continuous throughput observations.");
  if (history.some(sample => !Number.isFinite(sample.t))) return fail("Missing acquisition timestamps; continuous history unavailable.", { quality: "invalid" });
  if (!Number.isFinite(now) || !Number.isFinite(latest.t) || now < latest.t || now - latest.t > config.freshnessMs) return fail("Throughput data is stale; forecast suspended.", { quality: "stale" });
  const samples = history.filter(sample => sample.t >= latest.t - config.windowMs);
  const metadata = { observed: samples, observationWindow: { start: samples[0]?.t ?? null, end: latest.t, sampleCount: samples.length } };
  if (!latest.identity || !["hardware", "demo", "manual", "derived"].includes(latest.source) || samples.some((sample, index) => sample.quality !== "valid" || !Number.isFinite(sample.t) || !Number.isFinite(sample.v) || sample.v < 0 ||
    sample.identity !== latest.identity || sample.source !== latest.source || sample.regime !== latest.regime || sample.regime !== "scheduledRunning" ||
    (index > 0 && (sample.t <= samples[index - 1].t || sample.t - samples[index - 1].t > config.maxGapMs)))) {
    return fail("Missing, invalid, changed-source or changed-regime observations; a new continuous window is required.", { ...metadata, quality: "invalid" });
  }
  if (samples.length < config.minCount || latest.t - samples[0].t < config.minDurationMs) return fail("Collecting minimum forecast history.", metadata);
  const reference = samples[0].v;
  const mean = reference + samples.reduce((sum, sample) => sum + (sample.v - reference) / samples.length, 0);
  const slope = config.method === "linearTrend" ? linearSlope(samples, config.minCount) : 0;
  if (!Number.isFinite(slope) || !Number.isFinite(mean)) return fail("Regression or baseline unavailable for this window.", metadata);
  const meanT = samples.reduce((sum, sample) => sum + (sample.t - latest.t) / samples.length, 0);
  const intercept = mean - slope * meanT / 1000;
  const clip = value => bounds ? Math.max(bounds.min, Math.min(bounds.max, value)) : value;
  const points = Array.from({ length: 25 }, (_, i) => ({ t: latest.t + config.horizonMs * i / 24, v: clip(intercept + slope * config.horizonMs * i / 24000) }));
  if (points.some(point => !Number.isFinite(point.v))) return fail("Forecast exceeds supported numeric range.", metadata);
  return { ...base, ...metadata, quality: "valid", unavailable: false, reason: null, forecast: points, value: points.at(-1).v,
    slopePerSecond: slope, baselineAtLatest: intercept, averageRate: averageLinearRate(intercept, slope, config.horizonMs / 1000, bounds) };
}

export function forecastShiftProjection(accumulated, remainingHours, uptime, history, options = {}, now = Date.now()) {
  if (![accumulated, remainingHours, uptime].every(v => Number.isFinite(v) && v >= 0) || uptime > 1) return { unavailable: true, reason: "Invalid shift total, remaining hours or future uptime assumption." };
  if (remainingHours === 0) return { unavailable: false, value: accumulated, reason: "No remaining scheduled hours; observed accumulated tonnes only." };
  const config = { ...DEFAULT_FORECAST_CONFIG, ...options };
  const forecast = forecastThroughput(history, config, now);
  if (forecast.unavailable) return forecast;
  const ageMs = now - forecast.observationWindow.end;
  if (remainingHours * 3600000 + ageMs > config.horizonMs) return { unavailable: true, reason: "Remaining shift exceeds selected forecast horizon; use the separate what-if scenario." };
  const assumedRate = averageLinearRate(forecast.baselineAtLatest + forecast.slopePerSecond * ageMs / 1000,
    forecast.slopePerSecond, remainingHours * 3600, config.physicalBounds);
  const value = projectShiftTonnes(accumulated, remainingHours, assumedRate, uptime);
  return typeof value === "number" ? { unavailable: false, value, assumedRate, source: forecast.source, quality: forecast.quality }
    : value;
}

export function temperatureCrossing(feature, temporal, threshold, { now = Date.now(), freshnessMs = 5000, maxHorizonMs = 900000, minSlopePerMinute = 0.01 } = {}) {
  const fail = reason => ({ unavailable: true, value: null, label: "Extrapolation at current rate", reason });
  if (![threshold, feature?.current, feature?.observedAt, now, freshnessMs, maxHorizonMs, minSlopePerMinute].every(Number.isFinite) || freshnessMs <= 0 || maxHorizonMs <= 0 || minSlopePerMinute < 0) return fail("Invalid threshold or projection configuration.");
  if (feature.quality !== "valid" || now < feature.observedAt || now - feature.observedAt > freshnessMs) return fail("Temperature data is stale or unavailable.");
  if (feature.current >= threshold) return { unavailable: false, value: 0, label: "Extrapolation at current rate", reason: "Threshold already reached or exceeded.", source: feature.source };
  if (!feature.sufficient || temporal?.direction !== "rising" || !Number.isFinite(temporal.slope) || temporal.slope <= minSlopePerMinute) return fail("A qualified positive trend above the near-zero slope limit is required.");
  const durationMs = (threshold - feature.current) / temporal.slope * 60000;
  if (!Number.isFinite(durationMs) || durationMs > maxHorizonMs) return fail("Threshold crossing exceeds maximum extrapolation horizon.");
  return { unavailable: false, value: durationMs, crossingAt: feature.observedAt + durationMs, source: feature.source,
    label: "Extrapolation at current rate", reason: "Assumes the qualified current rise rate continues; this is a temperature threshold, not equipment failure time." };
}
