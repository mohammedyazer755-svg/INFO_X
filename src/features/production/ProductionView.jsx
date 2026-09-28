import React from "react";
import { Activity, ScanLine, TrendingUp, Wrench } from "lucide-react";
import { useProduction } from "./ProductionProvider";
import ThroughputStrip from "./components/ThroughputStrip";
import InputPanel from "./components/InputPanel";
import ProductionImpact from "./components/ProductionImpact";
import "./production.css";

function PlaceholderCard({ title, icon: Icon, children }) {
  return (
    <section className="prod-card" aria-label={title}>
      <div className="prod-card-heading">
        <Icon size={18} aria-hidden="true" />
        <h2>{title}</h2>
      </div>
      <p className="prod-placeholder">Unavailable</p>
      <p className="prod-description">{children}</p>
    </section>
  );
}

export default function ProductionView() {
  const { enabled, session, telemetry, production } = useProduction();
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
        <div className="prod-data-status" aria-label="Production data status">
          <span className="prod-status-badge">{session.status}</span>
          <dl className="prod-metadata">
            <div><dt>Data source</dt><dd>{session.source}</dd></div>
            <div><dt>Last observation</dt><dd>{session.lastUpdatedAt === null ? "Unavailable" : new Date(session.lastUpdatedAt).toLocaleTimeString()}</dd></div>
          </dl>
        </div>
      </header>

      <div className="prod-layout">
        <div className="prod-analytics">
          <ThroughputStrip production={production} />
          <InputPanel production={production} />
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

          <PlaceholderCard title="Condition analysis" icon={Activity}>
            Sensor assessments, trends, and contributing evidence will appear here.
          </PlaceholderCard>
          <PlaceholderCard title="Maintenance recommendations" icon={Wrench}>
            Inspection suggestions will appear when condition evidence is available.
          </PlaceholderCard>
          <PlaceholderCard title="Throughput history & forecast" icon={TrendingUp}>
            Observations and forecasts will appear after sufficient valid history is available.
          </PlaceholderCard>
          <ProductionImpact production={production} />
        </div>

        <aside className="prod-drone-column" aria-label="Drone inspection simulation">
          <section className="prod-card prod-drone-card">
            <div className="prod-card-heading">
              <ScanLine size={18} aria-hidden="true" />
              <h2>Drone inspection</h2>
            </div>
            <span className="prod-status-badge">Simulation · Unavailable</span>
            <div className="prod-drone-viewport">
              <ScanLine size={40} aria-hidden="true" />
              <p className="prod-placeholder">Unavailable</p>
              <p className="prod-description">Drone simulation will appear here.</p>
            </div>
            <dl className="prod-drone-details">
              {["Mission status", "Route progress", "Inspection findings"].map((label) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>Unavailable</dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
