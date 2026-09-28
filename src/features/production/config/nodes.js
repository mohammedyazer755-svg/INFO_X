// Illustrative site map; replace coordinates and evidence links for a real site.
export const NODE_REGISTRY = Object.freeze({
  type: "demo", lengthKm: 2.4, baseKm: 0,
  nodes: Object.freeze({
    "NODE 01": Object.freeze({ label: "Head Pulley zone", description: "Head pulley & drive motor", km: 0.15, moduleIds: ["mechanical", "thermal"] }),
    "NODE 02": Object.freeze({ label: "Idler Frame A zone", description: "Idler frame & belt tracking", km: 0.85, moduleIds: ["tracking"] }),
    "NODE 03": Object.freeze({ label: "Splice inspection zone", description: "Belt splice & surface inspection", km: 1.60, moduleIds: ["vision"], supportingIds: ["hall"] }),
    "NODE 04": Object.freeze({ label: "Tail Loading Chute zone", description: "Tail pulley & loading zone", km: 2.35, moduleIds: ["energy"] }),
  }),
  links: Object.freeze([{ ruleId: "alignmentStress", nodes: ["NODE 01", "NODE 02"] }]),
});

export const DRONE_CONFIG = Object.freeze({ timeScale: 10, speedMps: 12, takeoffMs: 5000,
  inspectMs: 10000, landingMs: 5000, batteryDrainPerSecond: 0.05 });

export function getWaypoints(registry = NODE_REGISTRY, selectedNode = null) {
  if (!Number.isFinite(registry.lengthKm) || registry.lengthKm <= 0 || !Number.isFinite(registry.baseKm) || registry.baseKm < 0 || registry.baseKm > registry.lengthKm) throw new TypeError("Invalid drone route registry.");
  const nodes = Object.entries(registry.nodes).map(([id, node]) => ({ ...node, id, positionM: node.km * 1000 }));
  if (!nodes.length || nodes.length > 64 || nodes.some(node => !Number.isFinite(node.km) || node.km < 0 || node.km > registry.lengthKm)) throw new TypeError("Invalid drone waypoint coordinates.");
  if (selectedNode !== null && !nodes.some(node => node.id === selectedNode)) throw new TypeError("Unknown inspection waypoint.");
  return nodes.filter(node => selectedNode === null || node.id === selectedNode).sort((a, b) => a.km - b.km);
}
