import { resolveConditionConfig } from "../config/conditionConfig.js";
import { isStale } from "../calculations/temporal.js";
import { conditionBand, contextMatches, MODULE_LABELS } from "./moduleContract.js";

const listNames = names => names.length < 2 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export function freshInContext(module, context, config, now) {
  const window = module.observationWindow;
  return module.quality === "valid" && contextMatches(module.source, context, module.features?.sources ?? [module.source]) &&
    window && Number.isFinite(window.start) && Number.isFinite(window.end) && window.end >= window.start &&
    window.sampleCount > 0 && !isStale(window.end, config.freshnessMs, now);
}

function compatible(first, second, ruleId, config) {
  if (!config.layout.nodes[first.nodeId] || !config.layout.nodes[second.nodeId]) return false;
  const location = first.nodeId === second.nodeId || config.layout.links?.some(link =>
    link.ruleId === ruleId && link.nodes.includes(first.nodeId) && link.nodes.includes(second.nodeId));
  const a = first.observationWindow, b = second.observationWindow;
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  return location && Math.abs(a.end - b.end) <= config.alignmentToleranceMs && overlap >= config.minOverlapMs;
}

export function conditionEngine(modules, { context = "hardware", now = Date.now(), config: overrides = {}, supportingEvidence = [] } = {}) {
  const config = resolveConditionConfig(overrides);
  // Canonical IDs prevent duplicated cards or inputs from multiplying weights.
  const byId = new Map();
  for (const module of modules) {
    if (!MODULE_LABELS[module.id]) continue;
    const previous = byId.get(module.id);
    if (!previous || (module.observationWindow?.end ?? -Infinity) >= (previous.observationWindow?.end ?? -Infinity)) byId.set(module.id, module);
  }
  const ids = Object.keys(MODULE_LABELS);
  const configurationValid = ids.every(id => Number.isFinite(config.weights[id]) && config.weights[id] >= 0) &&
    Number.isFinite(ids.reduce((sum, id) => sum + config.weights[id], 0)) &&
    [config.freshnessMs, config.alignmentToleranceMs, config.minOverlapMs, config.maxModifier].every(value => Number.isFinite(value) && value >= 0);
  const eligible = configurationValid ? ids.map(id => byId.get(id)).filter(module => module &&
    ["active", "demo"].includes(module.status) && Number.isFinite(module.score) && module.score >= 0 && module.score <= 100 &&
    config.weights[module.id] > 0 && freshInContext(module, context, config, now)) : [];
  const eligibleIds = new Set(eligible.map(module => module.id));
  const excluded = ids.filter(id => !eligibleIds.has(id)).map(id => ({ id, label: MODULE_LABELS[id],
    reason: !configurationValid ? "Invalid condition configuration." : !byId.has(id) ? "Module missing."
      : !contextMatches(byId.get(id).source, context, byId.get(id).features?.sources ?? [byId.get(id).source]) ? `Source excluded from ${context} context.`
        : byId.get(id).quality !== "valid" ? "No fresh valid observation."
          : !["active", "demo"].includes(byId.get(id).status) ? `${byId.get(id).status}: ${byId.get(id).reasons.join(" ")}`
            : config.weights[id] === 0 ? "Configured weight is zero." : "Freshness or observation window requirement not met." }));
  const coverage = { included: eligible.length, total: ids.length, excluded,
    text: `Based on ${eligible.length}/${ids.length} modules.${excluded.length ? ` ${listNames(excluded.map(item => item.label))} excluded.` : ""}` };
  const criticalIndicators = ids.map(id => byId.get(id)).filter(module => module && freshInContext(module, context, config, now))
    .flatMap(module => (module.features?.criticalIndicators ?? []).map(reason => ({ moduleId: module.id, nodeId: module.nodeId,
      source: module.source, reason, score: module.score, status: module.status })));
  const evidence = supportingEvidence.filter(item => freshInContext(item, context, config, now));
  const base = { context, configVersion: config.version, configuration: config, coverage, eligibleModules: eligible, modules: ids.map(id => byId.get(id)).filter(Boolean),
    criticalIndicators, supportingEvidence: evidence, layout: config.layout, corroborations: [], totalModifier: 0,
    score: null, anomaly: null, ...conditionBand(null), status: "unavailable", source: context === "demo" ? "demo" : "derived",
    trendDirections: Object.fromEntries(eligible.map(module => [module.id, module.features?.trendDirection ?? null])) };
  if (!eligible.length) return { ...base, reason: configurationValid ? "No eligible fresh modules in this context; condition score unavailable." : "Invalid condition configuration; condition score unavailable." };

  const active = Object.fromEntries(eligible.map(module => [module.id, module]));
  const detected = [];
  if (active.mechanical?.features.trendDirection === "rising" && active.thermal?.features.trendDirection === "rising" && compatible(active.mechanical, active.thermal, "mechanicalStress", config)) {
    detected.push({ id: "mechanicalStress", label: "Corroborated mechanical stress indicator", moduleIds: ["mechanical", "thermal"],
      nodeIds: [active.mechanical.nodeId, active.thermal.nodeId], requestedModifier: 15,
      reason: "Time-aligned rising vibration and temperature at compatible locations support inspection; cause unconfirmed." });
  }
  if ((active.tracking?.features.eventCount ?? 0) > 0 && active.mechanical?.features.trendDirection === "rising" && compatible(active.tracking, active.mechanical, "alignmentStress", config)) {
    detected.push({ id: "alignmentStress", label: "Corroborated alignment stress indicator", moduleIds: ["tracking", "mechanical"],
      nodeIds: [active.tracking.nodeId, active.mechanical.nodeId], requestedModifier: 10,
      reason: "Time-aligned tracking events and rising vibration at explicitly linked locations support inspection; cause unconfirmed." });
  }
  const used = new Set();
  let totalModifier = 0;
  const cap = Math.min(20, Math.max(0, config.maxModifier));
  const corroborations = detected.sort((a, b) => b.requestedModifier - a.requestedModifier).map(rule => {
    const overlaps = rule.moduleIds.some(id => used.has(id));
    const appliedModifier = overlaps ? 0 : Math.min(rule.requestedModifier, cap - totalModifier);
    if (appliedModifier > 0) rule.moduleIds.forEach(id => used.add(id));
    totalModifier += appliedModifier;
    return { ...rule, appliedModifier, suppressionReason: overlaps ? "Shared evidence already counted by a stronger rule." : appliedModifier < rule.requestedModifier ? "Total modifier capped." : null };
  });
  const totalWeight = eligible.reduce((sum, module) => sum + config.weights[module.id], 0);
  const baseAnomaly = eligible.reduce((sum, module) => sum + (config.weights[module.id] / totalWeight) * (100 - module.score), 0);
  const anomaly = Math.min(100, baseAnomaly + totalModifier);
  const score = Math.round((100 - anomaly) * 100) / 100;
  return { ...base, status: context === "demo" ? "demo" : "active", score, anomaly, ...conditionBand(score), corroborations, totalModifier,
    reason: "Weighted prototype condition index; coverage and individual critical indicators must be reviewed." };
}

export function hallSupportingEvidence(hall, configOverrides = {}) {
  const config = resolveConditionConfig(configOverrides);
  return { id: "hall", label: "Hall supporting evidence", source: hall.source, quality: hall.quality,
    nodeId: config.moduleNodes.vision, configVersion: config.version,
    observationWindow: { start: hall.windowStartedAt, end: hall.observedAt, sampleCount: hall.sampleCount },
    active: hall.quality === "valid" && (hall.current === "blocked" || hall.recurrent),
    reasons: ["Supporting evidence for splice zone; binary events do not measure integrity percentage.",
      `Hall anomaly ${hall.current === "blocked" ? "active" : hall.current === "clear" ? "inactive" : "unknown"}; ${hall.eventCount} observed transitions.`],
    features: { eventCount: hall.eventCount, durationMs: hall.currentEvent?.durationMs ?? null, incomplete: hall.currentEvent?.incomplete ?? false } };
}
