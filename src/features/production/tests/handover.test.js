import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accumulateSample, createAccountingSession, projectShiftTonnes, classifyTimeState } from "../calculations/accounting.js";

test("two confirmed scheduled downtime hours use fresh one-second samples to estimate 720 lost tonnes", () => {
  let session = createAccountingSession("demo");
  for (let i = 0; i <= 7200; i++) session = accumulateSample(session, { sampleId: `confirmed-${i}`, at: i * 1000, context: "demo",
    tph: 0, quality: "valid", source: "demo", identity: "confirmed-demo-test", provenance: ["demo"],
    state: classifyTimeState({ scheduled: true, confirmedState: "confirmedUnplannedStop", speed: 0, quality: "valid" }), expectedThroughput: 360 });
  assert.equal(session.timeMs.confirmedUnplannedStop, 7200000);
  assert.ok(Math.abs(session.lostTonnes - 720) < 1e-8);
  assert.equal(session.accumulatedTonnes, 0);
  assert.equal(projectShiftTonnes(0, 8, 360, 1), 2880);
});

test("extension CSS uses declared theme variables and preserves the narrow-layout breakpoint", () => {
  const css = readFileSync(new URL("../production.css", import.meta.url), "utf8");
  const original = readFileSync(new URL("../../../index.css", import.meta.url), "utf8");
  const declared = new Set([...original.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
  for (const match of css.matchAll(/var\((--[\w-]+)/g)) assert.ok(declared.has(match[1]), `${match[1]} not declared by theme`);
  assert.match(css, /@media\s*\(max-width:\s*1024px\)\s*\{\s*\.prod-layout\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(original, /\[data-theme="dark"\]/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
