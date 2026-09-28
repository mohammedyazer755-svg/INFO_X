import { CHANNELS } from "./observationContract.js";
import { createTelemetryStore } from "./telemetryStore.js";

/** Read-only event bridge. It never fetches, writes legacy state, or interprets
 * render-time sensorState values as fresh hardware observations.
 * Optional firmware metadata: metadata.deviceId and
 * metadata.fields[field].{acquiredAt,calibrationStatus}.
 */
export function createTelemetryBridge({ enabled = true, now = Date.now, storeOptions = {} } = {}) {
  const store = createTelemetryStore({ ...storeOptions, now });
  let connected = false;
  let deviceKey = null;
  let connectionVersion = 0;
  let hardwareDeviceId = null;

  function setConnection(nextConnected, nextDeviceKey) {
    if (connected === nextConnected && deviceKey === nextDeviceKey) return;
    const hadConnection = connected;
    const deviceChanged = deviceKey !== null && deviceKey !== nextDeviceKey;
    connected = nextConnected;
    deviceKey = nextDeviceKey;
    connectionVersion += 1;
    hardwareDeviceId = null;
    if (hadConnection || deviceChanged) store.invalidateHardware();
  }

  function captureContext() {
    return Object.freeze({ version: connectionVersion, deviceKey });
  }

  function publishHardwarePayload(payload, context = captureContext()) {
    if (!enabled || !connected || context.version !== connectionVersion ||
      !payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const receivedAt = now();
    const nextHardwareDeviceId = typeof payload.metadata?.deviceId === "string"
      ? payload.metadata.deviceId : hardwareDeviceId ?? context.deviceKey;
    if (hardwareDeviceId !== null && hardwareDeviceId !== nextHardwareDeviceId) {
      store.invalidateHardware();
    }
    hardwareDeviceId = nextHardwareDeviceId;
    for (const field of Object.keys(CHANNELS)) {
      // The legacy speed is generated, and there is no electrical sensor.
      if (["speed", "motorCurrent", "motorVoltage"].includes(field) ||
        !Object.hasOwn(payload, field)) continue;
      const metadata = payload.metadata?.fields?.[field];
      const previous = store.getSnapshot()[field].latest;
      const previousCalibration = previous.source === "hardware" && previous.deviceId === nextHardwareDeviceId
        ? previous.calibrationStatus : "unknown";
      store.publish({ field, value: payload[field], source: "hardware", receivedAt,
        acquiredAt: metadata?.acquiredAt,
        calibrationStatus: typeof metadata?.calibrationStatus === "string" ? metadata.calibrationStatus : previousCalibration,
        deviceId: nextHardwareDeviceId });
    }
  }

  function publishManual(field, value) {
    if (!enabled) return;
    if (field === "speed") return publishDemo(field, value);
    if (["motorCurrent", "motorVoltage"].includes(field)) return;
    store.publish({ field, value, source: "manual", receivedAt: now(), calibrationStatus: "not-applicable" });
  }

  function publishDemo(field, value) {
    if (!enabled) return;
    if (["motorCurrent", "motorVoltage"].includes(field)) return;
    // A failed/stale hardware channel must never silently become demo data.
    if (field !== "speed" && (connected || store.getSnapshot()[field]?.latest.source === "hardware")) return;
    store.publish({ field, value, source: "demo", receivedAt: now(), calibrationStatus: "not-applicable" });
  }

  return Object.freeze({ store, setConnection, captureContext,
    publishHardwarePayload, publishManual, publishDemo });
}
