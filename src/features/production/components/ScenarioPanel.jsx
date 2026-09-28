import React from "react";
import { SCENARIOS } from "../simulation/scenarioEngine.js";

export default function ScenarioPanel({ scenario, condition, drone }) {
  const simulated = scenario.source === "scenario";
  const warning = condition.criticalIndicators.length > 0 || condition.eligibleModules.some(module => module.score < 80);
  const corroborated = condition.corroborations.length > 0;
  const recommendation = condition.recommendations.find(item => item.suggestedInspectionNode);
  return <section className="prod-card" aria-label="Deterministic demo scenarios">
    <div className="prod-card-heading"><h2>Deterministic demo scenarios</h2><span className="prod-simulation-badge">DEMO</span></div>
    <div className="prod-input-grid">
      <label className="prod-field"><span>Extension observation source</span><select value={scenario.source} onChange={event => scenario.selectSource(event.target.value)}>
        <option value="live">Live bridge (hardware / manual / legacy demo)</option><option value="scenario">Isolated scenario demo</option></select></label>
      <label className="prod-field"><span>Scenario</span><select value={scenario.name} disabled={scenario.running} onChange={event => scenario.configure({ name: event.target.value })}>
        {Object.entries(SCENARIOS).map(([id, definition]) => <option key={id} value={id}>{definition.label}</option>)}</select></label>
      <label className="prod-field"><span>Shared scenario time scale</span><select value={scenario.timeScale} disabled={scenario.running} onChange={event => scenario.configure({ timeScale: Number(event.target.value) })}>
        {[1, 5, 10, 30, 60].map(scale => <option key={scale} value={scale}>{scale}×</option>)}</select></label>
      <label className="prod-field"><span>Fixture seed</span><input type="number" step="1" value={scenario.seed} disabled={scenario.running}
        onChange={event => scenario.configure({ seed: Number(event.target.value) })} /></label>
    </div>
    <p className="prod-description" role="status">{simulated ? `${scenario.label} · DEMO · ${scenario.running ? "Running" : "Paused / ready"} · ${(scenario.elapsedMs / 1000).toFixed(1)} simulation seconds · ${scenario.timeScale}×` : "Live bridge selected; scenarios are inactive."}</p>
    <p className="prod-description">{scenario.description}</p>
    <div className="prod-actions">
      <button type="button" disabled={scenario.running} onClick={scenario.start}>{simulated && scenario.elapsedMs > 0 ? "Resume scenario" : "Start scenario"}</button>
      <button type="button" disabled={!scenario.running} onClick={scenario.pause}>Pause scenario</button>
      <button type="button" disabled={!simulated} onClick={scenario.reset}>Reset scenario</button>
      <button type="button" disabled={!simulated} onClick={() => scenario.selectSource("live")}>Return to hardware / live bridge</button>
    </div>
    <p className="prod-description">1 playback second = {scenario.timeScale} simulation seconds. Rates, freshness, trends, persistence, forecasts, accounting and visible drone flight share simulation time. Scenario pause freezes that clock; hiding the drone pauses its animation while scenario collection continues.</p>
    <p className="prod-description">Start/reset establishes a fresh demo session and restores illustrative production inputs. Returning to the live bridge clears incompatible analysis windows and selects hardware accounting; hardware totals remain separate. The current legacy speed is still demo and cannot qualify for hardware throughput.</p>
    {simulated && <ol className="prod-scenario-chain" aria-label="Demo evidence pathway">
      <li>Warning: {warning ? "Available" : "Collecting / no threshold reached"}</li>
      <li>Corroborating evidence: {corroborated ? "Available" : "Awaiting compatible trends"}</li>
      <li>Recommendation: {recommendation ? recommendation.text : "Awaiting node-specific evidence"}</li>
      <li>Suggested drone waypoint: {recommendation?.suggestedInspectionNode ?? "Unavailable"} · explicit drone dispatch required</li>
      <li>Simulated inspection: {drone.mission.findings.length ? `${drone.mission.findings.length} linked-evidence snapshots` : "Use the drone panel to start an inspection"}</li>
    </ol>}
  </section>;
}
