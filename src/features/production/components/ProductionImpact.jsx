import React from "react";
import { MetricValue } from "./ThroughputStrip";
import { isNonnegative } from "../calculations/throughput.js";

const TIME_LABELS = { scheduledRunning: "Scheduled running", confirmedUnplannedStop: "Confirmed unplanned stop", plannedIdle: "Planned idle", unknown: "Unknown / rejected intervals" };

export default function ProductionImpact({ production }) {
  const { metrics, settings, accountingSession } = production;
  return (
    <section className="prod-card" aria-label="Production impact">
      <div className="prod-card-heading"><h2>Production impact</h2></div>
      <dl className="prod-kpis">
        {[["What-if shift tonnes (assumed)", metrics.projected], ["Observation coverage", metrics.coverage],
          ["Estimated loss value", metrics.lossValue], ["Forecast throughput", metrics.forecast]].map(([label, metric]) => (
          <div className="prod-kpi" key={label}><dt>{label}</dt><dd><MetricValue metric={metric} /></dd></div>
        ))}
      </dl>
      <p className="prod-description">What-if projection = observed tonnes + remaining scheduled shift hours × assumed future throughput × assumed future uptime. Forecast throughput is computed separately from continuous observations.</p>
      <dl className="prod-drone-details prod-accounting-details">
        <div><dt>Design capacity (manual reference)</dt><dd>{isNonnegative(settings.designCapacity) ? `${settings.designCapacity} t/h` : "Unavailable"}</dd></div>
        <div><dt>Expected throughput (manual assumption)</dt><dd>{isNonnegative(settings.expectedThroughput) ? `${settings.expectedThroughput} t/h` : "Unavailable"}</dd></div>
        {Object.entries(metrics.time).map(([state, metric]) => <div key={state}><dt>{TIME_LABELS[state]}</dt><dd><MetricValue metric={metric} digits={1} /></dd></div>)}
      </dl>
      <p className="prod-description">Availability uses observed running ÷ (running + confirmed unplanned stop). Planned idle and unknown intervals are excluded; coverage shows how much elapsed time was observed.</p>
      <p className="prod-description">Totals retain valid observed intervals when collection is suspended. Lost tonnes are an estimate of transport opportunity, using the expected throughput assumption.</p>
    </section>
  );
}
