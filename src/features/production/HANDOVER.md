# NAVIX production extension — handover v1.0.0

Describe this prototype as **rule-based condition assessment, trend-based observation, estimated production accounting, and simulated drone inspection**. It does not provide validated failure prediction, trained AI fault diagnosis, equipment failure times or statistical confidence estimates. The existing “Production & Prediction” navigation label is preserved.

## Run and export

Run `npm install`, `npm run dev`, then open the existing Production & Prediction page. `npm run test:production` validates the extension and DOM integration; `npm run build` creates the production bundle. See [VALIDATION.md](./VALIDATION.md) for check coverage and manual limitations.

Use **Export production report (JSON)** near the top of the page. Schema version is `navix-production-report/1.0.0`; generatedAt is wall-clock ISO time. observationPeriod and module windows use UTC epoch milliseconds from the selected acquisition clock. Scenario reports use the declared fixed simulation epoch rather than live clock time. The export includes calculation inputs with units, per-field source/quality, module reasons/features/windows, condition bands/coverage/critical evidence, recommendations, current/accumulated/what-if/forecast/lost production, accounting coverage, SIMULATION-tagged drone findings and configuration.

Unavailable values remain null; a legitimate measured/calculated zero remains zero. Projected tonnes are assumed values, independently labelled from accumulated observed tonnes. The export allowlists fields and excludes endpoints, device identifiers, raw ESP32 payloads, connection settings and credentials. It redacts connection addresses accidentally present in descriptive text. It does not write legacy storage or alarm logs. It is a bounded current-window/session report, not a complete raw telemetry archive.

## Demo sequence

1. Select **Combined thermal / mechanical**, keep seed 42, and choose 10× playback.
2. Click **Start scenario**. Every playback second represents ten simulated seconds. Temperature rises at **0.4 °C/min**, vibration at **0.4 ADC/s = 24 ADC/min**. These rates calculate and display in simulation units regardless of playback scale.
3. After approximately 30 simulated seconds, qualified condition indicators show warning evidence and aligned rising temperature/vibration corroboration. Watch coverage: Vision and Energy remain unavailable. The recommendation points to Head Pulley zone, NODE 01.
4. Click **Start simulation to suggested waypoint** in the drone panel. Dispatch is explicit; recommendations never start a mission automatically. The declared takeoff is five seconds, 150 m travel at 12 m/s takes 12.5 seconds, and inspection takes ten seconds. A SIMULATION-tagged linked-evidence finding becomes available after 27.5 simulated mission seconds. Return flight and landing complete at 45 seconds.
5. Export the JSON report. Pause freezes the shared scenario clock; Reset clears demo histories, totals, forecast boundaries and drone findings and permits identical seeded replay. Hiding the drone viewport pauses flight while scenario accounting continues.
6. Try **Reduced loading** (35 kg/m, 2 m/s → 252 t/h), **Confirmed demo stop** (stop only during seconds 60–120), and **Telemetry loss** (no observations during seconds 60–120). Rising temperature never confirms a stop; telemetry loss is unknown time, not downtime.
7. Click **Return to hardware / live bridge**. Incompatible analysis windows are discarded and modules collect new live history. Hardware totals remain separate from demo totals. Scenario controls do not mutate App sensors, the ESP32 endpoint, alarm logs or `infox_critical_sensor_logs`.

## Calculations and interpretation

Throughput by assumed belt loading: `load kg/m × speed m/s × 3.6 = t/h`. Geometry estimate: `area m² × speed m/s × density kg/m³ × 3.6 = t/h`. Both illustrative presets give 360 t/h. At 50 kg/m and 2.35 m/s, calculated flow is 423 t/h. Neither current input path is an integrated calibrated belt-scale mass measurement.

Accounting left-holds valid flow between unique samples, splitting intervals at known operating-state/rate transitions. It rejects excessive gaps, stale/invalid endpoints, changed source/device/calibration/input identities and unknown states. Default maximum gap is limited to five seconds by speed freshness. Confirmed scheduled unplanned downtime uses the expected-throughput assumption: 360 t/h × two hours = 720 estimated lost tonnes. A proximity flag or zero demo speed alone does not confirm physical stoppage.

What-if shift total is `accumulated tonnes + remaining scheduled hours × assumed future throughput × assumed future uptime`; 360 t/h × eight hours at uptime 1 is 2,880 tonnes. The checkbox assumes all remaining shift hours are scheduled when selected, otherwise zero; this is not a shift-calendar integration. The separate data-driven shift estimate is available only when the remaining future interval fits inside the selected forecast horizon. Rolling mean and linear trend forecasts need continuous source-consistent history; physical clipping happens only when explicitly configured and is disclosed.

Trends need at least ten valid samples and thirty seconds of observed history. Temperature baseline means a qualified stable reference, not presumed healthy operation. Signed cooling deviations and negative slopes are retained. ADC-level vibration is not waveform RMS, frequency analysis or bearing-fault diagnosis. IR and Hall describe binary events and durations, never measured displacement or integrity percentages.

Fusion excludes stale, unavailable, collecting and incompatible-context modules, then normalizes remaining weights. No eligible modules means unavailable, not a healthy fallback. Shared-evidence corroboration is rule-based, time/location constrained and capped; overlapping rules do not double-count. Individual critical evidence stays visible during warm-up and despite a high aggregate score. Score 64 is Watch/Moderate. Configured weights, thresholds and site mappings are in `config/`; the initial four-node, 2.4 km layout is illustrative.

## Hardware limitations

Speed is demo-generated, not calibrated from rotation pulses. Hardware throughput currently remains unavailable because no calibrated hardware speed is integrated. Manual belt load, area and density are assumptions, not mass-flow measurements. Temperature/vibration/IR readings can be hardware observations only when independently supplied and validated at ESP32 ingest. Missing payload fields do not refresh old readings. Camera, current and voltage sensors are not integrated; a laser command is not a camera measurement. Drone findings are linked evidence snapshots, not independent measurements. Battery is an illustrative simulation model, not a real endurance estimate. Live network, firmware calibration and physical fault behavior have not been validated by these software tests.

The original pages keep their existing demo interpretations and branding. Extension semantics do not validate the original page's magnetic integrity or misalignment displacement displays. Original controls, charting, alarms and CSV formats remain separate from extension evidence.

## Session lifecycle and disable procedure

The App-level provider persists across navigation. Unique acquisition samples drive accounting; rerenders and StrictMode subscription replay do not create new samples. Live bridge and isolated scenario store remain separate. Source/device/calibration/regime/gap changes reset relevant analysis windows. Hardware/demo accounting sessions never merge. Reload starts new in-memory sessions; no extension metrics or findings are persisted to legacy localStorage. Scenario reset restores illustrative extension inputs and clears its demo session. Only the current session and bounded windows are exported.

The drone clock pauses on viewport/document hiding or manual Pause, preserves mission state across page navigation, and excludes hidden-time catch-up. On scenario playback it subscribes to the shared clock; otherwise it uses its declared standalone simulation scale. Reduced motion uses static SVG route rendering. Timers, subscriptions, visibility/media listeners, intersection observers and procedural R3F resources are cleaned up.

To disable the extension, set `PRODUCTION_ENABLED = false` in `src/App.jsx`, then rebuild/restart. The conditional sidebar entry and production view disappear; extension collection/scenario/drone timers stop. Original navigation, polling, controls and legacy storage remain operational. To re-enable, set it to true and rebuild. Remove no legacy keys and do not change the ESP32 endpoint for this procedure.

## Dashboard workspaces

The extension opens on Overview with four persistent KPI summaries, expandable module evidence and the highest-priority recommendation. Production contains the forecast and accounting, with calculation assumptions and forecast settings collapsed initially. Inspection provides a larger, expandable procedural scene, overview/follow/waypoint camera modes, explicit dispatch controls and simulation findings. Diagnostics contains per-field telemetry and detailed feature analysis. Source/demo controls and JSON export remain accessible above the tabs.

Tabs support arrow keys, Home and End. Changing workspaces preserves provider-owned telemetry, accounting and mission state. Leaving Inspection pauses flight through viewport visibility; production collection continues. Critical individual indicators and module coverage remain visible across workspaces. No new polling loop, storage key, hardware command or measurement claim was added. Reduced motion and unavailable WebGL use the SVG route view.
