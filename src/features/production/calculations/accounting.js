import { isNonnegative, unavailable } from "./throughput.js";

export const TIME_STATES = ["scheduledRunning", "confirmedUnplannedStop", "plannedIdle", "unknown"];
export const INTEGRATION_POLICY = "Left-hold flow between valid samples; split at known state/rate transitions. Reject whole intervals across gaps, unknown data or source changes.";

export function createAccountingSession(context) {
  return {
    context, previous: null, startedAt: null, lastAt: null, seenIds: [], transitions: [],
    timeMs: Object.fromEntries(TIME_STATES.map(state => [state, 0])),
    accumulatedTonnes: 0, lostTonnes: 0, lossUnknownMs: 0, validMs: 0,
    status: "Awaiting observations", provenance: [],
  };
}

export function classifyTimeState({ scheduled = true, confirmedState = "auto", speed, quality }) {
  if (!scheduled || confirmedState === "plannedIdle") return "plannedIdle";
  if (quality !== "valid") return "unknown";
  if (confirmedState === "confirmedUnplannedStop") return "confirmedUnplannedStop";
  if (confirmedState === "scheduledRunning") return "scheduledRunning";
  if (confirmedState === "unknown") return "unknown";
  // A positive valid speed supports motion. Binary proximity and zero speed do
  // not confirm physical downtime; zero in the legacy stream is demo only.
  return isNonnegative(speed) && speed > 0 ? "scheduledRunning" : "unknown";
}

export function addStateTransition(session, transition) {
  if (!Number.isFinite(transition.at) || !TIME_STATES.includes(transition.state)) return session;
  if (session.lastAt !== null && transition.at < session.lastAt) return session;
  return { ...session, transitions: [...session.transitions, { ...transition }].sort((a, b) => a.at - b.at) };
}

export function suspendAccounting(session, reason = "Accounting suspended") {
  return { ...session, previous: session.previous ? { ...session.previous, quality: "stale" } : null, status: reason };
}

export function pauseAccounting(session) {
  return { ...session, previous: null, transitions: [], status: "Paused / inactive context" };
}

export function accumulateSample(session, sample, { maxGapMs = 5000 } = {}) {
  if (!isNonnegative(maxGapMs) || maxGapMs === 0) throw new TypeError("maxGapMs must be positive");
  if (sample.context !== session.context || !Number.isFinite(sample.at) || !sample.sampleId ||
    session.seenIds.includes(sample.sampleId) || (session.lastAt !== null && sample.at <= session.lastAt)) return session;

  const next = { ...session, previous: { ...sample }, startedAt: session.startedAt ?? sample.at,
    lastAt: sample.at, seenIds: [...session.seenIds, sample.sampleId].slice(-512),
    timeMs: { ...session.timeMs }, transitions: session.transitions.filter(item => item.at > sample.at),
    provenance: [...new Set([...session.provenance, ...(sample.provenance ?? [sample.source])])],
    status: sample.quality === "valid" ? "Collecting observations" : "Suspended: unavailable flow" };
  const previous = session.previous;
  if (!previous) return next;
  const elapsed = sample.at - previous.at;
  const usable = previous.quality === "valid" && sample.quality === "valid" &&
    isNonnegative(previous.tph) && isNonnegative(sample.tph) &&
    previous.identity === sample.identity && elapsed <= maxGapMs;
  if (!usable) {
    next.timeMs.unknown += elapsed;
    next.status = "Suspended interval: gap, invalid data or changed source";
    return next;
  }

  let start = previous.at;
  let state = previous.state;
  let expected = previous.expectedThroughput;
  const boundaries = session.transitions.filter(item => item.at >= start && item.at <= sample.at);
  boundaries.push({ at: sample.at, state: sample.state, expectedThroughput: sample.expectedThroughput });
  for (const boundary of boundaries) {
    const duration = boundary.at - start;
    const validState = TIME_STATES.includes(state) ? state : "unknown";
    next.timeMs[validState] += duration;
    if (validState !== "unknown") next.validMs += duration;
    if (validState === "scheduledRunning") next.accumulatedTonnes += previous.tph * duration / 3600000;
    if (validState === "confirmedUnplannedStop") {
      if (isNonnegative(expected)) next.lostTonnes += expected * duration / 3600000;
      else next.lossUnknownMs += duration;
    }
    start = boundary.at;
    state = boundary.state;
    expected = boundary.expectedThroughput;
  }
  next.status = sample.state === "unknown" ? "Suspended: operating state unknown" : "Accounting active";
  return next;
}

export function calcAvailability(session) {
  const denominator = session.timeMs.scheduledRunning + session.timeMs.confirmedUnplannedStop;
  return denominator > 0 ? session.timeMs.scheduledRunning / denominator * 100
    : unavailable("No observed scheduled running or confirmed downtime yet.");
}

export function projectShiftTonnes(accumulated, remainingHours, assumedRate, assumedUptime) {
  if (![accumulated, remainingHours, assumedRate, assumedUptime].every(isNonnegative) || assumedUptime > 1) {
    return unavailable("Projection requires valid totals, remaining hours, expected rate and uptime between 0 and 1.");
  }
  const value = accumulated + remainingHours * assumedRate * assumedUptime;
  return Number.isFinite(value) ? value : unavailable("Projection exceeds the supported range.");
}
