import React from "react";
import { Activity } from "lucide-react";
import ModuleCard from "./ModuleCard";

export default function ConditionDisplay({ condition, showCritical = true }) {
  const circumference = 2 * Math.PI * 44;
  return <section className="prod-card" aria-label="Condition assessment">
    <div className="prod-card-heading"><Activity size={18} aria-hidden="true" /><h2>NAVIX condition assessment</h2></div>
    <p className="prod-description">Prototype condition indicator · {condition.context === "demo" ? "DEMO / MANUAL CONTEXT" : "HARDWARE CONTEXT"}</p>
    <div className="prod-condition-summary">
      <svg className={`prod-health-circle prod-condition-${condition.tone}`} viewBox="0 0 120 120" role="img" aria-label={`Prototype condition index ${condition.score === null ? "unavailable" : `${condition.score} out of 100`}`}>
        <circle cx="60" cy="60" r="44" fill="none" stroke="var(--border-color)" strokeWidth="9" />
        {condition.score !== null && <circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" strokeWidth="9" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - condition.score / 100)} transform="rotate(-90 60 60)" />}
        <text x="60" y="62" textAnchor="middle" className={condition.score === null ? "prod-circle-unavailable" : "prod-circle-score"}>{condition.score ?? "Unavailable"}</text>
        {condition.score !== null && <text x="60" y="78" textAnchor="middle" className="prod-circle-unit">/ 100</text>}
      </svg>
      <div><p className={`prod-condition-level prod-condition-${condition.tone}`}>Condition: {condition.condition}</p>
        <p className="prod-description">Risk level: {condition.risk}</p>
        <p className="prod-description">{condition.coverage.text}</p>
        <p className="prod-description">{condition.reason}</p>
      </div>
    </div>
    {showCritical && condition.criticalIndicators.length > 0 && <div className="prod-critical-panel" role="status">
      <h3>Critical individual indicators</h3><ul className="prod-event-list">{condition.criticalIndicators.map((item, index) => <li key={`${item.moduleId}-${index}`}>{item.nodeId}: {item.reason}{item.score === null ? " Score collecting; current critical reading remains visible." : ""}</li>)}</ul>
    </div>}
    {condition.corroborations.length > 0 && <div className="prod-corroboration-panel">
      <h3>Multi-sensor corroboration</h3>
      {condition.corroborations.map(rule => <div key={rule.id}><p className="prod-description"><strong>{rule.label}</strong> · +{rule.appliedModifier} anomaly</p>
        <p className="prod-description">{rule.reason} {rule.suppressionReason}</p></div>)}
      <p className="prod-description">Total modifier: +{condition.totalModifier} (maximum 20).</p>
    </div>}
    <div className="prod-module-list">{condition.modules.map(module => <ModuleCard key={module.id} module={module} layout={condition.layout} excluded={condition.coverage.excluded.find(item => item.id === module.id)} />)}</div>
    {condition.supportingEvidence.length > 0 && <div className="prod-corroboration-panel">
      <h3>Splice-zone supporting evidence</h3>{condition.supportingEvidence.map(item => <p key={item.id} className="prod-description">{item.nodeId}: {item.reasons.join(" ")}</p>)}
      <p className="prod-description">Hall observations do not add a sixth weighted module.</p>
    </div>}
    <p className="prod-description">Configured {condition.layout.type} layout · {condition.layout.lengthKm} km. Location associations and scoring thresholds are prototype configuration.</p>
  </section>;
}
