import React, { useState } from "react";
import { Activity } from "lucide-react";
import { useProduction } from "./ProductionProvider";
import { MetricValue } from "./components/ThroughputStrip";
import InputPanel from "./components/InputPanel";
import ProductionImpact from "./components/ProductionImpact";
import SensorFeaturePanel from "./components/SensorFeaturePanel";
import ConditionDisplay from "./components/ConditionDisplay";
import MaintenanceRec from "./components/MaintenanceRec";
import ForecastPanel from "./components/ForecastPanel";
import DronePanel from "./components/DronePanel";
import ScenarioPanel from "./components/ScenarioPanel";
import ReportExport from "./components/ReportExport";
import "./production.css";

export default function ProductionView() {
  const state = useProduction();
  const { enabled, session, telemetry, production, features, temporal, condition, drone, scenario, now } = state;
  const [tab, setTab] = useState("Overview");
  const tabs = ["Overview", "Production", "Inspection", "Diagnostics"];
  if (!enabled) return null;

  return (
    <div className="prod-page">
      <header className="prod-page-header prod-card">
        <div>
          <p className="prod-eyebrow">NAVIX</p>
          <h1>Production &amp; Prediction</h1>
          <p className="prod-description">
            Conveyor condition, production analysis, and inspection overview.
          </p>
        </div>
        <div className="prod-header-tools">
          <span className="prod-status-badge">{session.status} / {session.source}</span>
          <span className="prod-status-badge">{scenario.source === "scenario" ? `${scenario.label} / ${scenario.timeScale}x` : "Live bridge"}</span>
          <ReportExport state={state} compact />
        </div>
      </header>
      <details className="prod-toolbar"><summary>Source &amp; demo controls</summary>
        <ScenarioPanel scenario={scenario} condition={condition} drone={drone} />
      </details>
      <dl className="prod-summary-ribbon" aria-label="Production summary">
        {[["Calculated throughput", production.flow], ["Accumulated tonnes", production.metrics.accumulated], ["Observed availability", production.metrics.availability]].map(([label, metric]) =>
          <div className="prod-kpi" key={label}><dt>{label}</dt><dd><MetricValue metric={metric} /></dd></div>)}
        <div className="prod-kpi"><dt>Condition / prototype indicator</dt><dd>{condition.score === null ? "Unavailable" : `${condition.score}/100 / ${condition.condition}`}
          <small className="prod-metric-source">{condition.context} / {condition.coverage.text}</small></dd></div>
      </dl>
      {condition.criticalIndicators.length > 0 && <div className="prod-critical-panel" role="status">
        <h3>Critical individual indicators</h3><ul>{condition.criticalIndicators.map((item, index) => <li key={index}>{item.nodeId}: {item.reason}</li>)}</ul>
      </div>}
      <div className="prod-tabs" role="tablist" aria-label="Production workspaces">
        {tabs.map((name, index) => <button key={name} id={`prod-tab-${name}`} role="tab" type="button"
          aria-selected={tab === name} aria-controls={`prod-panel-${name}`} tabIndex={tab === name ? 0 : -1}
          onClick={() => setTab(name)} onKeyDown={event => {
            const target = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
            if (target !== null) { event.preventDefault(); setTab(tabs[target]); document.getElementById(`prod-tab-${tabs[target]}`)?.focus(); }
          }}>{name}</button>)}
      </div>
      <div id={`prod-panel-${tab}`} role="tabpanel" aria-labelledby={`prod-tab-${tab}`} tabIndex={0} className="prod-workspace">
        {tab === "Overview" && <div className="prod-layout">
          <ConditionDisplay condition={condition} showCritical={false} />
          <div className="prod-analytics">
            <MaintenanceRec condition={condition} />
            <section className="prod-card prod-inspection-summary"><span className="prod-simulation-badge">SIMULATION</span>
              <h2>Inspection mission</h2><p>{drone.mission.phase} / {drone.mission.findings.length} completed inspections</p>
              <p className="prod-description">Linked sensor evidence from the configured {condition.layout.lengthKm} km demo route. Flight pauses outside the inspection viewport.</p>
              <div className="prod-actions"><button onClick={() => setTab("Inspection")}>Open inspection workspace</button></div>
            </section>
          </div>
        </div>}
        {tab === "Production" && <div className="prod-analytics">
          <details className="prod-toolbar"><summary>Edit production assumptions</summary><InputPanel production={production} scenarioActive={scenario.source === "scenario"} /></details>
          <ForecastPanel production={production} features={features} temporal={temporal} now={now} />
          <ProductionImpact production={production} />
        </div>}
        {tab === "Inspection" && <DronePanel drone={drone} condition={condition} scenario={scenario} />}
        {tab === "Diagnostics" && <div className="prod-analytics">
          <section className="prod-card" aria-label="Telemetry observations">
            <div className="prod-card-heading">
              <Activity size={18} aria-hidden="true" />
              <h2>Telemetry observations</h2>
            </div>
            <p className="prod-description">Each channel tracks its own source and freshness. Belt speed is demo data.</p>
            <div className="prod-telemetry-scroll">
              <table className="prod-telemetry-table">
                <caption className="prod-table-caption">Latest sensor observations</caption>
                <thead><tr><th scope="col">Channel</th><th scope="col">Reading</th><th scope="col">Source</th><th scope="col">Quality</th><th scope="col">Observed</th></tr></thead>
                <tbody>
                  {Object.entries(telemetry).map(([field, { latest }]) => (
                    <tr key={field}>
                      <th scope="row">{field}</th>
                      <td>{latest.value === null ? "Unavailable" : `${latest.value} ${latest.unit}`}</td>
                      <td>{latest.source}</td>
                      <td><span className={`prod-quality prod-quality-${latest.quality}`}>{latest.quality}</span></td>
                      <td>{latest.source === "unavailable" ? "Unavailable" : new Date(latest.acquiredAt).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <SensorFeaturePanel features={features} temporal={temporal} />
        </div>}
      </div>
    </div>
  );
}
