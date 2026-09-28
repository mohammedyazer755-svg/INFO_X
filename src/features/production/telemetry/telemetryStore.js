import { CHANNELS, createObservation, observationIdentity } from "./observationContract.js";

export function createTelemetryStore({
  maxEntries = 120, freshnessLimitMs = 5000, freshnessByChannel = {},
  now = Date.now, refreshIntervalMs = 250,
  schedule = setInterval, cancel = clearInterval,
} = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError("maxEntries must be positive");
  if (!Number.isFinite(freshnessLimitMs) || freshnessLimitMs < 0) throw new TypeError("Invalid freshness limit");
  if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0) throw new TypeError("Invalid refresh interval");
  for (const limit of Object.values(freshnessByChannel)) {
    if (!Number.isFinite(limit) || limit < 0) throw new TypeError("Invalid channel freshness limit");
  }

  const channels = new Map(Object.keys(CHANNELS).map(field => [field, {
    history: [], latest: createObservation({ field, receivedAt: now() }),
    identity: null, boundary: -Infinity, seen: new Set(), generation: 0,
  }]));
  const listeners = new Set();
  let timer = null;
  let snapshot;

  function materialize(observation) {
    const limit = freshnessByChannel[observation.field] ?? freshnessLimitMs;
    return observation.quality === "valid" && now() - observation.acquiredAt > limit
      ? Object.freeze({ ...observation, quality: "stale" }) : observation;
  }

  function rebuild() {
    snapshot = Object.freeze(Object.fromEntries([...channels].map(([field, channel]) => [field,
      Object.freeze({ latest: materialize(channel.latest),
        history: Object.freeze(channel.history.map(materialize)), generation: channel.generation }),
    ])));
  }

  function notify() {
    rebuild();
    for (const listener of listeners) listener();
  }

  function refresh() {
    const changed = [...channels].some(([field, channel]) =>
      materialize(channel.latest).quality !== snapshot[field].latest.quality ||
      channel.history.some((item, index) => materialize(item).quality !== snapshot[field].history[index]?.quality));
    if (changed) notify();
  }

  function publish(input) {
    const observation = createObservation(input);
    const channel = channels.get(observation.field);
    if (channel.seen.has(observation.sampleId) || observation.acquiredAt < channel.boundary) return false;
    const identity = observationIdentity(observation);
    const isLatest = observation.acquiredAt >= channel.latest.acquiredAt || channel.identity === null;
    // Late samples from a superseded device/source must never re-open its window.
    if (!isLatest && identity !== channel.identity) return false;
    channel.seen.add(observation.sampleId);
    // Bounded replay protection, retained across analysis resets.
    if (channel.seen.size > maxEntries * 4) channel.seen.delete(channel.seen.values().next().value);
    if (channel.identity !== identity) {
      if (channel.identity !== null) {
        channel.history = [];
        channel.generation += 1;
        channel.boundary = observation.acquiredAt;
      }
      channel.identity = identity;
    }
    channel.history.push(observation);
    channel.history.sort((a, b) => a.acquiredAt - b.acquiredAt || a.receivedAt - b.receivedAt);
    channel.history = channel.history.slice(-maxEntries);
    if (isLatest) channel.latest = observation;
    notify();
    return true;
  }

  function invalidateHardware() {
    let changed = false;
    for (const channel of channels.values()) {
      if (channel.latest.source !== "hardware") continue;
      channel.history = [];
      channel.generation += 1;
      channel.boundary = Math.max(channel.boundary, channel.latest.acquiredAt);
      channel.latest = Object.freeze({ ...channel.latest,
        quality: channel.latest.quality === "valid" ? "stale" : channel.latest.quality });
      changed = true;
    }
    if (changed) notify();
  }

  function subscribe(listener) {
    // Each subscription owns its cleanup, including StrictMode's replay.
    const subscription = () => listener();
    listeners.add(subscription);
    if (timer === null) {
      refresh();
      timer = schedule(refresh, refreshIntervalMs);
      timer?.unref?.();
    }
    return () => {
      listeners.delete(subscription);
      if (listeners.size === 0 && timer !== null) {
        cancel(timer);
        timer = null;
      }
    };
  }

  rebuild();
  return Object.freeze({ publish, subscribe, refresh, invalidateHardware,
    getFreshnessLimit: field => freshnessByChannel[field] ?? freshnessLimitMs,
    getSnapshot: () => snapshot });
}
