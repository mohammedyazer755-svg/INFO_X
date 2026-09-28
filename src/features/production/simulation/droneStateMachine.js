import { DRONE_CONFIG, NODE_REGISTRY, getWaypoints } from "../config/nodes.js";
import { contextMatches } from "../modules/moduleContract.js";

export const DRONE_STATES = ["idle", "takingOff", "travelling", "inspecting", "returning", "complete"];
const NEXT = { idle: ["takingOff"], takingOff: ["travelling", "returning"], travelling: ["inspecting", "returning"],
  inspecting: ["travelling", "returning"], returning: ["complete"], complete: [] };
export const isMissionActive = state => !["idle", "complete"].includes(state.phase);

export function createDroneMission(registry = NODE_REGISTRY, options = {}) {
  const config = { ...DRONE_CONFIG, ...options };
  if (![config.timeScale, config.speedMps, config.takeoffMs, config.inspectMs, config.landingMs].every(v => Number.isFinite(v) && v > 0) ||
    !Number.isFinite(config.batteryDrainPerSecond) || config.batteryDrainPerSecond < 0) throw new TypeError("Invalid drone simulation timing.");
  getWaypoints(registry);
  return { phase: "idle", paused: false, config, registry, route: [], waypointIndex: 0, positionM: registry.baseKm * 1000,
    elapsedMissionMs: 0, phaseElapsedMs: 0, distanceM: 0, batteryPct: 100, findings: [], pendingFinding: null };
}

function transition(state, phase) {
  return NEXT[state.phase]?.includes(phase) ? { ...state, phase, phaseElapsedMs: 0 } : state;
}

export function snapshotLinkedEvidence(waypoint, condition, capturedAt, missionElapsedMs) {
  const context = condition?.context ?? "unavailable";
  const copyEvidence = item => {
    const contextual = item.source === "unavailable" || contextMatches(item.source, context, item.features?.sources ?? [item.source]);
    const fresh = item.quality === "valid" && Number.isFinite(item.observationWindow?.end) &&
      capturedAt >= item.observationWindow.end && capturedAt - item.observationWindow.end <= 5000;
    return { id: item.id, label: item.label, source: item.source, quality: item.quality === "valid" ? fresh ? "valid" : "stale" : item.quality ?? "missing",
      status: contextual && fresh ? item.status ?? "supporting" : "unavailable", score: contextual && fresh ? item.score ?? null : null,
      reasons: contextual && fresh ? [...item.reasons] : [!contextual ? "Linked sensor evidence excluded from selected source context."
        : "Linked sensor evidence unavailable or stale at snapshot.", ...(contextual ? item.reasons : [])],
      observationWindow: { ...item.observationWindow }, features: structuredClone(item.features ?? {}) };
  };
  const modules = (condition?.modules ?? []).filter(item => item.nodeId === waypoint.id && waypoint.moduleIds?.includes(item.id)).map(copyEvidence);
  const supporting = (condition?.supportingEvidence ?? []).filter(item => item.nodeId === waypoint.id && waypoint.supportingIds?.includes(item.id)).map(copyEvidence);
  return { id: `simulation-${waypoint.id}-${missionElapsedMs}`, tag: "SIMULATION", nodeId: waypoint.id, location: waypoint.label,
    capturedAt, missionElapsedMs, context, modules, supporting,
    description: "Linked sensor evidence snapshot; the simulated drone does not measure temperature or vibration." };
}

/** Pure deterministic reducer. deltaMs is simulated time, never wall-clock catch-up. */
export function droneStateMachine(state, action) {
  if (action.type === "reset") return createDroneMission(state.registry, state.config);
  if (action.type === "start") {
    if (state.phase !== "idle") return state;
    let route;
    try { route = getWaypoints(state.registry, action.nodeId ?? null); } catch { return state; }
    return transition({ ...state, route }, "takingOff");
  }
  if (action.type === "pause") return isMissionActive(state) && !state.paused ? { ...state, paused: true } : state;
  if (action.type === "resume") return isMissionActive(state) && state.paused ? { ...state, paused: false } : state;
  if (action.type === "returnToBase") return ["takingOff", "travelling", "inspecting"].includes(state.phase)
    ? transition({ ...state, paused: false, pendingFinding: null,
      returnDistanceM: state.distanceM + Math.abs(state.positionM - state.registry.baseKm * 1000) }, "returning") : state;
  if (action.type !== "tick" || !isMissionActive(state) || state.paused || !Number.isFinite(action.deltaMs) || action.deltaMs <= 0) return state;
  let next = { ...state }, remaining = action.deltaMs;
  // Boundaries are split exactly, so position, elapsed time and battery agree at any tick size.
  while (remaining > 0 && isMissionActive(next)) {
    const waypoint = next.route[next.waypointIndex];
    const movement = next.phase === "travelling" || (next.phase === "returning" && next.positionM !== next.registry.baseKm * 1000);
    const target = next.phase === "travelling" ? waypoint.positionM : next.registry.baseKm * 1000;
    const duration = movement ? Math.abs(target - next.positionM) / next.config.speedMps * 1000
      : (next.phase === "takingOff" ? next.config.takeoffMs : next.phase === "inspecting" ? next.config.inspectMs : next.config.landingMs) - next.phaseElapsedMs;
    const used = Math.min(remaining, Math.max(0, duration));
    next.elapsedMissionMs += used;
    next.batteryPct = Math.max(0, 100 - next.elapsedMissionMs / 1000 * next.config.batteryDrainPerSecond);
    remaining -= used;
    if (movement) {
      const distance = next.config.speedMps * used / 1000;
      next.positionM += Math.sign(target - next.positionM) * distance;
      next.distanceM += distance;
    } else next.phaseElapsedMs += used;
    if (used < duration) break;
    if (next.phase === "takingOff") next = transition(next, "travelling");
    else if (next.phase === "travelling") {
      next.positionM = target;
      next = transition(next, "inspecting");
      next.pendingFinding = snapshotLinkedEvidence(waypoint, action.condition, action.capturedAt, next.elapsedMissionMs);
    } else if (next.phase === "inspecting") {
      next.findings = [...next.findings, { ...next.pendingFinding, inspectionDurationMs: next.config.inspectMs }];
      next.pendingFinding = null;
      next.waypointIndex++;
      next = transition(next, next.waypointIndex < next.route.length ? "travelling" : "returning");
    } else if (movement) {
      next.positionM = target;
      next.phaseElapsedMs = 0; // Landing starts after the return flight.
    } else next = transition(next, "complete");
  }
  return next;
}

export function missionTelemetry(state) {
  const routeDistance = state.returnDistanceM ?? (state.route.reduce((sum, point, index) => sum + Math.abs(point.positionM - (index ? state.route[index - 1].positionM : state.registry.baseKm * 1000)), 0) +
    (state.route.length ? Math.abs(state.route.at(-1).positionM - state.registry.baseKm * 1000) : 0));
  const moving = !state.paused && (state.phase === "travelling" || (state.phase === "returning" && state.positionM !== state.registry.baseKm * 1000));
  return { speedMps: moving ? state.config.speedMps : 0, progress: state.phase === "complete" ? 1 : routeDistance ? Math.min(1, state.distanceM / routeDistance) : 0,
    positionKm: state.positionM / 1000, elapsedSeconds: state.elapsedMissionMs / 1000, batteryPct: state.batteryPct };
}
