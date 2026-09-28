import { calcThroughputBeltLoad, calcThroughputGeometry, isNonnegative, PRESETS, unavailable } from "../calculations/throughput.js";
import { accumulateSample, addStateTransition, calcAvailability, classifyTimeState, createAccountingSession,
  pauseAccounting, projectShiftTonnes, suspendAccounting } from "../calculations/accounting.js";
import { forecastThroughput, forecastShiftProjection } from "../calculations/forecast.js";
import { DEFAULT_FORECAST_CONFIG } from "../config/forecastConfig.js";

export const DEFAULT_INPUTS = Object.freeze({
  mode: "beltLoad", area: 0.025, density: 2000, load: 50, designCapacity: "",
  expectedThroughput: 360, assumedFutureThroughput: 360, shiftDurationHrs: 8, orePrice: "", assumedUptime: 1,
  context: "demo", speedMode: "telemetry", fixedSpeed: 2, maxGapMs: 5000,
  scheduled: true, confirmedState: "auto",
});

function flowMetric(speed, settings) {
  const label = settings.context === "demo" ? "DEMO / ESTIMATED" : "ESTIMATED";
  const provenance = [speed.source, "manual"];
  const base = { source: settings.context === "demo" ? "demo" : "derived", label, provenance, unit: "t/h" };
  const fail = (reason, quality = "missing") => ({ ...base, value: null, unavailable: true, reason, quality });
  if (settings.context === "hardware" && (speed.source !== "hardware" || speed.calibrationStatus !== "calibrated")) {
    return fail("Hardware accounting requires calibrated hardware speed. The current speed channel is demo.");
  }
  if (settings.context === "demo" && speed.source !== "demo") return fail("Waiting for demo speed observations.");
  if (speed.quality !== "valid") return fail(`Speed observation is ${speed.quality}; accounting is suspended.`, speed.quality);
  const speedMps = settings.speedMode === "preset" && settings.context === "demo" ? settings.fixedSpeed : speed.value;
  const result = settings.mode === "beltLoad" ? calcThroughputBeltLoad(settings.load, speedMps)
    : calcThroughputGeometry(settings.area, speedMps, settings.density);
  if (typeof result !== "number") return fail(result.reason, "invalid");
  return { ...base, value: result, speedMps, unavailable: false, quality: "valid", reason: null };
}

export function createThroughputController(telemetryStore, { now = telemetryStore.getCurrentTime ?? Date.now } = {}) {
  let settings = { ...DEFAULT_INPUTS };
  let forecastOptions = { ...DEFAULT_FORECAST_CONFIG };
  let flowHistory = [];
  let lastForecastSampleAt = -Infinity;
  let lastForecastSampleId = null;
  let sessions = { demo: createAccountingSession("demo"), hardware: createAccountingSession("hardware") };
  let revision = 0;
  let lastSettingsAt = -Infinity;
  let snapshot;
  const listeners = new Set();

  function rebuild() {
    const speed = telemetryStore.getSnapshot().speed.latest;
    const flow = flowMetric(speed, settings);
    const session = sessions[settings.context];
    const totalMs = Object.values(session.timeMs).reduce((sum, value) => sum + value, 0);
    const base = { source: settings.context === "demo" ? "demo" : "derived",
      label: settings.context === "demo" ? "DEMO / ESTIMATED" : "ESTIMATED", provenance: session.provenance };
    const metric = (result, unit, extra = {}) => typeof result === "number" && Number.isFinite(result)
      ? { ...base, ...extra, value: result, unit, quality: "valid", unavailable: false }
      : { ...base, ...extra, ...(typeof result === "number" ? unavailable("Result exceeds the supported range.") : result), value: null, unit, quality: "missing" };
    const observed = session.validMs > 0;
    const elapsedHours = session.startedAt === null ? 0 : Math.max(0, now() - session.startedAt) / 3600000;
    const remainingHours = isNonnegative(settings.shiftDurationHrs) ? Math.max(0, settings.shiftDurationHrs - elapsedHours) : NaN;
    const remainingScheduledHours = Number.isFinite(remainingHours) ? settings.scheduled ? remainingHours : 0 : NaN;
    const effectiveForecastOptions = { ...forecastOptions, freshnessMs: telemetryStore.getFreshnessLimit("speed"),
      maxGapMs: Math.min(settings.maxGapMs, forecastOptions.maxGapMs, telemetryStore.getFreshnessLimit("speed")) };
    const forecast = forecastThroughput(flowHistory, effectiveForecastOptions, now());
    const dataProjection = observed ? forecastShiftProjection(session.accumulatedTonnes, remainingScheduledHours, settings.assumedUptime,
      flowHistory, effectiveForecastOptions, now()) : unavailable("Projection starts after a valid observed interval.");
    const loss = session.lossUnknownMs > 0 ? unavailable("Expected rate was unavailable during some confirmed downtime.")
      : observed ? session.lostTonnes : unavailable("No valid observed interval yet.");
    snapshot = {
      settings: { ...settings }, sessions, accountingSession: session, flow, forecast, forecastOptions: { ...forecastOptions },
      flowHistory: [...flowHistory], dataProjection,
      metrics: {
        accumulated: metric(observed ? session.accumulatedTonnes : unavailable("No valid observed interval yet."), "t"),
        loss: metric(loss, "t"),
        availability: metric(calcAvailability(session), "%"),
        coverage: metric(totalMs > 0 ? session.validMs / totalMs * 100 : unavailable("No observed interval yet."), "%"),
        projected: metric(observed ? projectShiftTonnes(session.accumulatedTonnes, remainingScheduledHours, settings.assumedFutureThroughput, settings.assumedUptime)
          : unavailable("Projection starts after a valid observed interval."), "t", { label: "ASSUMED", provenance: [...session.provenance, "manual"] }),
        lossValue: metric(typeof loss === "number" && isNonnegative(settings.orePrice) ? loss * settings.orePrice
          : unavailable("Enter a valid price and collect loss observations."), "currency units", { label: "ASSUMED", provenance: [...session.provenance, "manual"] }),
        forecast: { ...metric(forecast.unavailable ? unavailable(forecast.reason) : forecast.value, "t/h", { label: "FORECAST / ESTIMATED" }),
          source: forecast.source, quality: forecast.quality },
        time: Object.fromEntries(Object.entries(session.timeMs).map(([state, duration]) =>
          [state, metric(duration / 1000, "s")])),
      },
      remainingHours, remainingScheduledHours,
      status: flow.unavailable ? flow.reason : session.status,
    };
  }
  function notify() { rebuild(); for (const listener of listeners) listener(); }

  function consume() {
    const { latest: speed, generation } = telemetryStore.getSnapshot().speed;
    const flow = flowMetric(speed, settings);
    const context = settings.context;
    const session = sessions[context];
    if (flow.unavailable) {
      flowHistory = [];
      sessions = { ...sessions, [context]: suspendAccounting(session, flow.reason) };
    } else if (speed.acquiredAt >= lastSettingsAt) {
      const sample = {
        sampleId: speed.sampleId, at: speed.acquiredAt, tph: flow.value, quality: flow.quality,
        source: flow.source, provenance: flow.provenance, context,
        identity: JSON.stringify([speed.source, speed.deviceId, speed.calibrationStatus, generation, revision]),
        state: classifyTimeState({ ...settings, speed: flow.speedMps, quality: flow.quality }),
        expectedThroughput: settings.expectedThroughput,
      };
      if (speed.acquiredAt > lastForecastSampleAt && speed.sampleId !== lastForecastSampleId) {
        lastForecastSampleAt = speed.acquiredAt;
        lastForecastSampleId = speed.sampleId;
        const point = { t: sample.at, v: sample.tph, quality: sample.quality, source: sample.source,
          identity: sample.identity, regime: sample.state, sampleId: sample.sampleId };
        const previous = flowHistory.at(-1);
        if (previous && (previous.identity !== point.identity || previous.regime !== point.regime ||
          point.t - previous.t > Math.min(settings.maxGapMs, forecastOptions.maxGapMs, telemetryStore.getFreshnessLimit("speed")))) flowHistory = [];
        flowHistory = [...flowHistory, point].filter(item => item.t >= point.t - forecastOptions.windowMs).slice(-2048);
      }
      sessions = { ...sessions, [context]: accumulateSample(session, sample,
        { maxGapMs: Math.min(settings.maxGapMs, telemetryStore.getFreshnessLimit("speed")) }) };
    }
    notify();
  }

  function updateInputs(patch) {
    const previousSettings = settings;
    const next = { ...settings, ...patch };
    if (!['demo', 'hardware'].includes(next.context) || !['beltLoad', 'geometry'].includes(next.mode) ||
      !['telemetry', 'preset'].includes(next.speedMode) || !isNonnegative(next.maxGapMs) || next.maxGapMs === 0) return;
    if (previousSettings.context !== next.context) {
      // A confirmation made in demo must never confirm a physical stop.
      next.confirmedState = "auto";
      next.scheduled = true;
      if (next.context === "hardware") next.speedMode = "telemetry";
    }
    settings = next;
    if (['context', 'mode', 'area', 'density', 'load', 'speedMode', 'fixedSpeed', 'maxGapMs', 'scheduled', 'confirmedState']
      .some(key => previousSettings[key] !== settings[key])) flowHistory = [];
    lastSettingsAt = now();
    if (previousSettings.context !== settings.context) {
      sessions = { ...sessions, [previousSettings.context]: pauseAccounting(sessions[previousSettings.context]),
        [settings.context]: pauseAccounting(sessions[settings.context]) };
      revision++;
    } else {
      const changesFlow = ['mode', 'area', 'density', 'load', 'speedMode', 'fixedSpeed', 'maxGapMs'].some(key => previousSettings[key] !== settings[key]);
      if (changesFlow) {
        revision++;
        sessions = { ...sessions, [settings.context]: suspendAccounting(sessions[settings.context], "Inputs changed; awaiting a new interval") };
      }
      const changesState = ['scheduled', 'confirmedState', 'expectedThroughput'].some(key => previousSettings[key] !== settings[key]);
      if (changesState) {
        const flow = flowMetric(telemetryStore.getSnapshot().speed.latest, settings);
        const transition = { at: lastSettingsAt,
          state: classifyTimeState({ ...settings, speed: flow.speedMps, quality: flow.quality }),
          expectedThroughput: settings.expectedThroughput };
        sessions = { ...sessions, [settings.context]: addStateTransition(sessions[settings.context], transition) };
      }
    }
    notify();
  }

  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    const parameters = name === "beltLoad360" ? { load: preset.load } : { area: preset.area, density: preset.density };
    updateInputs({ ...parameters, fixedSpeed: preset.speed, speedMode: "preset", context: "demo",
      mode: name === "beltLoad360" ? "beltLoad" : "geometry" });
  }

  rebuild();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    connect() { const unsubscribe = telemetryStore.subscribe(consume); consume(); return unsubscribe; },
    updateInputs, applyPreset,
    updateForecastOptions(patch) { forecastOptions = { ...forecastOptions, ...patch }; notify(); },
    resetSession() { flowHistory = []; lastForecastSampleAt = -Infinity; lastForecastSampleId = null;
      sessions = { ...sessions, [settings.context]: createAccountingSession(settings.context) }; lastSettingsAt = now(); revision++; notify(); },
    suspend() { flowHistory = []; sessions = { ...sessions, [settings.context]: pauseAccounting(sessions[settings.context]) }; notify(); },
  };
}
