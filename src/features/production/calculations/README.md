# Throughput and accounting (Phase 3)

Throughput functions accept numeric finite nonnegative SI inputs and return t/h.
Invalid or missing inputs return `{ unavailable: true, reason }`. Zero is a valid
flow only when all required inputs are valid. Material densities and example
presets are editable illustrative assumptions, not certified ore measurements.

Accounting is owned by `useThroughput` inside the persistent ProductionProvider.
Its controller subscribes to the existing telemetry store. No new polling loop
or clock is introduced. Demo preset speed uses existing demo sample arrivals as
its clock and still requires fresh observations. Hardware mode requires a
hardware speed channel explicitly marked `calibrated`; current firmware wiring
only supplies demo speed, so hardware totals remain unavailable. Manual loading
or geometry inputs make throughput estimated even with calibrated hardware speed.

## Integration policy

- Hold the previous valid flow constant over the interval to the next sample.
- Integrate only scheduled running segments, including valid low/zero flow.
- Split intervals at explicit operating-state or expected-rate changes.
- Confirmed scheduled unplanned stops accrue expected-rate loss, not transport.
- Planned idle and unknown states accrue neither transported nor lost tonnes.
- Require valid endpoints, consistent source/device/calibration/configuration,
  and a gap no longer than both the configured limit and speed freshness limit.
- Reject the entire interval across a gap, stale endpoint or changed flow input;
  record it as unknown. Resume after a new valid interval.
- Ignore duplicate sample IDs, same-time samples and late accounting samples.
  Telemetry itself retains sorted out-of-order history; accounting does not
  retrospectively rewrite finalized intervals.

Zero in the proximity-derived demo speed never confirms physical downtime.
An explicit state input applies only to the selected context. Switching context
clears that confirmation. Flow calculation continues to display its actual input
formula; the confirmed state controls whether the interval represents transport,
idle or loss. Users should configure demo speed consistently with confirmed state.

Demo and hardware sessions retain separate cumulative totals. Switching contexts
pauses the outgoing interval and primes the incoming one with a new observation;
inactive time is not counted. There is no localStorage persistence: reload starts
new sessions and never integrates a reload gap. Reset clears only the active
session, without changing legacy alarms or telemetry.

Observed accumulated tonnes and loss retain their historical valid quality when
current collection is suspended. Current flow exposes the current source/quality.
Unknown periods are visible in time totals and observation coverage. Loss is
unavailable if its expected-rate assumption was invalid during a confirmed stop.
Availability excludes planned idle/unknown time and is unavailable for a zero
running-plus-stop denominator.

Design capacity is a reference only. Expected throughput is an explicit loss and
projection assumption. Shift projection equals observed tonnes plus remaining
hours times expected throughput times assumed future uptime. It is not a
forecast; forecast throughput remains unavailable in Phase 3. Price is an
optional user-supplied currency-units-per-tonne assumption for estimated loss value.
