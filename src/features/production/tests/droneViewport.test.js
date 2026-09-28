import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { createDroneMission, missionTelemetry } from "../simulation/droneStateMachine.js";

test("viewport provides unavailable-WebGL/reduced-motion fallbacks and observes hidden visibility with cleanup", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/" });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let observeCallback, disconnects = 0;
  globalThis.IntersectionObserver = class {
    constructor(callback) { observeCallback = callback; }
    observe() {} disconnect() { disconnects++; }
  };
  const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [], entries: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  const root = createRoot(document.getElementById("root"));
  try {
    const { default: Viewport, canRenderWebGL, SceneBoundary } = await server.ssrLoadModule("/src/features/production/simulation/DroneViewport.jsx");
    const { default: Panel, waypointMarkers } = await server.ssrLoadModule("/src/features/production/components/DronePanel.jsx");
    const mission = createDroneMission();
    const visible = [], controls = [];
    const drone = { mission, telemetry: missionTelemetry(mission), visible: true, reducedMotion: false,
      setViewportVisible: value => visible.push(value), start: node => controls.push(node), pause() {}, resume() {}, returnToBase() {}, reset() {} };
    const condition = { eligibleModules: [], criticalIndicators: [{ nodeId: "NODE 01" }], recommendations: [{ suggestedInspectionNode: "NODE 01", location: "Head Pulley zone", text: "Inspect linked evidence" }] };
    const markers = waypointMarkers(mission.registry, condition);
    assert.equal(markers[0].tone, "critical"); assert.equal(markers[1].tone, "unavailable");
    assert.equal(canRenderWebGL(), false);
    await act(async () => root.render(React.createElement(Panel, { drone, condition })));
    assert.ok(document.querySelector(".prod-drone-fallback svg"));
    assert.ok(document.body.textContent.includes("WebGL unavailable"));
    assert.ok(document.body.textContent.includes("SIMULATION"));
    assert.ok(document.body.textContent.includes("linked sensor evidence"));
    assert.deepEqual(controls, []); // Suggested waypoint does not dispatch itself.
    const node = document.querySelector('.prod-waypoint');
    await act(async () => node.click());
    assert.equal(node.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(controls, []); // Focus is independent of dispatch.
    assert.ok(document.querySelector('.prod-node-selection').textContent.includes('Head Pulley'));
    const expand = [...document.querySelectorAll('button')].find(button => button.textContent === 'Expand viewport');
    await act(async () => expand.click());
    assert.ok(document.querySelector('.prod-drone-expanded'));
    const inspect = [...document.querySelectorAll('button')].find(button => button.textContent === 'Inspect NODE 01');
    await act(async () => inspect.click());
    assert.deepEqual(controls, ['NODE 01']);
    controls.length = 0;
    await act(async () => observeCallback([{ isIntersecting: true }]));
    assert.equal(visible.at(-1), true);
    await act(async () => observeCallback([{ isIntersecting: false }]));
    assert.equal(visible.at(-1), false);
    const suggestion = [...document.querySelectorAll("button")].find(button => button.textContent.includes("suggested waypoint"));
    await act(async () => suggestion.click()); assert.deepEqual(controls, ["NODE 01"]);
    const pause = [...document.querySelectorAll("button")].find(button => button.textContent === "Pause");
    assert.equal(pause.disabled, true);
    await act(async () => root.render(React.createElement(Viewport, { drone: { ...drone, reducedMotion: true }, markers })));
    assert.ok(document.body.textContent.includes("Reduced motion preference enabled"));
    assert.equal(document.querySelector("canvas"), null);
    assert.equal(visible.at(-1), false); assert.equal(disconnects, 1);
    const previousError = console.error;
    function BrokenScene() { throw new Error("Simulated renderer failure"); }
    try {
      console.error = () => {};
      await act(async () => root.render(React.createElement(SceneBoundary, { fallback: React.createElement("p", null, "Renderer fallback") }, React.createElement(BrokenScene))));
      assert.equal(document.body.textContent, "Renderer fallback");
    } finally { console.error = previousError; }
  } finally {
    await act(async () => root.unmount()); await server.close(); dom.window.close();
    delete globalThis.window; delete globalThis.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT; delete globalThis.IntersectionObserver;
  }
});
