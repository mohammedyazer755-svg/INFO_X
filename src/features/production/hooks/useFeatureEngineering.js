import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createFeatureEngineeringController } from "./featureEngineeringController.js";

export function useFeatureEngineering(telemetryStore, enabled = true) {
  const controller = useMemo(() => createFeatureEngineeringController(telemetryStore), [telemetryStore]);
  const features = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    if (!enabled) { controller.pause(); return; }
    return controller.connect();
  }, [controller, enabled]);
  return features;
}
