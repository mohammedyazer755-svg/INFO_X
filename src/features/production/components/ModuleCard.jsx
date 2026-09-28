import React from "react";
import { conditionBand } from "../modules/moduleContract.js";

export default function ModuleCard({ module, excluded, layout }) {
  const band = conditionBand(module.score);
  return <details className="prod-module-card prod-module-row" aria-label={`${module.label} condition module`}>
    <summary><strong>{module.label}</strong><span className={`prod-condition-${band.tone}`}>{module.score === null ? module.status : `${module.score} / ${band.condition}`}</span><span className="prod-description">{module.features.trendDirection ?? "Trend unavailable"}</span><span className="prod-status-badge">{module.source}</span></summary>
    <p className="prod-description">Prototype condition indicator · {module.nodeId} · {layout.nodes[module.nodeId]?.label ?? "Location unavailable"}</p>
    {module.score === null ? <p className="prod-placeholder">{module.status === "collecting" ? "Collecting data" : "Unavailable"}</p> : <>
      <div className="prod-module-heading"><span className={`prod-condition-${band.tone}`}>Condition: {band.condition}</span><strong>{module.score}/100</strong></div>
      <progress className={`prod-module-progress prod-condition-${band.tone}`} value={module.score} max={100} aria-label={`${module.label} condition score`} />
    </>}
    <p className="prod-description">Trend direction: {module.features.trendDirection ?? "Unavailable"} · Observation samples: {module.observationWindow.sampleCount}</p>
    {excluded && <p className="prod-description">Excluded from aggregate: {excluded.reason}</p>}
    <ul className="prod-event-list">{module.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
  </details>;
}
