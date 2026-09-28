import { observationIdentity } from "../telemetry/observationContract.js";
import { isInsufficient, linearSlope } from "./temporal.js";

const waveformUnavailable = () => ({ unavailable: true, reason: "Unavailable — requires waveform acquisition." });
const validObservation = item => item.quality === "valid" && Number.isFinite(item.acquiredAt) && Number.isFinite(item.value);

export function orderedObservations(observations = []) {
  const byId = new Map();
  for (const item of observations) if (Number.isFinite(item.acquiredAt)) byId.set(item.sampleId ?? `${item.field ?? ""}:${item.acquiredAt}`, item);
  const byTime = new Map();
  for (const item of [...byId.values()].sort((a, b) => a.acquiredAt - b.acquiredAt || a.receivedAt - b.receivedAt)) byTime.set(item.acquiredAt, item);
  return [...byTime.values()];
}

/** Final valid contiguous segment, bounded relative to its latest acquisition. */
export function numericWindow(observations, { windowMs = 120000, maxGapMs = 5000, floor = -Infinity } = {}) {
  const ordered = orderedObservations(observations);
  const latest = ordered.at(-1);
  if (!latest || !validObservation(latest)) return [];
  const identity = observationIdentity(latest);
  const segment = [];
  let following = latest.acquiredAt;
  for (let index = ordered.length - 1; index >= 0; index--) {
    const item = ordered[index];
    if (!validObservation(item) || observationIdentity(item) !== identity || following - item.acquiredAt > maxGapMs ||
      item.acquiredAt < floor || latest.acquiredAt - item.acquiredAt > windowMs) break;
    segment.unshift(item);
    following = item.acquiredAt;
  }
  return segment;
}

export function sampleStatistics(samples) {
  const values = samples.map(point => point.v).filter(Number.isFinite);
  if (!values.length) return { mean: null, maximum: null, variance: null, standardDeviation: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, maximum: Math.max(...values), variance, standardDeviation: Math.sqrt(variance) };
}

/** Left-hold at/above threshold between observed endpoints, no wall-clock extrapolation. */
export function timeAboveThreshold(samples, threshold, maxGapMs = 5000) {
  let durationMs = 0;
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1], current = samples[index];
    const elapsed = current.t - previous.t;
    if (Number.isFinite(previous.v) && Number.isFinite(current.v) && elapsed > 0 && elapsed <= maxGapMs && previous.v >= threshold) durationMs += elapsed;
  }
  return durationMs;
}

export function findStableBaseline(samples, { minCount = 10, durationMs = 30000, varianceThreshold = 0.04, maxGapMs = 5000 } = {}) {
  for (let end = 1; end < samples.length; end++) {
    let start = end;
    while (start > 0 && samples[end].t - samples[start].t < durationMs) start--;
    const candidate = samples.slice(start, end + 1);
    if (isInsufficient(candidate, minCount, durationMs) || candidate.some((point, index) => index > 0 && point.t - candidate[index - 1].t > maxGapMs)) continue;
    const stats = sampleStatistics(candidate);
    if (stats.variance < varianceThreshold) return { value: stats.mean, variance: stats.variance,
      startedAt: candidate[0].t, qualifiedAt: candidate.at(-1).t,
      reason: "Stable observed reference; stability alone does not establish equipment health." };
  }
  return null;
}

function numericFeatures(observations, options) {
  const ordered = orderedObservations(observations);
  const latest = options.latest ?? ordered.at(-1);
  const quality = latest?.quality ?? "missing";
  const segment = quality === "valid" ? numericWindow(ordered, options) : [];
  const samples = segment.map(item => ({ t: item.acquiredAt, v: item.value, quality: "valid" }));
  const thresholds = options.thresholds;
  const current = quality === "valid" && validObservation(latest) ? latest.value : null;
  const sufficient = !isInsufficient(samples, options.minCount ?? 10, options.minDurationMs ?? 30000);
  const slope = sufficient ? linearSlope(samples, options.minCount ?? 10) : null;
  return {
    source: latest?.source ?? "unavailable", quality, sampleId: latest?.sampleId ?? null,
    observedAt: latest?.acquiredAt ?? null, current, samples, maxGapMs: options.maxGapMs ?? 5000,
    ...sampleStatistics(samples), slope: slope === null ? null : slope * 60,
    timeAboveThresholdMs: Object.fromEntries(thresholds.map(value => [value, samples.length ? timeAboveThreshold(samples, value, options.maxGapMs ?? 5000) : null])),
    thresholdState: current === null ? "unavailable" : current >= thresholds[1] ? "critical" : current >= thresholds[0] ? "warning" : "belowThresholds",
    sufficient,
  };
}

export function extractPiezoFeatures(observations, options = {}) {
  return { ...numericFeatures(observations, { thresholds: [500, 800], ...options }), unit: "ADC", slopeUnit: "ADC/min",
    waveformRMS: waveformUnavailable(), crestFactor: waveformUnavailable(), frequencyAnalysis: waveformUnavailable(), bearingFaultDiagnosis: waveformUnavailable() };
}

export function extractTemperatureFeatures(observations, options = {}) {
  const feature = numericFeatures(observations, { thresholds: [35, 40], ...options });
  const baseline = feature.quality === "valid" ? options.baseline ?? findStableBaseline(feature.samples, {
    minCount: options.minCount ?? 10, durationMs: options.baselineDurationMs ?? 30000,
    varianceThreshold: options.baselineVarianceThreshold ?? 0.04, maxGapMs: feature.maxGapMs,
  }) : null;
  return { ...feature, unit: "°C", slopeUnit: "°C/min", baseline,
    baselineDeviation: baseline && feature.current !== null ? feature.current - baseline.value : null,
    baselineReason: baseline ? baseline.reason : "Baseline unavailable — collecting a qualified stable window." };
}

/** Debounce is confirmed by observations, not by a render or an unattended timer. */
export function extractBinaryFeatures(observations, { latest, windowMs = 120000, maxGapMs = 5000, debounceMs = 250 } = {}) {
  const ordered = orderedObservations(observations);
  const head = latest ?? ordered.at(-1);
  const identity = head ? observationIdentity(head) : null;
  const window = ordered.filter(item => head && head.acquiredAt - item.acquiredAt <= windowMs && observationIdentity(item) === identity);
  const events = [];
  let stable = null, candidate = null, active = null, previous = null, segment = 0, segmentStart = null;
  function finish(at, interrupted = false) {
    if (!active) return;
    const end = interrupted ? active.lastObservedAt : at;
    events.push({ ...active, endedAt: end, durationMs: Math.max(0, end - active.startedAt), open: false,
      incomplete: interrupted || active.leftCensored, status: interrupted ? "incomplete" : active.leftCensored ? "incomplete" : "complete" });
    active = null;
  }
  function start(at, leftCensored) {
    active = { startedAt: at, lastObservedAt: at, leftCensored, transitionObserved: !leftCensored, segment };
  }
  for (const item of window) {
    const valid = validObservation(item) && (item.value === 0 || item.value === 1);
    if (!valid || (previous && item.acquiredAt - previous.acquiredAt > maxGapMs)) {
      finish(previous?.acquiredAt ?? item.acquiredAt, true);
      stable = null; candidate = null; previous = null; segment++; segmentStart = null;
      if (!valid) continue;
    }
    if (stable === null) {
      stable = item.value;
      segmentStart = item.acquiredAt;
      if (stable === 0) start(item.acquiredAt, true);
    } else if (item.value === stable) {
      candidate = null;
    } else {
      if (!candidate || candidate.value !== item.value) candidate = { value: item.value, at: item.acquiredAt };
      if (item.acquiredAt - candidate.at >= debounceMs) {
        if (candidate.value === 0) start(candidate.at, false);
        else finish(candidate.at);
        stable = candidate.value;
        candidate = null;
      }
    }
    if (active && item.value === 0) active.lastObservedAt = item.acquiredAt;
    previous = item;
  }
  if (head?.quality !== "valid") finish(previous?.acquiredAt ?? head?.acquiredAt, true);
  if (active) events.push({ ...active, endedAt: null, durationMs: active.lastObservedAt - active.startedAt,
    open: true, incomplete: active.leftCensored, status: "ongoing" });
  const currentEvents = events.filter(event => event.segment === segment && event.transitionObserved);
  const elapsedMs = previous && segmentStart !== null ? previous.acquiredAt - segmentStart : 0;
  const validCurrent = head?.quality === "valid" && (head.value === 0 || head.value === 1);
  return {
    source: head?.source ?? "unavailable", quality: head?.quality ?? "missing", sampleId: head?.sampleId ?? null,
    current: validCurrent ? head.value === 0 ? "blocked" : "clear" : "unknown",
    eventCount: currentEvents.length, frequencyPerMinute: elapsedMs > 0 ? currentEvents.length * 60000 / elapsedMs : null,
    recurrent: currentEvents.length > 1, events, currentEvent: events.findLast(event => event.open) ?? null,
    interruptedEvents: events.filter(event => event.incomplete && !event.open),
    observationDurationMs: elapsedMs, windowStartedAt: segmentStart, observedAt: head?.acquiredAt ?? null,
    sampleCount: window.filter(item => validObservation(item) && segmentStart !== null && item.acquiredAt >= segmentStart).length,
    debounceMs, maxGapMs,
  };
}

export function extractHallFeatures(observations, options = {}) {
  return { ...extractBinaryFeatures(observations, options), role: "Supporting evidence for splice zone",
    integrityPercentage: { unavailable: true, reason: "Binary Hall events do not measure integrity percentage." } };
}

export function extractIRFeatures(leftObservations, rightObservations, options = {}) {
  const left = extractBinaryFeatures(leftObservations, { ...options, latest: options.leftLatest });
  const right = extractBinaryFeatures(rightObservations, { ...options, latest: options.rightLatest });
  const known = left.current !== "unknown" && right.current !== "unknown";
  const currentState = !known ? "unknown" : left.current === "blocked" && right.current === "blocked" ? "bothBlocked"
    : left.current === "blocked" ? "leftBlocked" : right.current === "blocked" ? "rightBlocked" : "clear";
  const leftHistory = orderedObservations(leftObservations), rightHistory = orderedObservations(rightObservations);
  const latestTime = Math.max(leftHistory.at(-1)?.acquiredAt ?? 0, rightHistory.at(-1)?.acquiredAt ?? 0);
  const timeline = [...new Set([...leftHistory, ...rightHistory].map(item => item.acquiredAt))]
    .filter(t => t >= Math.max(latestTime - (options.windowMs ?? 120000), left.windowStartedAt ?? latestTime, right.windowStartedAt ?? latestTime)).sort((a, b) => a - b);
  const durationMs = { left: 0, right: 0, both: 0, clear: 0, unknown: 0 };
  const maxGapMs = options.maxGapMs ?? 5000;
  for (let index = 1; index < timeline.length; index++) {
    const at = timeline[index - 1], end = timeline[index];
    const l = leftHistory.findLast(item => item.acquiredAt <= at), r = rightHistory.findLast(item => item.acquiredAt <= at);
    const usable = l && r && validObservation(l) && validObservation(r) &&
      observationIdentity(l) === observationIdentity(leftHistory.at(-1)) && observationIdentity(r) === observationIdentity(rightHistory.at(-1)) &&
      end - l.acquiredAt <= maxGapMs && end - r.acquiredAt <= maxGapMs;
    const side = !usable ? "unknown" : l.value === 0 && r.value === 0 ? "both" : l.value === 0 ? "left" : r.value === 0 ? "right" : "clear";
    durationMs[side] += end - at;
  }
  return { left, right, currentState, bothBlocked: currentState === "bothBlocked",
    sideDistribution: { durationMs, basis: "Left-hold valid beam observations; unknown spans excluded from obstruction time." },
    displacement: { unavailable: true, reason: "Binary beam events do not measure displacement or angle." } };
}
