# NAVIX telemetry

The App owns one bridge for its lifetime and passes it into the App-level
ProductionProvider. The bridge receives events from the existing ESP32 ingest,
manual controls, and the existing demo tick. It does not fetch or write legacy
state. The provider's subscription only schedules freshness checks; it does not
poll hardware. Page navigation leaves the provider and collection mounted.

Observations use the field names in `CHANNELS`. Timestamps are UTC epoch
milliseconds. Numeric strings, null, NaN, Infinity, invalid binary values, and
invalid timestamps are rejected as invalid observations. Zero is valid. Binary
booleans normalize to 0/1. Temperature calibration is unknown until explicitly
reported; receiving a temperature is not proof of calibration.

Existing firmware payloads are supported without modification. For these,
`acquiredAt` is the receipt-time proxy. Firmware can optionally supply:

```json
{
  "tempC": 34.2,
  "metadata": {
    "deviceId": "esp32-A",
    "fields": {
      "tempC": { "acquiredAt": 1790610000000, "calibrationStatus": "cal-v1" }
    }
  }
}
```

Acquisition timestamps must share the browser's epoch clock and not be in the
future. Omitted identity metadata retains known device/calibration identity;
omitted sensor fields do not create samples or refresh timestamps. Each supplied
reading gets a new sample ID even when its value matches the previous reading.
The bridge checks request context to reject responses from old connections.

History is sorted by acquisition time and defaults to 120 entries per channel.
Duplicate IDs are ignored with bounded replay protection (four times the history
capacity per channel). Freshness defaults to 5 seconds, with optional per-channel
limits. It ages from acquisition time, including for delayed firmware samples.
Freshness changes quality without changing observation timestamps.

Source, device, or calibration changes clear only the affected analysis history
and increment its `generation`. Connection/device changes also invalidate old
hardware windows immediately. Old hardware observations remain visible as stale;
they are never replaced by automatic demo fallback. Manual input is an explicit
source change. Generated speed always stays demo. Current/voltage remain missing.

Use `npm run test:production` to run pure telemetry checks and a React DOM/jsdom
test covering actual StrictMode effect replay, page navigation, and cleanup.
