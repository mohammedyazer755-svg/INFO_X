import React from "react";
import { MATERIAL_DENSITIES } from "../calculations/throughput.js";

function NumberInput({ label, name, settings, updateInputs, step = "any", max }) {
  return <label className="prod-field"><span>{label}</span>
    <input type="number" min="0" max={max} step={step} value={settings[name]}
      onChange={event => updateInputs({ [name]: event.target.value === "" ? "" : Number(event.target.value) })} />
  </label>;
}

export default function InputPanel({ production }) {
  const { settings, updateInputs, applyPreset, resetSession, flow } = production;
  const input = (name, label, extra = {}) => <NumberInput key={name} name={name} label={label} settings={settings} updateInputs={updateInputs} {...extra} />;
  return (
    <section className="prod-card" aria-label="Production inputs">
      <div className="prod-card-heading"><h2>Production inputs</h2></div>
      <p className="prod-description">Editable illustrative assumptions. Demo and hardware contexts maintain separate session totals.</p>
      <div className="prod-input-grid">
        <label className="prod-field"><span>Accounting context</span><select value={settings.context} onChange={event => updateInputs({ context: event.target.value })}>
          <option value="demo">Demo / estimated</option><option value="hardware">Hardware / estimated</option>
        </select></label>
        <label className="prod-field"><span>Calculation method</span><select value={settings.mode} onChange={event => updateInputs({ mode: event.target.value })}>
          <option value="beltLoad">Belt loading</option><option value="geometry">Material geometry</option>
        </select></label>
        <label className="prod-field"><span>Speed input</span><select value={settings.speedMode} onChange={event => updateInputs({ speedMode: event.target.value })}>
          <option value="telemetry">Telemetry speed</option><option value="preset" disabled={settings.context !== "demo"}>Editable demo speed</option>
        </select></label>
        {settings.speedMode === "preset" && settings.context === "demo" && input("fixedSpeed", "Demo belt speed (m/s)")}
        {settings.mode === "beltLoad" ? input("load", "Belt loading (kg/m)") : <>
          {input("area", "Material cross-sectional area (m²)")}
          {input("density", "Bulk density (kg/m³)")}
          <label className="prod-field"><span>Illustrative material density</span><select value="" onChange={event => updateInputs({ density: Number(event.target.value) })}>
            <option value="" disabled>Choose a preset</option>
            {Object.entries(MATERIAL_DENSITIES).map(([name, density]) => <option key={name} value={density}>{name} — {density} kg/m³</option>)}
          </select></label>
        </>}
        {input("designCapacity", "Design capacity (t/h, reference only)")}
        {input("expectedThroughput", "Expected throughput (t/h, loss baseline)")}
        {input("shiftDurationHrs", "Shift duration (hours)")}
        {input("assumedUptime", "Assumed future uptime (0–1)", { max: 1, step: 0.01 })}
        {input("orePrice", "Ore price (currency units/t, optional)")}
        <label className="prod-field"><span>Maximum accounting gap</span><select value={settings.maxGapMs} onChange={event => updateInputs({ maxGapMs: Number(event.target.value) })}>
          <option value={2000}>2 seconds</option><option value={5000}>5 seconds</option><option value={10000}>10 seconds</option>
        </select></label>
        <label className="prod-field"><span>Operating state input</span><select value={settings.confirmedState} onChange={event => updateInputs({ confirmedState: event.target.value })}>
          <option value="auto">Observed motion; stoppage unconfirmed</option>
          <option value="scheduledRunning">Explicitly confirmed running</option>
          <option value="confirmedUnplannedStop">Explicitly confirmed unplanned stop</option>
          <option value="plannedIdle">Planned idle</option>
          <option value="unknown">Unknown</option>
        </select></label>
      </div>
      <label className="prod-checkbox"><input type="checkbox" checked={settings.scheduled} onChange={event => updateInputs({ scheduled: event.target.checked })} /> Scheduled production period</label>
      <p className="prod-description">State selections apply only to the selected accounting context. A zero demo speed does not confirm physical downtime. Stale speed suspends accounting even when a state is selected.</p>
      <div className="prod-actions">
        <button type="button" onClick={() => applyPreset("beltLoad360")}>360 t/h belt-load example</button>
        <button type="button" onClick={() => applyPreset("geometry360")}>360 t/h geometry example</button>
        <button type="button" onClick={resetSession}>Reset this accounting session</button>
      </div>
      <p className="prod-formula">
        {settings.mode === "beltLoad" ? "Q = load (kg/m) × speed (m/s) × 3.6" : "Q = area (m²) × speed (m/s) × bulk density (kg/m³) × 3.6"}
        {!flow.unavailable && ` = ${flow.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} t/h`}
      </p>
      <p className="prod-description">Demo presets use the existing demo observations as their clock. Missing observations still suspend accounting. The maximum gap is also limited by speed freshness. Reloading begins new sessions.</p>
    </section>
  );
}
