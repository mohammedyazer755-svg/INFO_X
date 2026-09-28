import React from "react";
import { Activity } from "lucide-react";

const number = (value, unit = "", digits = 2) => Number.isFinite(value)
  ? `${value.toLocaleString(undefined, { maximumFractionDigits: digits })}${unit ? ` ${unit}` : ""}` : "Unavailable";
const seconds = value => Number.isFinite(value) ? number(value / 1000, "s", 1) : "Unavailable";

function Values({ rows }) {
  return <dl className="prod-drone-details">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function NumericSection({ title, feature, trend, extraRows = [] }) {
  const thresholds = feature.config.thresholds;
  const stateLabel = { critical: "Critical threshold reached", warning: "Warning threshold reached", belowThresholds: "Below configured thresholds", unavailable: "Current reading unavailable" }[feature.thresholdState];
  return <section className="prod-feature-section" aria-label={title}>
    <h3>{title}</h3>
    <p className="prod-description">{feature.source} · {feature.quality}</p>
    <p className={`prod-feature-state prod-feature-${feature.thresholdState}`}>{stateLabel}</p>
    <Values rows={[
      ["Current", number(feature.current, feature.unit)],
      ["Observed maximum", number(feature.maximum, feature.unit)],
      ["Sample mean", number(feature.mean, feature.unit)],
      ["Standard deviation", number(feature.standardDeviation, feature.unit)],
      ["Regression slope", number(trend.slope, trend.slopeUnit)],
      ["Trend", trend.direction ?? "Collecting data / unavailable"],
      ["Observed trend persistence", seconds(trend.persistenceMs)],
      ...thresholds.map(value => [`Time at/above ${value} ${feature.unit}`, seconds(feature.timeAboveThresholdMs[value])]),
      ...extraRows,
    ]} />
    <p className="prod-description">{trend.reason}</p>
    {trend.degrading && <p className="prod-feature-warning">Persistent rising trend detected.</p>}
  </section>;
}

function BinarySection({ title, feature, supporting = false }) {
  return <section className="prod-feature-section" aria-label={title}>
    <h3>{title}</h3><p className="prod-description">{feature.source} · {feature.quality}</p>
    <Values rows={[
      [supporting ? "Current anomaly" : "Current beam state", supporting ? feature.current === "blocked" ? "Active" : feature.current === "clear" ? "Inactive" : "Unknown" : feature.current],
      ["Debounced events in continuous window", feature.quality === "valid" ? feature.eventCount : "Unavailable"],
      ["Event frequency", feature.quality === "valid" ? number(feature.frequencyPerMinute, "events/min") : "Unavailable"],
      ["Current observed duration", seconds(feature.currentEvent?.durationMs)],
    ]} />
    {feature.events.length > 0 && <ul className="prod-event-list">{feature.events.map((event, index) =>
      <li key={`${event.startedAt}-${index}`}>{seconds(event.durationMs)} · {event.status}{event.incomplete ? " · incomplete duration" : ""}{event.leftCensored ? " · start unobserved" : ""}</li>)}</ul>}
    {supporting && <p className="prod-description">Supporting evidence for splice zone. Integrity percentage unavailable.</p>}
  </section>;
}

export default function SensorFeaturePanel({ features, temporal }) {
  const distribution = features.tracking.sideDistribution.durationMs;
  return <section className="prod-card" aria-label="Sensor features and trends">
    <div className="prod-card-heading"><Activity size={18} aria-hidden="true" /><h2>Sensor features &amp; trends</h2></div>
    <p className="prod-description">Trends require both 10 valid samples and 30 seconds of continuous observations. Instantaneous threshold indicators appear during collection.</p>
    <div className="prod-feature-grid">
      <NumericSection title="Piezo vibration" feature={features.piezoVal} trend={temporal.piezoVal} />
      <NumericSection title="Surface temperature" feature={features.tempC} trend={temporal.tempC} extraRows={[
        ["Stable reference baseline", features.tempC.baseline ? number(features.tempC.baseline.value, "°C") : "Baseline unavailable"],
        ["Signed baseline deviation", number(features.tempC.baselineDeviation, "°C")],
      ]} />
    </div>
    <p className="prod-description">Waveform RMS, crest factor, frequency analysis, and bearing fault diagnosis: unavailable — requires waveform acquisition.</p>
    <p className="prod-description">{features.tempC.baselineReason}</p>
    <p className={`prod-feature-state ${features.tracking.bothBlocked ? "prod-feature-warning" : ""}`}>IR tracking: {features.tracking.currentState === "bothBlocked" ? "Both beams blocked" : features.tracking.currentState}</p>
    <div className="prod-feature-grid">
      <BinarySection title="IR left" feature={features.tracking.left} />
      <BinarySection title="IR right" feature={features.tracking.right} />
      <BinarySection title="Hall anomaly events" feature={features.hall} supporting />
      <section className="prod-feature-section" aria-label="IR side distribution"><h3>Observed obstruction distribution</h3>
        <Values rows={[["Left only", seconds(distribution.left)], ["Right only", seconds(distribution.right)], ["Both beams", seconds(distribution.both)], ["Unknown intervals", seconds(distribution.unknown)]]} />
        <p className="prod-description">{features.tracking.sideDistribution.basis} Displacement in millimetres or angle is unavailable.</p>
      </section>
    </div>
  </section>;
}
