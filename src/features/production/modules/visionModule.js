import { resolveConditionConfig } from "../config/conditionConfig.js";
import { createModuleResult } from "./moduleContract.js";

export function visionModule(laser = {}, options = {}) {
  const config = resolveConditionConfig(options);
  return createModuleResult({ id: "vision", nodeId: config.moduleNodes.vision, configVersion: config.version,
    reasons: ["Camera not integrated. Laser scan state available.",
      laser.quality === "valid" ? `Laser command state ${laser.value ? "ON" : "OFF"} (${laser.source}); no camera-derived surface score.` : "No fresh laser state observation."],
    features: { laserState: laser.quality === "valid" ? laser.value : null, laserSource: laser.source ?? "unavailable" },
  });
}
