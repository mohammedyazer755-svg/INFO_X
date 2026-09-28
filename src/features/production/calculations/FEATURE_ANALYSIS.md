# Sensor features and temporal analysis (Phase 4)

`features.js` consumes the observation contract, using UTC acquisition timestamps.
`temporal.js` accepts numeric points `{ t, v }` with optional acquisition quality.
Configuration lives in `config/analysisConfig.js`; the feature controller also
accepts overrides. Thresholds and stable-reference criteria are prototype values.

The provider owns both hooks throughout navigation. Feature engineering subscribes
to existing telemetry notifications and uses `getRecordedHistory()` to distinguish
acquisition validity from display freshness. An older valid acquisition may still
contribute to history when the latest observation is fresh. No additional timer,
polling loop, or render-generated observation is introduced.

Numeric windows use the final continuous valid segment, up to 120 seconds and the
store's bounded channel history. Source/device/calibration changes, invalid values,
and excessive acquisition gaps reset that segment. Freshness loss suspends features
and clears the temperature reference; recovery starts a new qualified window.
Per-channel gap limits are capped by that channel's configured freshness limit.

Sample mean and population standard deviation summarize readings, not waveform
energy. Threshold durations use left-hold integration at/above each configured
threshold between valid observations. They do not extrapolate beyond the latest
observed timestamp or through gaps. Instantaneous warnings require a fresh valid
current reading and are available during trend warm-up.

`linearSlope` returns units per second; sensor features display ADC/min or °C/min.
Both sample count (10 distinct timestamps) and duration (30 seconds) must qualify
before a trend appears. Threshold-specific hysteresis retains a previous direction
until its exit boundary is crossed. Pure prefix analysis tracks trend persistence
within the bounded window, starting at its first qualified trend estimate. A rising
trend sustained for 60 qualified seconds sets the prototype degradation indicator;
this is not a fault diagnosis or failure probability.

Temperature reference qualification requires at least 10 samples spanning 30
continuous seconds with population variance below 0.04 °C². It may qualify later
than session start. A qualified reference persists through ordinary rolling-window
eviction, but resets after incompatible observations or loss of freshness. Stability
does not prove a healthy operating state: a stable hot reference still shows its
critical threshold indicator. Cooling can produce negative slope and deviation.

Binary debounce requires the candidate state to persist across acquired observations
for 250 ms. Raw current beam state remains visible immediately. Event start/end
timestamps use the first candidate observation once its transition is confirmed.
Short pulses are rejected. Initially blocked inputs have an unobserved start and
are not counted as observed 1→0 transitions. Frequency uses the current continuous
observed segment's duration, and remains unavailable for zero duration.

Gaps and invalid/stale observations close active durations at the last observed
blocked timestamp and mark them incomplete. A blocked input after a gap starts a
new event with an unobserved start. Recent interrupted events remain visible, while
event-count/frequency windows restart. Binary source changes isolate the histories.
IR side distribution uses left-hold joint valid observations in the current shared
segment, distinguishing left-only, right-only, both, clear, and unknown time.

Piezo waveform RMS, crest factor, spectrum and bearing diagnoses remain unavailable.
IR displacement/angle and Hall integrity percentage remain unavailable. Hall events
are labelled supporting evidence for the splice zone. Phase 4 adds features and
trends only; condition scoring and maintenance recommendations remain later phases.
