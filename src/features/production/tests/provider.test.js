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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [], entries: [] },
    server: { middlewareMode: true }, appType: "custom" });
  const root = createRoot(document.getElementById("root"));
  let time = 1000;
  const timers = new Map();
  let timerId = 0;
  const bridge = createTelemetryBridge({ now: () => time, storeOptions: {
    schedule: callback => { timers.set(++timerId, callback); return timerId; },
    cancel: id => timers.delete(id),
  } });
  try {
    const { ProductionProvider, useProduction } = await server.ssrLoadModule("/src/features/production/ProductionProvider.jsx");
    let observed;
    function Page() {
      observed = useProduction();
      return React.createElement("p", null, observed.telemetry.tempC.latest.quality);
    }
    const app = (showPage = true, enabled = true) => React.createElement(React.StrictMode, null,
      React.createElement(ProductionProvider, { bridge, enabled }, showPage ? React.createElement(Page) : null));
    await act(async () => root.render(app()));
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
    await act(async () => root.render(app()));
    assert.equal(observed.production.metrics.accumulated.value, 0.1);
    time = 7001;
    await act(async () => { for (const tick of timers.values()) tick(); });
    assert.equal(document.querySelector("p").textContent, "stale");
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
