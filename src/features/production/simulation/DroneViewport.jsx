import React, { Component, lazy, Suspense, useEffect, useState } from "react";
const DroneScene = lazy(() => import("./DroneScene"));

export function canRenderWebGL() {
  if (typeof window === "undefined" || (!window.WebGLRenderingContext && !window.WebGL2RenderingContext)) return false;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch { return false; }
}

export function DroneFallback({ mission, telemetry, markers, reason }) {
  const x = km => 20 + km / mission.registry.lengthKm * 320;
  return <div className="prod-drone-fallback" aria-label="Static drone route overview">
    <svg viewBox="0 0 360 130" role="img" aria-label={`Simulated drone position ${telemetry.positionKm.toFixed(2)} kilometres`}>
      <title>Static SVG simulation route</title>
      <rect x="15" y="49" width="330" height="22" rx="4" fill="var(--bg-surface-alt)" stroke="var(--border-color)" />
      {Array.from({ length: 17 }, (_, i) => <line key={i} x1={20 + i * 20} x2={20 + i * 20} y1="53" y2="67" stroke="var(--text-dim)" strokeWidth="2" />)}
      <line x1="20" x2="340" y1="60" y2="60" className="prod-drone-svg-belt" />
      {markers.map(marker => <g key={marker.id}><circle cx={x(marker.km)} cy="60" r="6" fill={marker.color} />
        <text x={x(marker.km)} y="92" textAnchor="middle">{marker.id.replace("NODE ", "N")}</text></g>)}
      <g transform={`translate(${x(telemetry.positionKm)}, 28)`} className="prod-drone-svg-marker">
        <path d="M-9,-6 L9,6 M-9,6 L9,-6" fill="none" stroke="currentColor" strokeWidth="3" />
        <rect x="-4" y="-4" width="8" height="8" rx="2" />
        {[-1, 1].flatMap(a => [-1, 1].map(b => <ellipse key={`${a}:${b}`} cx={a * 9} cy={b * 6} rx="6" ry="2.5" />))}
      </g>
      <rect x="20" y="110" width="320" height="6" className="prod-drone-svg-track" />
      <rect x="20" y="110" width={320 * telemetry.progress} height="6" className="prod-drone-svg-progress" />
    </svg>
    <p className="prod-description">{reason}. Static route view; simulation controls remain available.</p>
  </div>;
}

export class SceneBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function DroneViewport({ drone, markers, cameraMode = "overview" }) {
  const [supported, setSupported] = useState(null);
  useEffect(() => { if (!drone.reducedMotion) setSupported(canRenderWebGL()); }, [drone.reducedMotion]);
  const fail = React.useCallback(() => setSupported(false), []);
  const fallback = reason => <DroneFallback mission={drone.mission} telemetry={drone.telemetry} markers={markers} reason={reason} />;
  if (drone.reducedMotion) return fallback("Reduced motion preference enabled");
  if (supported !== true) return fallback(supported === false ? "WebGL unavailable" : "Preparing viewport");
  if (!drone.visible) return fallback("Viewport hidden; animation paused");
  return <SceneBoundary fallback={fallback("3D renderer unavailable")}>
    <Suspense fallback={fallback("Loading 3D viewport")}><DroneScene cameraMode={cameraMode} mission={drone.mission} markers={markers} onFailure={fail} /></Suspense>
  </SceneBoundary>;
}
