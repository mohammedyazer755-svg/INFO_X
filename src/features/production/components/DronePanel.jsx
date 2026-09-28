import React, { useMemo, useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import { useDroneViewport } from "../hooks/useDroneSimulation.js";
import DroneViewport from "../simulation/DroneViewport";
import { isMissionActive } from "../simulation/droneStateMachine.js";

const PHASES = { idle: "Idle", takingOff: "Taking off", travelling: "Travelling", inspecting: "Inspecting", returning: "Returning to base", complete: "Complete" };
const COLORS = { normal: "#2ca77b", watch: "#5c9de6", warning: "#e3aa36", highRisk: "#e46a40", critical: "#e74454", unavailable: "#8b96a5" };

export function waypointMarkers(registry, condition) {
  return Object.entries(registry.nodes).map(([id, node]) => {
    const modules = condition.eligibleModules.filter(module => module.nodeId === id);
    const score = modules.length ? Math.min(...modules.map(module => module.score)) : null;
    const critical = condition.criticalIndicators.some(item => item.nodeId === id);
    const tone = critical || score !== null && score < 20 ? "critical" : score === null ? "unavailable"
      : score < 40 ? "highRisk" : score < 60 ? "warning" : score < 80 ? "watch" : "normal";
    return { ...node, id, tone, color: COLORS[tone] };
  });
}

export default function DronePanel({ drone, condition, scenario = null }) {
  const viewport = useRef(null);
  useDroneViewport(viewport, drone.setViewportVisible);
  const [cameraMode, setCameraMode] = useState("overview");
  const [expanded, setExpanded] = useState(false);
  const [selectedNode, setSelectedNode] = useState("");
  const { mission, telemetry } = drone;
  const active = isMissionActive(mission);
  const markers = useMemo(() => waypointMarkers(mission.registry, condition), [mission.registry, condition]);
  const suggestion = condition.recommendations.find(item => item.suggestedInspectionNode && mission.registry.nodes[item.suggestedInspectionNode]);
  const paused = mission.paused || drone.visibilityPaused;
  return <section className={`prod-card prod-drone-card ${expanded ? "prod-drone-expanded" : ""}`} aria-label="Drone inspection simulation">
    <div className="prod-card-heading prod-drone-heading"><ScanLine size={18} aria-hidden="true" /><h2>Drone inspection</h2>
      <span className="prod-simulation-badge">SIMULATION</span></div>
    <span className="prod-status-badge" role="status">{PHASES[mission.phase]}{mission.paused ? " · Paused" : drone.visibilityPaused ? " · Viewport hidden" : ""}</span>
    <dl className="prod-drone-telemetry">
      <div><dt>Position</dt><dd>{telemetry.positionKm.toFixed(2)} km</dd></div>
      <div><dt>Speed</dt><dd>{paused ? 0 : telemetry.speedMps} m/s</dd></div>
      <div><dt>Mission time</dt><dd>{telemetry.elapsedSeconds.toFixed(1)} s</dd></div>
      <div><dt>Battery model</dt><dd>{telemetry.batteryPct.toFixed(1)}%</dd></div>
    </dl>
    <div className="prod-actions prod-camera-controls" aria-label="Simulation camera">
      {["overview", "follow", "waypoint"].map(mode => <button key={mode} aria-pressed={cameraMode === mode} onClick={() => setCameraMode(mode)}>{mode === "waypoint" ? "Focus waypoint" : mode === "follow" ? "Follow drone" : "Overview"}</button>)}
      <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Compact viewport" : "Expand viewport"}</button>
    </div>
    <div className="prod-drone-viewport prod-drone-scene" ref={viewport}>
      <DroneViewport drone={drone} markers={markers} cameraMode={cameraMode} />
    </div>
    <details className="prod-mission-details"><summary>Simulation timing &amp; assumptions / {mission.config.timeScale}x speed</summary>
    <p className="prod-description">{mission.config.timeScale}× simulation time{scenario?.source === "scenario" ? " · shared scenario clock (scenario pause freezes flight)" : `: 1 active viewport second = ${mission.config.timeScale} mission seconds`}. Travel {mission.config.speedMps} m/s; inspection {mission.config.inspectMs / 1000} s per waypoint; takeoff/landing {mission.config.takeoffMs / 1000}/{mission.config.landingMs / 1000} s.</p>
    <p className="prod-description">Illustrative {mission.registry.type} layout · {mission.registry.lengthKm} km. Battery drains {mission.config.batteryDrainPerSecond}% per mission second during active flight/inspection. Hidden or paused time is excluded; suspended browser time is capped to prevent catch-up jumps.</p>
    </details>
    <label className="prod-field prod-drone-dispatch"><span>Simulation route</span><select value={selectedNode} disabled={mission.phase !== "idle"} onChange={event => setSelectedNode(event.target.value)}>
      <option value="">All waypoints</option>{markers.map(node => <option key={node.id} value={node.id}>{node.id} · {node.label}</option>)}
    </select></label>
    <div className="prod-actions prod-drone-controls">
      <button type="button" disabled={mission.phase !== "idle"} onClick={() => drone.start(selectedNode || null)}>Start</button>
      <button type="button" disabled={!active} onClick={() => mission.paused ? drone.resume() : drone.pause()}>{mission.paused ? "Resume" : "Pause"}</button>
      <button type="button" disabled={!["takingOff", "travelling", "inspecting"].includes(mission.phase)} onClick={drone.returnToBase}>Return</button>
      <button type="button" onClick={drone.reset}>Reset</button>
    </div>
    <div className="prod-drone-route" aria-label="Simulation route progress">
      <label>Mission route progress <progress max="1" value={telemetry.progress} /></label>
      <div className="prod-drone-route-markers">{markers.map(marker => <span key={marker.id} style={{ left: `${marker.km / mission.registry.lengthKm * 100}%`, color: marker.color }} title={`${marker.label}: ${marker.tone}`}>
        <span aria-hidden="true">●</span><small>{marker.id.replace("NODE ", "N")}</small></span>)}</div>
      <p className="prod-description">{mission.findings.length}/{mission.route.length || markers.length} inspections complete · marker colors reflect linked condition indicators; gray means unavailable.</p>
    </div>
    {suggestion && <div className="prod-drone-suggestion"><p>Suggested simulation waypoint: {suggestion.suggestedInspectionNode} · {suggestion.location}</p>
      <p className="prod-description">{suggestion.text}</p>
      <button type="button" disabled={mission.phase !== "idle"} onClick={() => drone.start(suggestion.suggestedInspectionNode)}>Start simulation to suggested waypoint</button>
    </div>}
    <div className="prod-telemetry-scroll">
      <table className="prod-drone-findings"><caption>SIMULATION findings · linked sensor evidence</caption>
        <thead><tr><th scope="col">Waypoint / snapshot</th><th scope="col">Linked sensor evidence</th></tr></thead>
        <tbody>{mission.findings.length === 0 ? <tr><td colSpan="2">No completed simulated inspections.</td></tr> : mission.findings.map(finding => <tr key={finding.id}>
          <th scope="row"><span className="prod-simulation-badge">SIMULATION</span><p>{finding.nodeId} · {finding.location}</p>
            <small>{new Date(finding.capturedAt).toLocaleTimeString()} · {finding.context}</small></th>
          <td><p>{finding.description}</p>{[...finding.modules, ...finding.supporting].length === 0 ? <p>Linked sensor evidence unavailable.</p>
            : [...finding.modules, ...finding.supporting].map(item => <details key={item.id}><summary>{item.label} · {item.source} · {item.status}</summary>
              <ul>{item.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul></details>)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="prod-description">Findings capture linked sensor evidence at arrival, after the declared inspection completes. They are separate from alarm logs. Reset clears this simulation mission and findings.</p>
  </section>;
}
