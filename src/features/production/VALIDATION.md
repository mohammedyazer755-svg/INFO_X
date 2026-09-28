# Final validation — Phase 9

Validation date: 2026-09-28. System description: rule-based condition assessment, trend-based observation, estimated production accounting and simulated drone inspection. These results validate software behavior, not physical failure prediction.

## Automated results

`npm run test:production`: **111 tests passed, zero failed**. The suite covers pure calculations, telemetry validation/freshness, source isolation, temporal feature extraction, condition fusion, interval accounting, forecasting, deterministic drone FSM/timing, scenario repeatability and React DOM integration including StrictMode replay.

`npm run build`: **passed** (Vite 6.4.3). DroneScene is emitted as a lazy chunk. The existing main-bundle warning remains: minified main JavaScript exceeds 500 kB. No unrelated bundle refactor was performed.

`git diff --check`: passed; Git reports Windows line-ending conversion notices. No changes to `App.jsx`, `index.css`, package.json or package-lock.json were introduced for Phase 9. Existing changes from earlier extension phases remain in the workspace. No commits, deployment or external publication were performed.

| Requested check | Result and evidence |
| --- | --- |
| Both throughput presets = 360 t/h | Pass — accounting.test.js tests belt-load and geometry examples |
| 50 kg/m at 2.35 m/s = 423 t/h | Pass — accounting.test.js and throughputController.test.js |
| Constant 360 t/h, eight-hour projection = 2,880 t | Pass — accounting.test.js and handover.test.js |
| Two confirmed scheduled downtime hours at 360 t/h = 720 estimated lost t | Pass — handover.test.js supplies 7,201 fresh one-second samples with the normal gap limit, rather than bridging a two-hour telemetry gap |
| Invalid/stale data never becomes zero flow or confirmed downtime | Pass — contract/controller/accounting/forecast tests retain unavailable/null, reject gaps and classify stale explicit-state input as unknown; legitimate valid zero is separately tested |
| Navigation/StrictMode do not duplicate accounting | Pass — provider.test.js renders the actual provider/view in StrictMode, navigates away/back and checks unchanged totals plus a single production freshness timer |
| Unavailable/demo modules cannot improve hardware condition | Pass — condition.test.js checks hardware score 20 remains 20 when demo and unavailable scores of 100 are supplied; incompatible modules are excluded |
| Unknown coverage and instantaneous critical evidence stay visible | Pass — scenarioProvider.test.js renders 900 ADC and 45 °C during hardware warm-up with 0/5 coverage and unknown accounting labels; engine tests retain critical evidence at a high weighted average |
| 64 = Watch/Moderate | Pass — report.test.js checks exact/fractional exported bands against conditionBand |
| Losing one ESP32 field stales only that field | Pass — telemetry.test.js stops only piezo updates while temperature and both IR fields continue fresh |

## Original application checks

`legacyApp.test.js` renders the original App with only GPU and chart renderers stubbed. App state, effects, event handlers, polling, logs and export handlers run unchanged. Verified navigation to all original pages and production; IR left/right, Hall, piezo spike and temperature slider controls; alarm crossing and sustained-alarm logging; existing log loading/preservation and unrelated localStorage preservation; aggregate and individual CSV blob contents/filenames; mocked successful ESP32 fetch using the unchanged endpoint and AbortSignal; hardware observations reaching extension telemetry; disconnect; light/dark theme attribute toggling; and the new JSON download button.

The same test loads an ephemeral disabled-feature build, without editing App.jsx: production navigation disappears, original alarm navigation remains and only the original App polling interval runs. Provider tests separately verify extension subscription cleanup. Scenario integration tests verify the legacy `infox_critical_sensor_logs` value is untouched by fixture playback.

`handover.test.js` checks every extension CSS variable is declared by the original theme and verifies the single-column breakpoint at widths ≤1024px. Drone viewport DOM tests check SVG fallback for unavailable WebGL, renderer-error fallback, reduced motion, visibility observer cleanup and explicit dispatch. Actual GPU rendering is not exercised by these DOM tests.

Original index.css SHA-256 remains `1D65C6377B1F93FBC2CAC895BB174A46BA09E249823B517BEED8EE0C68772E7C`. Original App.jsx SHA-256 is `4C928A0D3ACEBB6C48EC4A7EAE3B413FDA71961622F5652ECECE0218DBE61098`.

## JSON export validation

Schema version: `navix-production-report/1.0.0`. Tests parse the downloaded application/json blob and verify units, per-field source/quality, module null scores, observation windows, effective weights, coverage, critical evidence, distinct projections, all finding tags, mode-specific limitations, valid-zero preservation and object-URL cleanup. Allowlist/redaction tests inject connection URLs and credentials into otherwise unused metadata and verify they do not appear in the report. The original CSV exports remain separate.

## Checks requiring manual browser/hardware validation

No real browser/GPU or connected ESP32 was available for final validation. The following remain unverified by automation:

- Visual light/dark contrast, typography, clipping and overflow at 320/375/768/1024 px and desktop sizes. CSS rules and theme switching were checked, but jsdom does not perform layout or screenshots.
- Actual WebGL scene appearance, browser context-loss behavior, procedural resource disposal/GPU memory, performance and visible reduced-motion behavior. Error/fallback paths and cleanup logic were exercised in DOM/controller tests.
- Physical sensor calibration, firmware timestamps/cadence, real network timeout/reconnect/CORS behavior and actual belt speed/mass flow. Ingest behavior was tested with mocked responses and per-field fixtures.
- Physical alarm/buzzer sound and OLED/drone hardware behavior. App alarm states and logs were tested, not real devices or audible browser output.
- Real browser file-save behavior and keyboard/screen-reader usability. Blob contents, filenames, native button semantics, focus CSS and DOM interactions were checked.

Before demonstration, open the app in a browser, traverse original pages and production in both themes at narrow and desktop widths, try both JSON/CSV downloads, run the combined scenario and dispatch NODE 01 explicitly. Check reduced-motion and hidden-viewport pause behavior. Connect hardware only when its ingest/calibration assumptions can be independently verified. These manual checks do not change the prototype's stated limitations.

See [HANDOVER.md](./HANDOVER.md) for demo instructions, methods, hardware limitations, lifecycle and disable procedure.

## Dashboard redesign validation

The provider integration test now exercises workspace navigation, keyboard tab selection, five expandable module summaries, inspection visibility pause/resume and persistent collection. Legacy App and scenario tests navigate the new workspaces while retaining their original source, alarm, export and accounting assertions. Visual appearance in an actual browser, GPU camera rendering and physical ESP32 behavior still require manual verification; jsdom does not validate those.

## Interactive inspection browser verification

Verified in local headless Chromium with WebGL at 1440 px and 390 px: scene renders, Start/Pause/Resume/Return work, Overview waypoint selection opens the matching inspection focus, orbit drag/zoom work, dark theme applies, and there is no page horizontal overflow on mobile. No browser page errors were reported. Desktop/close-up/mobile screenshots were inspected during development. The 111-test suite also covers explicit focus-versus-dispatch behavior and viewport expansion. Physical ESP32 and physical drone integration remain outside this simulation validation.
