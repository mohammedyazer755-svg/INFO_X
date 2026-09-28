import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createThroughputController } from "./throughputController.js";

export function useThroughput(bridge, enabled) {
  const controller = useMemo(() => createThroughputController(bridge.store), [bridge]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    if (!enabled) { controller.suspend(); return; }
    return controller.connect();
  }, [controller, enabled]);
  return { ...state, updateInputs: controller.updateInputs, applyPreset: controller.applyPreset, resetSession: controller.resetSession };
}
