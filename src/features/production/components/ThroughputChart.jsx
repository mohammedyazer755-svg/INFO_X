import React from "react";

const number = value => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
export default function ThroughputChart({ forecast }) {
  const observed = forecast.observed.filter(point => Number.isFinite(point.t) && Number.isFinite(point.v));
  const projected = forecast.unavailable ? [] : forecast.forecast;
  const points = [...observed, ...projected];
  if (!points.length) return <p className="prod-placeholder">Collecting data</p>;
  const minT = points[0].t, maxT = Math.max(minT + 1000, points.at(-1).t);
  const lowest = Math.min(...points.map(point => point.v)), highest = Math.max(...points.map(point => point.v));
  const padding = Math.max(1, (highest - lowest) * 0.1);
  const minV = lowest - padding, maxV = highest + padding;
  const x = t => 65 + (t - minT) / (maxT - minT) * 600;
  const y = v => 205 - (v - minV) / (maxV - minV) * 170;
  const path = values => values.map((point, index) => `${index ? "L" : "M"}${x(point.t)},${y(point.v)}`).join(" ");
  return <figure className="prod-throughput-chart">
    <svg viewBox="0 0 700 245" role="img" aria-label="Throughput observations shown with a solid line and forecast with a dashed line">
      <title>Observed and forecast throughput in tonnes per hour</title>
      {[0, 0.5, 1].map(fraction => {
        const value = minV + fraction * (maxV - minV);
        return <g key={fraction}><line x1="65" x2="665" y1={y(value)} y2={y(value)} className="prod-chart-grid" />
          <text x="58" y={y(value) + 4} textAnchor="end">{number(value)}</text></g>;
      })}
      <text x="10" y="18">t/h</text>
      <path d={path(observed)} className="prod-chart-observed" />
      {observed.length === 1 && <circle cx={x(observed[0].t)} cy={y(observed[0].v)} r="3" className="prod-chart-dot" />}
      {projected.length > 0 && <>
        <line x1={x(projected[0].t)} x2={x(projected[0].t)} y1="30" y2="210" className="prod-chart-boundary" />
        <path d={path(projected)} className="prod-chart-forecast" strokeDasharray="7 5" />
      </>}
      <text x="65" y="235">{new Date(minT).toLocaleTimeString()}</text>
      <text x="665" y="235" textAnchor="end">{new Date(maxT).toLocaleTimeString()}</text>
    </svg>
    <figcaption><span className="prod-chart-key prod-chart-key-observed">Observed calculation (solid)</span>
      <span className="prod-chart-key prod-chart-key-forecast">Forecast (dashed)</span></figcaption>
  </figure>;
}
