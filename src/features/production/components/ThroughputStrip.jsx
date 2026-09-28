import React from "react";
import { Gauge } from "lucide-react";

export function MetricValue({ metric, digits = 2 }) {
  return (
    <>
      <span title={metric.reason || undefined}>
        {metric.unavailable ? "Unavailable" : `${metric.value.toLocaleString(undefined, { maximumFractionDigits: digits })} ${metric.unit}`}
      </span>
      <small className="prod-metric-source">{metric.label} · {metric.quality}</small>
    </>
  );
}

export default function ThroughputStrip({ production }) {
  const { flow, metrics, status } = production;
  const items = [["Calculated throughput", flow], ["Accumulated tonnes (observed)", metrics.accumulated],
    ["Observed availability", metrics.availability], ["Estimated lost tonnes", metrics.loss]];
  return (
    <section className="prod-card" aria-label="Production summary">
      <div className="prod-card-heading"><Gauge size={18} aria-hidden="true" /><h2>Production summary</h2></div>
      <dl className="prod-kpis">
        {items.map(([label, metric]) => <div className="prod-kpi" key={label}><dt>{label}</dt><dd><MetricValue metric={metric} /></dd></div>)}
      </dl>
      <p className="prod-description" role="status">{status}</p>
      {flow.unavailable && <p className="prod-description">{flow.reason}</p>}
    </section>
  );
}
