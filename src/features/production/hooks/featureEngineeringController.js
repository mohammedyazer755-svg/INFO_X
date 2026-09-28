import { ANALYSIS_CONFIG } from "../config/analysisConfig.js";
import { observationIdentity } from "../telemetry/observationContract.js";
import { extractPiezoFeatures, extractTemperatureFeatures,
  extractIRFeatures, extractHallFeatures } from "../calculations/features.js";

export function createFeatureEngineeringController(store, overrides = {}) {
  const config = { ...ANALYSIS_CONFIG, ...overrides,
    piezoVal: { ...ANALYSIS_CONFIG.piezoVal, ...overrides.piezoVal },
    tempC: { ...ANALYSIS_CONFIG.tempC, ...overrides.tempC } };
  const fields = ["piezoVal", "tempC", "irLeft", "irRight", "magState"];
  const caches = Object.fromEntries(fields.map(field => [field, {
    identity: null, generation: null, lastAt: null, lastSampleId: null,
    floor: -Infinity, baseline: null, unavailable: false, epoch: 0,
  }]));
  const listeners = new Set();
  let snapshot;
  let enabled = true;

  function compute() {
    const telemetry = store.getSnapshot();
    const observations = {};
    const latestByField = {};
    const numeric = {};
    for (const field of fields) {
      const { latest, generation } = telemetry[field];
      const head = enabled ? latest : { ...latest, quality: "missing" };
      const cache = caches[field];
      const identity = observationIdentity(head);
      const maxGapMs = Math.min(config.maxGapMs ?? Infinity, store.getFreshnessLimit(field));
      const changedContext = cache.identity !== null && (cache.identity !== identity || cache.generation !== generation);
      const newSample = cache.lastSampleId !== head.sampleId;
      const gap = newSample && cache.lastAt !== null && head.acquiredAt - cache.lastAt > maxGapMs;
      if (head.quality !== "valid") {
        if (!cache.unavailable || changedContext) cache.epoch++;
        cache.unavailable = true;
        cache.baseline = null;
      } else {
        if (changedContext || gap || cache.unavailable) {
          cache.floor = head.acquiredAt;
          cache.baseline = null;
          cache.epoch++;
        }
        cache.unavailable = false;
      }
      cache.identity = identity; cache.generation = generation;
      cache.lastAt = head.acquiredAt; cache.lastSampleId = head.sampleId;
      latestByField[field] = head;
      observations[field] = store.getRecordedHistory(field);
      const options = { ...config, ...config[field], latest: head, maxGapMs, floor: cache.floor, baseline: cache.baseline };
      if (field === "piezoVal" || field === "tempC") {
        const feature = field === "piezoVal" ? extractPiezoFeatures(observations[field], options) : extractTemperatureFeatures(observations[field], options);
        if (field === "tempC") cache.baseline = feature.baseline;
        numeric[field] = { ...feature, epoch: cache.epoch, config: options };
      }
    }
    const binaryOptions = { windowMs: config.windowMs, debounceMs: config.debounceMs,
      maxGapMs: Math.min(config.maxGapMs ?? Infinity, store.getFreshnessLimit("irLeft"), store.getFreshnessLimit("irRight")) };
    const tracking = extractIRFeatures(observations.irLeft, observations.irRight, {
      ...binaryOptions, leftLatest: latestByField.irLeft, rightLatest: latestByField.irRight,
    });
    const hall = extractHallFeatures(observations.magState, { ...binaryOptions, latest: latestByField.magState,
      maxGapMs: Math.min(config.maxGapMs ?? Infinity, store.getFreshnessLimit("magState")) });
    snapshot = { ...numeric, tracking, hall, config };
  }

  function notify() { compute(); for (const listener of listeners) listener(); }
  compute();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    connect() { enabled = true; const unsubscribe = store.subscribe(notify); notify(); return unsubscribe; },
    pause() { enabled = false; notify(); },
  };
}
