/** Times are UTC epoch milliseconds. Receipt time is used as an acquisition
 * proxy when the firmware does not supply a per-field acquisition timestamp.
 * deviceId is optional identity metadata for isolating analysis windows.
 */
export const CHANNELS = Object.freeze({
  piezoVal: { unit: "ADC", signalType: "numeric", nodeId: "NODE 01", min: 0, max: 4095 },
  tempC: { unit: "°C", signalType: "numeric", nodeId: "NODE 01" },
  irLeft: { unit: "state", signalType: "binary", nodeId: "NODE 02" },
  irRight: { unit: "state", signalType: "binary", nodeId: "NODE 02" },
  magState: { unit: "state", signalType: "binary", nodeId: "NODE 03" },
  proxState: { unit: "state", signalType: "binary", nodeId: "NODE 04" },
  laserState: { unit: "state", signalType: "binary", nodeId: "NODE 03" },
  speed: { unit: "m/s", signalType: "numeric", nodeId: "NODE 04", min: 0 },
  motorCurrent: { unit: "A", signalType: "numeric", nodeId: "NODE 04", min: 0 },
  motorVoltage: { unit: "V", signalType: "numeric", nodeId: "NODE 04", min: 0 },
});

const SOURCES = new Set(["hardware", "demo", "manual", "derived", "unavailable"]);
const QUALITIES = new Set(["valid", "stale", "invalid", "missing"]);
let sequence = 0;

export function createObservation({
  field, value, source = "unavailable", acquiredAt, receivedAt = Date.now(),
  sampleId, quality, calibrationStatus = "unknown", deviceId = null,
}) {
  const definition = CHANNELS[field];
  if (!definition) throw new TypeError(`Unknown telemetry field: ${field}`);
  if (!SOURCES.has(source)) throw new TypeError(`Invalid telemetry source: ${source}`);
  if (quality !== undefined && !QUALITIES.has(quality)) throw new TypeError(`Invalid quality: ${quality}`);
  const timestamp = acquiredAt === undefined ? receivedAt : acquiredAt;
  const validTimes = Number.isFinite(receivedAt) && receivedAt >= 0 &&
    Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= receivedAt;
  // No coercion: null, empty strings and nonnumeric payloads are not zero.
  const binaryValue = typeof value === "boolean" ? Number(value) : value;
  const normalizedValue = definition.signalType === "binary" ? binaryValue : value;
  const validValue = typeof normalizedValue === "number" && Number.isFinite(normalizedValue) &&
    (definition.signalType !== "binary" || normalizedValue === 0 || normalizedValue === 1) &&
    (definition.min === undefined || normalizedValue >= definition.min) &&
    (definition.max === undefined || normalizedValue <= definition.max);
  const resolvedQuality = source === "unavailable" || value === undefined
    ? "missing" : !validValue || !validTimes ? "invalid" : quality ?? "valid";

  return Object.freeze({
    field, value: validValue && source !== "unavailable" ? normalizedValue : null,
    unit: definition.unit, signalType: definition.signalType, source,
    acquiredAt: validTimes ? timestamp : receivedAt,
    receivedAt, sampleId: sampleId ?? `navix-${++sequence}`,
    quality: resolvedQuality, calibrationStatus, nodeId: definition.nodeId,
    deviceId,
  });
}

export function observationIdentity(observation) {
  return JSON.stringify([observation.source, observation.deviceId, observation.calibrationStatus]);
}
