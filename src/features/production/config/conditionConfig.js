import { NODE_REGISTRY } from "./nodes.js";

export const CONVEYOR_LAYOUT = NODE_REGISTRY;

export const CONDITION_CONFIG = Object.freeze({
  version: "prototype-condition-v1",
  weights: Object.freeze({ mechanical: 0.30, thermal: 0.25, tracking: 0.20, vision: 0.15, energy: 0.10 }),
  moduleNodes: Object.freeze({ mechanical: "NODE 01", thermal: "NODE 01", tracking: "NODE 02", vision: "NODE 03", energy: "NODE 04" }),
  layout: CONVEYOR_LAYOUT,
  freshnessMs: 5000, alignmentToleranceMs: 5000, minOverlapMs: 1000, maxModifier: 20,
  scoring: Object.freeze({ risingPenalty: 8, persistenceMs: 30000, persistencePenalty: 7,
    elevatedDurationMs: 30000, elevatedDurationPenalty: 5, sustainedCriticalMs: 10000, sustainedCriticalPenalty: 5 }),
  tracking: Object.freeze({ watchEvents: 1, warningEvents: 3, highRiskEvents: 5,
    watchFrequency: 1, warningFrequency: 3, highRiskFrequency: 5, sustainedObstructionMs: 30000 }),
});

export function resolveConditionConfig(overrides = {}) {
  return { ...CONDITION_CONFIG, ...overrides,
    weights: { ...CONDITION_CONFIG.weights, ...overrides.weights },
    moduleNodes: { ...CONDITION_CONFIG.moduleNodes, ...overrides.moduleNodes },
    scoring: { ...CONDITION_CONFIG.scoring, ...overrides.scoring },
    tracking: { ...CONDITION_CONFIG.tracking, ...overrides.tracking },
  };
}
