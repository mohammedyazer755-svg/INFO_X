import React, { useState } from "react";
import { Download } from "lucide-react";
import { createProductionReport, downloadProductionReport } from "../calculations/report.js";

export default function ReportExport({ state, compact = false }) {
  const [message, setMessage] = useState("");
  function exportReport() {
    try { downloadProductionReport(createProductionReport(state)); setMessage("JSON report prepared for download."); }
    catch { setMessage("Report export unavailable in this browser."); }
  }
  if (compact) return <div className="prod-report-action prod-actions">
    <button type="button" onClick={exportReport} aria-label="Export production report (JSON)"><Download size={16} aria-hidden="true" /> Export production report (JSON)</button>
    {message && <span role="status" className="prod-description">{message}</span>}
  </div>;
  return <section className="prod-card" aria-label="Production report export">
    <div className="prod-card-heading"><Download size={18} aria-hidden="true" /><h2>Production report</h2></div>
    <p className="prod-description">Rule-based condition assessment, trend-based observation, estimated production accounting, and simulated drone inspection.</p>
    <p className="prod-description">Versioned JSON includes units, sources, quality, observation windows, excluded coverage, configuration, assumptions and limitations. Connection details and credentials are excluded. Unavailable values remain null.</p>
    <div className="prod-actions"><button type="button" onClick={exportReport}>Export production report (JSON)</button></div>
    {message && <p className="prod-description" role="status">{message}</p>}
  </section>;
}
