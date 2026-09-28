const PRIORITIES = { URGENT: 0, HIGH: 1, MODERATE: 2, LOW: 3 };

export function generateRecommendations(condition) {
  const recommendations = new Map();
  const modules = new Map(condition.modules.map(module => [module.id, module]));
  function add({ id, nodeId, priority, action, evidence, moduleIds = [] }) {
    const node = condition.layout.nodes[nodeId];
    const location = node?.label ?? "Unmapped location";
    recommendations.set(id, { id, nodeId, priority, location,
      text: `${action} at ${location} (${nodeId ?? "node unavailable"}).`,
      evidence, contributingModules: moduleIds, context: condition.context, layoutType: condition.layout.type,
      suggestedInspectionNode: node ? nodeId : null });
  }
  for (const indicator of condition.criticalIndicators) {
    add({ id: `critical-${indicator.moduleId}`, nodeId: indicator.nodeId, priority: "URGENT",
      action: indicator.moduleId === "tracking" ? "Inspect both beam paths and belt edges" : indicator.moduleId === "thermal" ? "Inspect motor surface temperature, cooling and lubrication" : "Inspect motor bearings, mounting and lubrication",
      evidence: [indicator.reason, "Critical individual indicator remains visible independently of the aggregate score."], moduleIds: [indicator.moduleId] });
  }
  for (const rule of condition.corroborations) {
    const target = rule.id === "alignmentStress" ? modules.get("tracking") : modules.get("mechanical");
    const contributing = rule.moduleIds.map(id => modules.get(id)).filter(Boolean);
    add({ id: `corroboration-${rule.id}`, nodeId: target?.nodeId,
      priority: contributing.some(module => module.score < 40) ? "URGENT" : "HIGH",
      action: rule.id === "alignmentStress" ? "Inspect belt tracking and idler alignment" : "Inspect motor bearings and lubrication",
      evidence: [rule.reason, ...contributing.flatMap(module => module.reasons), ...(rule.suppressionReason ? [rule.suppressionReason] : [])], moduleIds: rule.moduleIds });
  }
  for (const module of condition.eligibleModules) {
    if (module.score >= 80 || condition.criticalIndicators.some(indicator => indicator.moduleId === module.id) ||
      condition.corroborations.some(rule => rule.moduleIds.includes(module.id))) continue;
    const action = { mechanical: "Inspect motor bearings, mounting and gearbox", thermal: "Inspect motor cooling, surface temperature and lubrication", tracking: "Inspect beam paths, belt edges and idler alignment", vision: "Inspect the configured surface zone", energy: "Inspect electrical load instrumentation" }[module.id];
    add({ id: `module-${module.id}`, nodeId: module.nodeId, priority: module.score < 40 ? "URGENT" : module.score < 60 ? "HIGH" : "MODERATE",
      action, evidence: module.reasons, moduleIds: [module.id] });
  }
  for (const item of condition.supportingEvidence.filter(item => item.active)) {
    add({ id: `support-${item.id}`, nodeId: item.nodeId, priority: "MODERATE", action: "Inspect splice-zone sensor mounting and belt splice",
      evidence: [...item.reasons, "Supporting evidence only; structural damage is not confirmed."], moduleIds: [] });
  }
  if (condition.coverage.included < condition.coverage.total) {
    recommendations.set("coverage", { id: "coverage", priority: "MODERATE", nodeId: null, location: "Coverage review",
      text: "Review missing, collecting or excluded channels before assessing overall conveyor condition.",
      evidence: [condition.coverage.text, ...condition.coverage.excluded.map(item => `${item.label}: ${item.reason}`)], contributingModules: [],
      context: condition.context, layoutType: condition.layout.type, suggestedInspectionNode: null });
  } else if (!recommendations.size) {
    recommendations.set("monitor", { id: "monitor", priority: "LOW", nodeId: null, location: "Conveyor overview",
      text: "Continue monitoring the available condition indicators.", evidence: [condition.coverage.text], contributingModules: [],
      context: condition.context, layoutType: condition.layout.type, suggestedInspectionNode: null });
  }
  return [...recommendations.values()].sort((a, b) => PRIORITIES[a.priority] - PRIORITIES[b.priority] || a.id.localeCompare(b.id));
}
