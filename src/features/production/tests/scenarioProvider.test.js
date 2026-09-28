import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { createTelemetryBridge } from "../telemetry/telemetryBridge.js";

test("scenario provider displays declared rates, shares drone timing, and returns to isolated hardware without touching legacy storage", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/" });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  window.localStorage.setItem("infox_critical_sensor_logs", "legacy-sentinel");
  const previousInterval = globalThis.setInterval, previousClear = globalThis.clearInterval, previousPerformance = globalThis.performance;
  let wall = 0, nextId = 0;
  const timers = new Map();
  globalThis.performance = { now: () => wall };
  globalThis.setInterval = (callback, delay) => { timers.set(++nextId, { callback, delay }); return nextId; };
  globalThis.clearInterval = id => timers.delete(id);
  const bridge = createTelemetryBridge({ now: () => Date.UTC(2026, 8, 28), storeOptions: { schedule: () => 0, cancel: () => {} } });
  const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [], entries: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  const root = createRoot(document.getElementById("root"));
  const tab = async name => act(async () => document.getElementById(`prod-tab-${name}`).click());
  try {
    const { ProductionProvider, useProduction } = await server.ssrLoadModule("/src/features/production/ProductionProvider.jsx");
    const { default: ProductionView } = await server.ssrLoadModule("/src/features/production/ProductionView.jsx");
    let state;
    function Page() { state = useProduction(); return React.createElement(ProductionView); }
    await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(ProductionProvider, { bridge }, React.createElement(Page)))));
    await act(async () => { state.scenario.configure({ name: "combinedThermalMechanical", timeScale: 10 }); state.scenario.start(); });
    assert.equal(state.scenario.source, "scenario");
    assert.equal(state.production.settings.context, "demo");
    assert.equal(state.drone.mission.config.timeScale, 10);
    const advance = async count => {
      for (let i = 0; i < count; i++) await act(async () => {
        wall += 100;
        for (const timer of [...timers.values()]) if (timer.delay === 100) timer.callback();
      });
    };
    await advance(40);
    assert.ok(Math.abs(state.temporal.tempC.slope - 0.4) < 1e-10);
    await tab("Diagnostics");
    assert.ok(document.querySelector('[aria-label="Surface temperature"]').textContent.includes("0.4 °C/min"));
    assert.ok(document.querySelector('[aria-label="Deterministic demo scenarios"]').textContent.includes("10×"));
    await tab("Production");
    assert.equal(document.querySelector(".prod-scenario-input-lock").disabled, true);
    assert.equal(state.condition.totalModifier, 15);
    assert.equal(state.drone.mission.phase, "idle");
    await tab("Inspection");
    const dispatch = [...document.querySelectorAll("button")].find(button => button.textContent.includes("suggested waypoint"));
    await act(async () => dispatch.click());
    await advance(28);
    assert.equal(state.drone.mission.elapsedMissionMs, 28000);
    assert.equal(state.drone.mission.findings.length, 1);
    assert.ok(document.querySelector(".prod-drone-findings").textContent.includes("linked sensor evidence"));
    await act(async () => state.scenario.pause());
    const frozen = state.scenario.elapsedMs;
    await advance(20); assert.equal(state.scenario.elapsedMs, frozen);
    assert.equal(state.drone.mission.elapsedMissionMs, 28000);
    bridge.setConnection(true, "ESP32");
    await act(async () => bridge.publishHardwarePayload({ tempC: 33, piezoVal: 200 }));
    assert.equal(state.telemetry.tempC.latest.source, "demo");
    await act(async () => state.scenario.selectSource("live"));
    assert.equal(state.production.settings.context, "hardware");
    assert.equal(state.production.sessions.hardware.accumulatedTonnes, 0);
    assert.equal(state.features.tempC.samples.length, 0);
    assert.equal(state.condition.score, null);
    assert.equal(state.drone.mission.phase, "idle");
    await act(async () => bridge.publishHardwarePayload({ tempC: 33, piezoVal: 200 }));
    assert.equal(state.telemetry.tempC.latest.source, "hardware");
    assert.equal(state.features.tempC.samples.length, 1);
    await act(async () => bridge.publishHardwarePayload({ tempC: 45, piezoVal: 900 }));
    assert.equal(state.condition.score, null); // Warm-up / incomplete hardware coverage.
    assert.ok(document.querySelector(".prod-critical-panel").textContent.includes("900"));
    assert.ok(document.querySelector(".prod-critical-panel").textContent.includes("45"));
    await tab("Overview");
    assert.ok(document.querySelector('[aria-label="Condition assessment"]').textContent.includes("Based on 0/5 modules"));
    await tab("Production");
    assert.ok(document.querySelector(".prod-critical-panel").textContent.includes("900"));
    assert.ok(document.querySelector(".prod-accounting-details").textContent.includes("Unknown / rejected intervals"));
    assert.equal(window.localStorage.getItem("infox_critical_sensor_logs"), "legacy-sentinel");
    await act(async () => root.unmount());
    assert.equal([...timers.values()].filter(timer => timer.delay === 100).length, 0);
  } finally {
    await act(async () => root.unmount()); await server.close(); dom.window.close();
    globalThis.performance = previousPerformance; globalThis.setInterval = previousInterval; globalThis.clearInterval = previousClear;
    delete globalThis.window; delete globalThis.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
