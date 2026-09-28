import { createDroneMission, droneStateMachine, isMissionActive, missionTelemetry } from "./droneStateMachine.js";
import { NODE_REGISTRY } from "../config/nodes.js";

export function createDroneController({ registry = NODE_REGISTRY, config = {}, now = () => performance.now(),
  wallNow = Date.now, schedule = setTimeout, cancel = clearTimeout, getCondition = () => null } = {}) {
  let mission = createDroneMission(registry, config), visible = false, reducedMotion = false, connected = false;
  let timer = null, lastTick = null;
  let sharedClock = null, clockUnsubscribe = null;
  const listeners = new Set();
  let snapshot;
  function rebuild() { snapshot = { mission, telemetry: missionTelemetry(mission), visible, reducedMotion,
    visibilityPaused: isMissionActive(mission) && !visible }; }
  function notify() { rebuild(); listeners.forEach(listener => listener()); }
  function stopTimer() { if (timer !== null) cancel(timer); timer = null; lastTick = sharedClock?.getTime() ?? null; }
  function running() { return connected && visible && isMissionActive(mission) && !mission.paused; }
  function arm() {
    if (sharedClock) return;
    if (!running() || timer !== null) return;
    if (lastTick === null) lastTick = now();
    timer = schedule(() => {
      timer = null;
      if (!running()) { lastTick = null; return; }
      const time = now(), elapsed = Math.max(0, time - lastTick);
      lastTick = time;
      // A suspended browser clock never teleports the mission through hidden time.
      const deltaMs = Math.min(elapsed, reducedMotion ? 1500 : 250) * mission.config.timeScale;
      mission = droneStateMachine(mission, { type: "tick", deltaMs, capturedAt: wallNow(), condition: getCondition() });
      notify(); arm();
    }, reducedMotion ? 1000 : 100);
  }
  function attachClock() {
    clockUnsubscribe?.(); clockUnsubscribe = null;
    if (!connected || !sharedClock) return;
    lastTick = sharedClock.getTime();
    clockUnsubscribe = sharedClock.subscribe(() => {
      const time = sharedClock.getTime();
      const deltaMs = Math.max(0, time - (lastTick ?? time)); lastTick = time;
      mission = { ...mission, config: { ...mission.config, timeScale: sharedClock.getScale() } };
      if (running()) mission = droneStateMachine(mission, { type: "tick", deltaMs, capturedAt: time, condition: getCondition() });
      notify();
    });
  }
  function dispatch(type, extra = {}) { mission = droneStateMachine(mission, { type, ...extra }); stopTimer(); notify(); arm(); }
  rebuild();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    connect() { connected = true; attachClock(); arm(); return () => { connected = false; visible = false; clockUnsubscribe?.(); clockUnsubscribe = null; stopTimer(); notify(); }; },
    setClock(clock) {
      stopTimer(); clockUnsubscribe?.(); clockUnsubscribe = null; sharedClock = clock;
      mission = { ...mission, config: { ...mission.config, timeScale: clock ? clock.getScale() : createDroneMission(registry, config).config.timeScale } };
      attachClock(); notify(); arm();
    },
    setVisible(value) { if (visible === value) return; visible = value; stopTimer(); notify(); arm(); },
    setReducedMotion(value) { if (reducedMotion === value) return; reducedMotion = value; stopTimer(); notify(); arm(); },
    start: nodeId => dispatch("start", { nodeId }), pause: () => dispatch("pause"), resume: () => dispatch("resume"),
    returnToBase: () => dispatch("returnToBase"), reset: () => dispatch("reset"),
  };
}
