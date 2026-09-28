import { createTelemetryStore } from "../telemetry/telemetryStore.js";
import { createTelemetryRouter } from "../telemetry/telemetryRouter.js";

export const SCENARIOS = Object.freeze({
  normal: { label: "Normal", description: "Steady 360 t/h, clear beams and stable temperature." },
  reducedLoading: { label: "Reduced loading", description: "35 kg/m at 2 m/s: estimated 252 t/h; conveyor keeps running." },
  risingTemp: { label: "Rising temperature", description: "0.4 °C/min from 34.8 °C; conveyor keeps running." },
  combinedThermalMechanical: { label: "Combined thermal / mechanical", description: "0.4 °C/min and 0.4 ADC/s; warning, corroboration and NODE 01 inspection suggestion." },
  confirmedDemoStop: { label: "Confirmed demo stop", description: "Explicit simulated stop from mission minute 1 to minute 2; demo loss only." },
  telemetryLoss: { label: "Telemetry loss", description: "No scenario observations from minute 1 to minute 2; stale analysis and suspended accounting." },
});
export const SCENARIO_EPOCH = Date.UTC(2026, 0, 1);

// Stateless seeded noise: fixture results do not depend on playback speed or tick batching.
export function seededValue(seed, index) {
  let value = (seed ^ Math.imul(index + 1, 0x45d9f3b)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b) >>> 0;
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}

export function scenarioFixture(name, elapsedMs, seed = 42) {
  if (!SCENARIOS[name] || !Number.isFinite(elapsedMs) || elapsedMs < 0) throw new TypeError("Invalid scenario fixture.");
  const seconds = elapsedMs / 1000, minute = seconds / 60;
  const ramp = ["risingTemp", "combinedThermalMechanical"].includes(name);
  const stopped = name === "confirmedDemoStop" && seconds >= 60 && seconds < 120;
  const missing = name === "telemetryLoss" && seconds >= 60 && seconds < 120;
  return { load: name === "reducedLoading" ? 35 : 50, confirmedState: stopped ? "confirmedUnplannedStop" : "auto", missing,
    values: { tempC: ramp ? 34.8 + 0.4 * minute : 32,
      piezoVal: name === "combinedThermalMechanical" ? Math.min(4095, 490 + 0.4 * seconds) : 180 + 6 * seededValue(seed, Math.floor(seconds)),
      speed: stopped ? 0 : 2, irLeft: 1, irRight: 1, magState: 1, proxState: stopped ? 0 : 1, laserState: 0 } };
}

export function createScenarioEngine(liveStore, { now = () => performance.now(), schedule = setInterval, cancel = clearInterval,
  onContext = () => {}, onReset = () => {}, onFrame = () => {} } = {}) {
  let name = "normal", seed = 42, timeScale = 10, elapsedMs = 0, sampledMs = -1000;
  let source = "live", running = false, connected = false, timer = null, previousWall = null;
  const listeners = new Set(), clockListeners = new Set();
  const getTime = () => SCENARIO_EPOCH + elapsedMs;
  const demoStore = createTelemetryStore({ now: getTime, schedule: () => 0, cancel: () => {} });
  const store = createTelemetryRouter(liveStore, demoStore);
  let snapshot;
  const clock = Object.freeze({ getTime, getScale: () => timeScale, subscribe(listener) { clockListeners.add(listener); return () => clockListeners.delete(listener); } });
  function notify() { snapshot = { name, label: SCENARIOS[name].label, description: SCENARIOS[name].description, seed, timeScale, elapsedMs, running, source }; listeners.forEach(listener => listener()); }
  function stopTimer() { if (timer !== null) cancel(timer); timer = null; previousWall = null; }
  function sample() {
    const fixture = scenarioFixture(name, elapsedMs, seed);
    onFrame(fixture);
    if (!fixture.missing) for (const [field, value] of Object.entries(fixture.values)) demoStore.publish({ field, value, source: "demo",
      scenarioTag: name, acquiredAt: getTime(), receivedAt: getTime(), sampleId: `${name}:${seed}:${field}:${elapsedMs}`,
      calibrationStatus: "not-applicable", deviceId: `scenario:${name}:${seed}` });
    demoStore.refresh(true);
    clockListeners.forEach(listener => listener());
  }
  function advance(realMs) {
    if (!running || source !== "scenario" || !Number.isFinite(realMs) || realMs <= 0) return;
    const target = elapsedMs + realMs * timeScale;
    while (sampledMs + 1000 <= target) { elapsedMs = sampledMs + 1000; sampledMs = elapsedMs; sample(); }
    elapsedMs = target; demoStore.refresh(true); clockListeners.forEach(listener => listener()); notify();
  }
  function arm() {
    if (!connected || !running || timer !== null) return;
    previousWall = now();
    timer = schedule(() => { const wall = now(); const delta = Math.min(1000, Math.max(0, wall - previousWall)); previousWall = wall; advance(delta); }, 100);
  }
  function resetRun() { elapsedMs = 0; sampledMs = -1000; demoStore.resetWindows({ clearReplay: true }); onReset(); clockListeners.forEach(listener => listener()); }
  function selectSource(next) {
    if (!["live", "scenario"].includes(next) || next === source) return;
    running = false; stopTimer(); source = next; store.select(next); onContext(next === "scenario" ? "demo" : "hardware");
    if (next === "scenario") resetRun();
    notify();
  }
  notify();
  return { store, demoStore, clock, getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    connect() { connected = true; arm(); return () => { connected = false; stopTimer(); }; },
    configure(patch) { if (running) return; if (patch.name !== undefined && !SCENARIOS[patch.name]) return;
      if (patch.timeScale !== undefined && (!Number.isFinite(patch.timeScale) || patch.timeScale <= 0 || patch.timeScale > 60)) return;
      if (patch.seed !== undefined && !Number.isInteger(patch.seed)) return;
      const changedFixture = patch.name !== undefined && patch.name !== name || patch.seed !== undefined && patch.seed !== seed;
      name = patch.name ?? name; seed = patch.seed ?? seed; timeScale = patch.timeScale ?? timeScale;
      if (changedFixture && source === "scenario") resetRun(); notify(); },
    selectSource, advance,
    start() { if (source !== "scenario") selectSource("scenario"); if (running) return;
      running = true; if (sampledMs < 0) { sampledMs = 0; sample(); } notify(); arm(); },
    pause() { running = false; stopTimer(); notify(); },
    reset() { running = false; stopTimer(); if (source === "scenario") resetRun(); notify(); },
  };
}
