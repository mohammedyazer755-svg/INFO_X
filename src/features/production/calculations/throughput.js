export const unavailable = (reason) => ({ unavailable: true, reason });
export const isNonnegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

function calculate(inputs, multiply) {
  for (const [name, value] of inputs) {
    if (!isNonnegative(value)) return unavailable(`${name} must be a finite, nonnegative number.`);
  }
  const result = multiply();
  return Number.isFinite(result) ? result : unavailable("Calculated throughput exceeds the supported range.");
}

export function calcThroughputBeltLoad(loadKgPerM, speedMps) {
  return calculate([["Belt load (kg/m)", loadKgPerM], ["Belt speed (m/s)", speedMps]],
    () => loadKgPerM * speedMps * 3.6);
}

export function calcThroughputGeometry(areaM2, speedMps, densityKgPerM3) {
  return calculate([["Material area (m²)", areaM2], ["Belt speed (m/s)", speedMps], ["Bulk density (kg/m³)", densityKgPerM3]],
    () => areaM2 * speedMps * densityKgPerM3 * 3.6);
}

export const PRESETS = Object.freeze({
  beltLoad360: Object.freeze({ load: 50, speed: 2.0 }),
  geometry360: Object.freeze({ area: 0.025, speed: 2.0, density: 2000 }),
});

export const MATERIAL_DENSITIES = Object.freeze({ "Iron Ore": 2000, Coal: 850, Bauxite: 1400, Limestone: 2600 });
