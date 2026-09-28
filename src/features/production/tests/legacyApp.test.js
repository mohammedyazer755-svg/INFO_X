import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

// Only GPU/chart renderers are stubbed; App state, effects, controls, ingest,
// alarm logging, storage and both legacy CSV handlers execute unchanged.
const rendererStubs = {
  name: "legacy-validation-renderers", enforce: "pre",
  transform(code, id) { if (id.includes("App.jsx?extension-disabled")) return { code: code.replace("const PRODUCTION_ENABLED = true;", "const PRODUCTION_ENABLED = false;"), map: null }; },
  resolveId(id) { return ["@react-three/fiber", "@react-three/drei", "recharts"].includes(id) ? `\0validation:${id}` : null; },
  load(id) {
    if (id === "\0validation:@react-three/fiber") return 'import React from "react"; export const Canvas=()=>React.createElement("div",{"data-gpu-stub":true}); export const useFrame=()=>{}; export const useThree=()=>({});';
    if (id === "\0validation:@react-three/drei") return 'export const OrbitControls=()=>null, Html=()=>null, ContactShadows=()=>null, Environment=()=>null;';
    if (id === "\0validation:recharts") return 'import React from "react"; const Container=({children})=>React.createElement("div",null,children); export const ResponsiveContainer=Container, LineChart=Container, BarChart=Container; export const Line=()=>null, Bar=()=>null, XAxis=()=>null, YAxis=()=>null, Tooltip=()=>null, CartesianGrid=()=>null, ReferenceLine=()=>null;';
  },
};

test("original App navigation, controls, alarms, CSV, ESP32 ingest, storage and theme toggle retain behavior", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/" });
  const saved = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, fetch: globalThis.fetch,
    createURL: URL.createObjectURL, revokeURL: URL.revokeObjectURL };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = window.localStorage;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  let timerId = 0; const timers = new Map(), downloads = [], blobs = [];
  globalThis.setInterval = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  globalThis.clearInterval = id => timers.delete(id);
  URL.createObjectURL = blob => { blobs.push(blob); return `blob:test-${blobs.length}`; };
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  const initial = { misalignment: [], magnetic_hall: [], proximity_speed: [], vibration: [], temperature: [{ id: "existing-critical", timestamp: "Existing timestamp",
    timestampEpoch: 1, sensorId: "temperature", sensorName: "Temperature", hardware: "MLX90614", adcRaw: "1800 ADC", adcVoltage: "1.5 V",
    outputValue: "45°C", threshold: "40°C", severity: "CRITICAL", cause: "Existing cause", action: "Existing action" }] };
  localStorage.setItem("infox_critical_sensor_logs", JSON.stringify(initial));
  localStorage.setItem("unrelated-existing-key", "preserve-me");
  const requests = [];
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ tempC: 36, piezoVal: 400, irLeft: 1, irRight: 1, magState: 1, proxState: 1 }) }; };
  const server = await createServer({ plugins: [rendererStubs], ssr: { noExternal: ["@react-three/fiber", "@react-three/drei", "recharts"] },
    optimizeDeps: { noDiscovery: true, include: [], entries: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  const root = createRoot(document.getElementById("root"));
  const button = text => [...document.querySelectorAll("button")].find(item => item.textContent.includes(text));
  const click = async text => { const element = button(text); assert.ok(element, text); await act(async () => element.click()); };
  const tick = async () => { await act(async () => { for (const timer of [...timers.values()]) if (timer.delay === 1000) await timer.callback(); }); };
  const logs = () => JSON.parse(localStorage.getItem("infox_critical_sensor_logs"));
  try {
    const { default: App } = await server.ssrLoadModule("/src/App.jsx");
    await act(async () => root.render(React.createElement(App)));
    assert.ok(document.querySelector("[data-gpu-stub]"));
    assert.equal(logs().temperature[0].id, "existing-critical");
    await act(async () => document.querySelector('[title="Alert Chime"]').click());
    await act(async () => document.querySelector('[title="Toggle Theme"]').click());
    assert.equal(document.documentElement.getAttribute("data-theme"), "dark");
    await act(async () => document.querySelector('[title="Toggle Theme"]').click());
    assert.equal(document.documentElement.getAttribute("data-theme"), "light");
    const views = [["Misalignment", "Misalignment"], ["Magnetic", "Magnetic"], ["Speed/Motion", "Motion"], ["Temp & Vib", "Temperature"],
      ["Alarm Logs", "Critical Alarm Registry"], ["ESP32 Ingest", "Connection Manager"], ["Production & Prediction", "Production & Prediction"]];
    for (const [nav, content] of views) { await click(nav); assert.ok(document.querySelector("main").textContent.toLowerCase().includes(content.toLowerCase()), nav); }
    assert.equal([...timers.values()].filter(timer => timer.delay === 1000).length, 1);
    await click("Home (3D)");
    await click("IR Left (32)"); assert.ok(button("IR Left (32)").textContent.includes("BLOCKED"));
    await tick(); assert.equal(logs().misalignment.length, 1);
    await tick(); assert.equal(logs().misalignment.length, 1); // Sustained alarm does not create another edge.
    await click("IR Left (32)"); await click("IR Right (33)"); assert.ok(button("IR Right (33)").textContent.includes("BLOCKED"));
    await click("IR Right (33)"); await click("Hall (35)"); assert.ok(button("Hall (35)").textContent.includes("ANOMALY"));
    await click("Hall (35)"); await click("Piezo (34)"); assert.ok(button("Piezo (34)").textContent.includes("BURST >800"));
    const slider = document.querySelector('input[type="range"]');
    await act(async () => Simulate.change(slider, { target: { value: "45" } }));
    assert.equal(document.querySelector('input[type="range"]').value, "45");
    await tick(); assert.ok(logs().temperature.length >= 2); assert.ok(logs().vibration.length >= 1);
    await click("Alarm Logs"); assert.ok(document.querySelector("main").textContent.includes("BUZZER PIN 25 SOUNDING"));
    await click("Export All Sensors CSV");
    assert.match(downloads.at(-1), /^all-critical-sensor-alarms-ADC-.*\.csv$/);
    const csv = await blobs.at(-1).text(); assert.ok(csv.startsWith("ID,Timestamp,Sensor,Hardware,ADC_Raw_Value"));
    assert.ok(csv.includes("existing-critical"));
    await click("Temp & Vib");
    const single = [...document.querySelectorAll("button")].find(item => item.textContent.includes("Logs (CSV)") && !item.disabled);
    await act(async () => single.click()); assert.match(downloads.at(-1), /^critical-logs-.*\.csv$/);
    await click("ESP32 Ingest"); await click("Connect ESP32"); await tick();
    assert.equal(requests.length, 1); assert.equal(requests[0].url, "http://localhost:5000/api/sensors");
    assert.ok(requests[0].options.signal); assert.ok(document.querySelector("pre").textContent.includes('"tempC": 36'));
    await click("Home (3D)"); assert.equal(document.querySelector('input[type="range"]').value, "36");
    await click("Production & Prediction");
    await click("Diagnostics");
    const row = [...document.querySelectorAll(".prod-telemetry-table tbody tr")].find(item => item.querySelector("th").textContent === "tempC");
    assert.ok(row.textContent.includes("hardware"));
    await click("Export production report (JSON)"); assert.match(downloads.at(-1), /^navix-production-v1-.*\.json$/);
    const json = JSON.parse(await blobs.at(-1).text()); assert.equal(json.provenance.tempC.source, "hardware");
    assert.equal(JSON.stringify(json).includes("localhost:5000"), false);
    await click("ESP32 Ingest"); await click("Disconnect");
    assert.equal(localStorage.getItem("unrelated-existing-key"), "preserve-me");
    assert.ok(logs().temperature.some(item => item.id === "existing-critical"));
    const { default: DisabledApp } = await server.ssrLoadModule("/src/App.jsx?extension-disabled");
    await act(async () => root.render(React.createElement(DisabledApp)));
    assert.equal(button("Production & Prediction"), undefined);
    assert.equal(timers.size, 1); // Only the original App polling interval remains.
    await click("Alarm Logs"); assert.ok(document.querySelector("main").textContent.includes("Critical Alarm Registry"));
    assert.ok(logs().temperature.some(item => item.id === "existing-critical"));
    await act(async () => root.unmount()); assert.equal(timers.size, 0);
  } finally {
    await act(async () => root.unmount()); await server.close(); dom.window.close();
    globalThis.window = saved.window; globalThis.document = saved.document; globalThis.localStorage = saved.localStorage;
    globalThis.setInterval = saved.setInterval; globalThis.clearInterval = saved.clearInterval; globalThis.fetch = saved.fetch;
    URL.createObjectURL = saved.createURL; URL.revokeObjectURL = saved.revokeURL; delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
