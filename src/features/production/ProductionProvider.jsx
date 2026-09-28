import React, { createContext, useContext, useMemo, useState, useSyncExternalStore } from "react";
import { createTelemetryBridge } from "./telemetry/telemetryBridge.js";
import { useThroughput } from "./hooks/useThroughput.js";

const ProductionContext = createContext(null);

const noSubscription = () => () => {};

export function ProductionProvider({ enabled = true, bridge: suppliedBridge, children }) {
  const [ownedBridge] = useState(() => suppliedBridge ?? createTelemetryBridge({ enabled }));
  const bridge = suppliedBridge ?? ownedBridge;
  const production = useThroughput(bridge, enabled);
  const telemetry = useSyncExternalStore(
    enabled ? bridge.store.subscribe : noSubscription,
    bridge.store.getSnapshot,
    bridge.store.getSnapshot,
  );
  const session = useMemo(() => {
    const observations = Object.values(telemetry).map(channel => channel.latest);
    const valid = observations.filter(item => item.quality === "valid");
    const received = observations.filter(item => item.source !== "unavailable");
    const sources = [...new Set(received.map(item => item.source))];
    return {
      status: valid.length ? "Collecting data" : received.length ? "No fresh data" : "Unavailable",
      source: sources.length ? sources.join(" / ") : "Unavailable",
      lastUpdatedAt: received.length ? Math.max(...received.map(item => item.receivedAt)) : null,
    };
  }, [telemetry]);
  const value = useMemo(() => ({ enabled, session, telemetry, production }), [enabled, session, telemetry, production]);

  return (
    <ProductionContext.Provider value={value}>
      {children}
    </ProductionContext.Provider>
  );
}

export function useProduction() {
  const context = useContext(ProductionContext);
  if (!context) {
    throw new Error("useProduction must be used within ProductionProvider");
  }
  return context;
}
