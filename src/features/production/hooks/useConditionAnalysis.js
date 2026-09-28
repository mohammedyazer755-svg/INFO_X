import { useMemo } from "react";
import { mechanicalModule } from "../modules/mechanicalModule.js";
import { thermalModule } from "../modules/thermalModule.js";
import { trackingModule } from "../modules/trackingModule.js";
import { visionModule } from "../modules/visionModule.js";
import { energyModule } from "../modules/energyModule.js";
import { conditionEngine, hallSupportingEvidence } from "../modules/conditionEngine.js";
import { generateRecommendations } from "../modules/recommendations.js";

export function useConditionAnalysis(features, temporal, telemetry, context, store) {
  return useMemo(() => {
    const modules = [mechanicalModule(features.piezoVal, temporal.piezoVal), thermalModule(features.tempC, temporal.tempC),
      trackingModule(features.tracking), visionModule(telemetry.laserState.latest), energyModule()];
    const condition = conditionEngine(modules, { context, now: store.getCurrentTime(), supportingEvidence: [hallSupportingEvidence(features.hall)] });
    return { ...condition, recommendations: generateRecommendations(condition) };
  }, [features, temporal, telemetry, context, store]);
}
