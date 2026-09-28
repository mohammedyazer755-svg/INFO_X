import React, { useState } from "react";
import { Wrench } from "lucide-react";

export default function MaintenanceRec({ condition }) {
  const [expanded, setExpanded] = useState(false);
  return <section className="prod-card" aria-label="Maintenance recommendations">
    <div className="prod-card-heading"><Wrench size={18} aria-hidden="true" /><h2>Maintenance recommendations</h2></div>
    <p className="prod-description">{condition.context === "demo" ? "Demo inspection suggestions" : "Hardware observation inspection suggestions"} · Locations follow the configured {condition.layout.type} layout.</p>
    <div className="prod-module-list">{(expanded ? condition.recommendations : condition.recommendations.slice(0, 1)).map(item => <article className="prod-module-card" key={item.id}>
      <div className="prod-module-heading"><span className={`prod-recommendation-priority prod-priority-${item.priority.toLowerCase()}`}>{item.priority}</span><span className="prod-description">{item.nodeId ?? item.location}</span></div>
      <p className="prod-recommendation-text">{item.text}</p>
      <details className="prod-recommendation-evidence"><summary>Contributing evidence</summary><ul className="prod-event-list">{item.evidence.map((reason, index) => <li key={index}>{reason}</li>)}</ul></details>
      {item.suggestedInspectionNode && <p className="prod-description">Suggested inspection point: {item.suggestedInspectionNode}</p>}
    </article>)}</div>
    {condition.recommendations.length > 1 && <div className="prod-actions"><button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "Show priority recommendation" : `View all recommendations (${condition.recommendations.length})`}</button></div>}
  </section>;
}
