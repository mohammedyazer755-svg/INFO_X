import React from "react";
import { TrendingUp } from "lucide-react";
import ThroughputChart from "./ThroughputChart";
import { MetricValue } from "./ThroughputStrip";
import { temperatureCrossing } from "../calculations/forecast.js";

export default function ForecastPanel({ production, features, temporal, now }) {
  const { forecast, forecastOptions: options, updateForecastOptions: update, settings, updateInputs, dataProjection } = production;
  const crossing = temperatureCrossing(features.tempC, temporal.tempC, features.tempC.config?.thresholds?.[1] ?? 40,
    { now, maxHorizonMs: options.maxHorizonMs });
  const numberField = (label, value, onChange, extra = {}) => <label className="prod-field"><span>{label}</span>
    <input type="number" min="0" step="any" value={value} {...extra} onChange={event => onChange(event.target.value === "" ? "" : Number(event.target.value))} /></label>;
  return <section className="prod-card" aria-label="Throughput forecasting and projections">
    <div className="prod-card-heading"><TrendingUp size={18} aria-hidden="true" /><h2>Throughput history &amp; forecast</h2></div>
    <details className="prod-forecast-settings"><summary>Forecast settings &amp; physical bounds</summary>
    <div className="prod-input-grid">
      <label className="prod-field"><span>Forecast method</span><select value={options.method} onChange={event => update({ method: event.target.value })}>
        <option value="rollingBaseline">Rolling mean baseline</option><option value="linearTrend">Linear trend extrapolation</option></select></label>
      {numberField("Observation window (seconds)", options.windowMs / 1000, value => update({ windowMs: value === "" ? "" : value * 1000 }))}
      {numberField("Minimum valid samples", options.minCount, value => update({ minCount: value }), { step: 1 })}
      {numberField("Minimum history (seconds)", options.minDurationMs / 1000, value => update({ minDurationMs: value === "" ? "" : value * 1000 }))}
      {numberField("Forecast horizon (seconds)", options.horizonMs / 1000, value => update({ horizonMs: value === "" ? "" : value * 1000 }))}
      {numberField("Maximum horizon (seconds)", options.maxHorizonMs / 1000, value => update({ maxHorizonMs: value === "" ? "" : value * 1000 }))}
    </div>
    <label className="prod-checkbox"><input type="checkbox" checked={options.physicalBounds !== null}
      onChange={event => update({ physicalBounds: event.target.checked ? { min: 0, max: "" } : null })} /> Apply explicitly configured physical flow bounds</label>
    {options.physicalBounds !== null && <div className="prod-input-grid">
      {numberField("Minimum flow bound (t/h)", options.physicalBounds.min, value => update({ physicalBounds: { ...options.physicalBounds, min: value } }))}
      {numberField("Maximum flow bound (t/h)", options.physicalBounds.max, value => update({ physicalBounds: { ...options.physicalBounds, max: value } }))}
    </div>}
    </details>
    <p className="prod-description" role="status">{forecast.unavailable ? forecast.reason : `Forecast at horizon: ${forecast.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} t/h`}</p>
    <ThroughputChart forecast={forecast} />
    <dl className="prod-drone-details">
      <div><dt>Method</dt><dd>{options.method === "linearTrend" ? "Linear trend" : "Rolling mean baseline"}</dd></div>
      <div><dt>Window / horizon</dt><dd>{options.windowMs / 1000} s / {options.horizonMs / 1000} s</dd></div>
      <div><dt>Source / quality</dt><dd>{forecast.source} / {forecast.quality}</dd></div>
      <div><dt>Continuous observations</dt><dd>{forecast.observationWindow.sampleCount} samples</dd></div>
    </dl>
    <ul className="prod-forecast-assumptions">{forecast.assumptions.map(reason => <li key={reason}>{reason}</li>)}</ul>
    <div className="prod-projection-grid">
      <section aria-label="Data-driven shift projection"><h3>Data-driven shift projection</h3>
        <p className="prod-forecast-value">{dataProjection.unavailable ? "Unavailable" : `${dataProjection.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} t`}</p>
        <p className="prod-description">{dataProjection.reason ?? `Uses the forecast average rate ${dataProjection.assumedRate?.toFixed(2)} t/h over the remaining scheduled hours.`}</p>
        <p className="prod-description">Future uptime remains a user assumption ({settings.assumedUptime}). Requires the remaining shift to fit the selected forecast horizon.</p></section>
      <section aria-label="User-defined what-if scenario"><h3>User-defined what-if scenario</h3>
        {numberField("Assumed future throughput (t/h)", settings.assumedFutureThroughput, value => updateInputs({ assumedFutureThroughput: value }))}
        <p className="prod-forecast-value"><MetricValue metric={production.metrics.projected} /></p>
        <p className="prod-description">Observed tonnes + remaining scheduled hours × your future rate × your uptime assumption. Independent of forecast and design capacity.</p>
        <p className="prod-description">Remaining scheduled hours: {Number.isFinite(production.remainingScheduledHours) ? production.remainingScheduledHours.toFixed(3) : "Unavailable"}; assumes all remaining shift hours are scheduled when Scheduled production period is selected, otherwise zero. No physical bounds are applied to this scenario.</p></section>
    </div>
    <div className="prod-temperature-projection"><h3>Temperature threshold: {features.tempC.config?.thresholds?.[1] ?? 40} °C</h3>
      <p className="prod-description">Extrapolation at current rate · {features.tempC.source}</p>
      <p>{crossing.unavailable ? "Unavailable" : crossing.value === 0 ? "Already reached or exceeded" : `${(crossing.value / 60000).toFixed(2)} minutes from latest observation`}</p>
      <p className="prod-description">{crossing.reason}</p>
    </div>
  </section>;
}
