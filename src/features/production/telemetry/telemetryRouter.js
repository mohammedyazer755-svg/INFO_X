/** Stable read facade: isolated scenario fixtures never enter the live bridge. */
export function createTelemetryRouter(live, demo) {
  let active = live, source = "live", unsubscribe = null;
  const listeners = new Set();
  const relay = () => listeners.forEach(listener => listener());
  function attach() { if (listeners.size && !unsubscribe) unsubscribe = active.subscribe(relay); }
  return Object.freeze({
    select(next) {
      if (!["live", "scenario"].includes(next) || next === source) return;
      unsubscribe?.(); unsubscribe = null;
      active.resetWindows({ clearReplay: active === demo });
      active = next === "scenario" ? demo : live; source = next;
      active.resetWindows({ clearReplay: active === demo });
      attach(); relay();
    },
    subscribe(listener) { listeners.add(listener); attach(); return () => { listeners.delete(listener); if (!listeners.size) { unsubscribe?.(); unsubscribe = null; } }; },
    getSnapshot: () => active.getSnapshot(), getRecordedHistory: field => active.getRecordedHistory(field),
    getCurrentTime: () => active.getCurrentTime(), getFreshnessLimit: field => active.getFreshnessLimit(field),
  });
}
