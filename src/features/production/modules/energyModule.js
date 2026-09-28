import { resolveConditionConfig } from "../config/conditionConfig.js";
import { createModuleResult } from "./moduleContract.js";

export function energyModule(options = {}) {
  const config = resolveConditionConfig(options);
  return createModuleResult({ id: "energy", nodeId: config.moduleNodes.energy, configVersion: config.version,
    reasons: ["Current and voltage sensors not integrated."] });
}
