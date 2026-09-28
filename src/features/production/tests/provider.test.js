import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { createTelemetryBridge } from "../telemetry/telemetryBridge.js";

test("React StrictMode replay, rerenders and page navigation retain a single live subscription", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [], entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  const root = createRoot(document.getElementById("root"));
  const tab = async name => act(async () => document.getElementById(`prod-tab-${name}`).click());
  let time = 1000;
  const timers = new Map();
  let timerId = 0;
  const bridge = createTelemetryBridge({ now: () => time, storeOptions: {
    schedule: callback => { timers.set(++timerId, callback); return timerId; },
    cancel: id => timers.delete(id),
  } });
  try {
    const { ProductionProvider, useProduction } = await server.ssrLoadModule("/src/features/production/ProductionProvider.jsx");
    const { default: ProductionView } = await server.ssrLoadModule("/src/features/production/ProductionView.jsx");
    let observed;
    function Page() {
      observed = useProduction();
      return React.createElement(React.Fragment, null,
        React.createElement("p", null, observed.telemetry.tempC.latest.quality),
        React.createElement(ProductionView));
    }
    const app = (showPage = true, enabled = true) => React.createElement(React.StrictMode, null,
      React.createElement(ProductionProvider, { bridge, enabled }, showPage ? React.createElement(Page) : null));
    await act(async () => root.render(app()));
    assert.equal(document.querySelectorAll('[role="tab"]').length, 4);
    assert.equal(document.querySelectorAll('.prod-module-row > summary').length, 5);
    assert.equal(document.querySelector('.prod-drone-scene'), null);
    await act(async () => document.getElementById('prod-tab-Overview').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    assert.equal(document.getElementById('prod-tab-Production').getAttribute('aria-selected'), 'true');
    assert.equal(document.activeElement.id, 'prod-tab-Production');
    await tab("Overview");
    // StrictMode must have exercised setup -> cleanup -> setup.
    assert.ok(timerId >= 2);
    assert.equal(timers.size, 1);
    bridge.setConnection(true, "A");
    await act(async () => bridge.publishHardwarePayload({ tempC: 34 }));
    await act(async () => bridge.publishDemo("speed", 2));
    assert.equal(observed.telemetry.tempC.history.length, 1);
    const sampleId = observed.telemetry.tempC.latest.sampleId;
    await act(async () => root.render(app()));
    assert.equal(observed.telemetry.tempC.history.length, 1);
    assert.equal(observed.telemetry.tempC.latest.sampleId, sampleId);
    await act(async () => root.render(app(false)));
    assert.equal(timers.size, 1);
    time = 2000;
    await act(async () => bridge.publishHardwarePayload({ tempC: 34 }));
    await act(async () => bridge.publishDemo("speed", 2));
    await act(async () => root.render(app()));
    assert.equal(observed.telemetry.tempC.history.length, 2);
    assert.notEqual(observed.telemetry.tempC.latest.sampleId, sampleId);
    assert.equal(observed.production.metrics.accumulated.value, 0.1);
    assert.equal(observed.features.tempC.samples.length, 2);
    assert.equal(observed.temporal.tempC.direction, null);
    await act(async () => root.render(app()));
    assert.equal(observed.production.metrics.accumulated.value, 0.1);
    await tab("Diagnostics");
    assert.ok(document.body.textContent.includes("Baseline unavailable"));
    for (let index = 1; index <= 11; index++) {
      time = 2000 + index * 3000;
      await act(async () => {
        bridge.publishHardwarePayload({ tempC: 34, piezoVal: 600 });
        bridge.publishDemo("speed", 2);
      });
    }
    assert.equal(observed.features.tempC.baseline.value, 34);
    assert.equal(observed.production.forecast.value, 360);
    await tab("Production");
    assert.ok(document.querySelector(".prod-chart-observed"));
    assert.ok(document.querySelector(".prod-chart-forecast[stroke-dasharray]"));
    const historyCount = observed.production.flowHistory.length;
    await tab("Inspection");
    await act(async () => observed.drone.start("NODE 01"));
    assert.equal(observed.drone.mission.phase, "takingOff");
    const missionTime = observed.drone.mission.elapsedMissionMs;
    await tab("Diagnostics");
    assert.equal(observed.drone.visibilityPaused, true);
    assert.equal(observed.drone.mission.phase, "takingOff");
    await tab("Inspection");
    assert.equal(observed.drone.visibilityPaused, false);
    await act(async () => root.render(app(false)));
    time += 3000;
    await act(async () => bridge.publishDemo("speed", 2));
    await act(async () => root.render(app()));
    assert.equal(observed.production.flowHistory.length, historyCount + 1);
    assert.equal(observed.drone.mission.elapsedMissionMs, missionTime);
    assert.equal(observed.drone.mission.route[0].id, "NODE 01");
    assert.equal(observed.production.forecast.value, 360);
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    await act(async () => document.dispatchEvent(new window.Event("visibilitychange")));
    assert.equal(observed.drone.visibilityPaused, true);
    assert.equal(timers.size, 1); // Production freshness collection still runs.
    await act(async () => observed.drone.reset());
    assert.equal(observed.temporal.tempC.direction, "stable");
    await tab("Diagnostics");
    assert.ok(document.body.textContent.includes("Warning threshold reached"));
    assert.ok(document.body.textContent.includes("requires waveform acquisition"));
    assert.equal(observed.condition.score, null); // Hardware data cannot enter the default demo context.
    await act(async () => observed.production.updateInputs({ context: "hardware" }));
    assert.equal(observed.condition.coverage.included, 2);
    assert.ok(observed.condition.score > 0);
    await tab("Overview");
    assert.ok(document.body.textContent.includes("NAVIX condition assessment"));
    assert.ok(document.body.textContent.includes("Prototype condition indicator"));
    assert.equal(observed.condition.modules.find(item => item.id === "vision").score, null);
    time += 5001;
    await act(async () => { for (const tick of timers.values()) tick(); });
    assert.equal(document.querySelector("p").textContent, "stale");
    assert.equal(observed.features.tempC.samples.length, 0);
    assert.equal(observed.temporal.tempC.direction, null);
    assert.equal(observed.condition.score, null);
    await act(async () => root.render(app(true, false)));
    assert.equal(timers.size, 0);
    await act(async () => root.unmount());
    assert.equal(timers.size, 0);
  } finally {
    await act(async () => root.unmount());
    await server.close();
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
