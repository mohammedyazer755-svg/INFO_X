import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createTelemetryBridge } from "./telemetry/telemetryBridge.js";
import { useThroughput } from "./hooks/useThroughput.js";
import { useFeatureEngineering } from "./hooks/useFeatureEngineering.js";
import { useTemporalAnalysis } from "./hooks/useTemporalAnalysis.js";
import { useConditionAnalysis } from "./hooks/useConditionAnalysis.js";
import { useDroneSimulation } from "./hooks/useDroneSimulation.js";
import { createScenarioEngine } from "./simulation/scenarioEngine.js";
import { DEFAULT_INPUTS } from "./hooks/throughputController.js";

const ProductionContext = createContext(null);

const noSubscription = () => () => {};

export function ProductionProvider({ enabled = true, bridge: suppliedBridge, children }) {
  const [ownedBridge] = useState(() => suppliedBridge ?? createTelemetryBridge({ enabled }));
  const bridge = suppliedBridge ?? ownedBridge;
  const actions = useRef({});
  const engine = useMemo(() => createScenarioEngine(bridge.store, {
    onContext: context => { actions.current.production?.updateInputs({ context }); actions.current.drone?.reset(); },
    onReset: () => { actions.current.production?.updateInputs({ ...DEFAULT_INPUTS, context: "demo" });
      actions.current.production?.resetSession(); actions.current.drone?.reset(); },
    onFrame: fixture => actions.current.production?.updateInputs({ mode: "beltLoad", load: fixture.load, speedMode: "telemetry",
      scheduled: true, confirmedState: fixture.confirmedState }),
  }), [bridge]);
  const scenario = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  useEffect(() => { if (enabled) return engine.connect(); engine.pause(); }, [engine, enabled]);
  const analysisBridge = useMemo(() => ({ store: engine.store }), [engine]);
  const production = useThroughput(analysisBridge, enabled);
  const features = useFeatureEngineering(engine.store, enabled);
  const temporal = useTemporalAnalysis(features);
  const telemetry = useSyncExternalStore(
    enabled ? engine.store.subscribe : noSubscription,
    engine.store.getSnapshot,
    engine.store.getSnapshot,
  );
  const condition = useConditionAnalysis(features, temporal, telemetry, production.settings.context, engine.store);
  const drone = useDroneSimulation(condition, enabled, undefined, scenario.source === "scenario" ? engine.clock : null);
  actions.current = { production, drone };
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
  const scenarioControls = useMemo(() => ({ ...scenario, start: engine.start, pause: engine.pause, reset: engine.reset,
    configure: engine.configure, selectSource: engine.selectSource }), [scenario, engine]);
  const value = useMemo(() => ({ enabled, session, telemetry, production, features, temporal, condition, drone, scenario: scenarioControls,
    now: engine.store.getCurrentTime() }), [enabled, session, telemetry, production, features, temporal, condition, drone, scenarioControls, engine]);

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
