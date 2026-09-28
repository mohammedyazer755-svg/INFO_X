import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html, ContactShadows, Environment } from "@react-three/drei";
import * as THREE from "three";
import {
  Home,
  Gauge,
  Activity,
  MoveHorizontal,
  AlertTriangle,
  Ruler,
  Thermometer,
  Waves,
  Bell,
  Settings as SettingsIcon,
  CheckCircle2,
  Zap,
  RotateCcw,
  ChevronLeft,
  Sun,
  Moon,
  Search,
  Download,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  RefreshCw,
  Copy,
  Check,
  Globe,
  ShieldCheck,
  Sparkles,
  Cpu,
  Trash2,
  FileSpreadsheet,
  TrendingUp,
} from "lucide-react";
import { ProductionProvider } from "./features/production/ProductionProvider";
import ProductionView from "./features/production/ProductionView";
import { createTelemetryBridge } from "./features/production/telemetry/telemetryBridge.js";

const PRODUCTION_ENABLED = true;

// ---------------------------------------------------------------------------
// ESP32 Hardware Pin & Sensor Definitions (Vibration Threshold @ 800 ADC)
// ---------------------------------------------------------------------------
const SENSOR_DEFS = [
  {
    id: "misalignment",
    label: "IR Misalignment",
    abbCode: "IR 32/33",
    hardware: "Infrared (IR) Optical Edge Beam",
    hardwareType: "IR Sensor (PIN 32, 33)",
    method: "Lateral Edge Obstruction & Tracking",
    icon: MoveHorizontal,
    unit: "mm",
    decimals: 1,
    nominal: 5.4,
    nodeX: -3.2,
    nodeY: 0.65,
    threshold: "25.0 mm",
    adcThreshold: "2275 ADC (1.83V)",
    zones: [
      { from: 0, to: 12, sev: "good" },
      { from: 12, to: 25, sev: "warn" },
      { from: 25, to: 45, sev: "crit" },
    ],
  },
  {
    id: "magnetic_hall",
    label: "Magnetic Anomaly",
    abbCode: "HALL 35",
    hardware: "Hall Effect Magnetic Transducer",
    hardwareType: "Hall Sensor (PIN 35)",
    method: "Magnetic Field Disturbance & Splice",
    icon: Ruler,
    unit: "% int.",
    decimals: 1,
    nominal: 96.5,
    nodeX: -0.8,
    nodeY: -0.65,
    threshold: "70.0%",
    adcThreshold: "2866 ADC (2.31V)",
    zones: [
      { from: 40, to: 70, sev: "crit" },
      { from: 70, to: 88, sev: "warn" },
      { from: 88, to: 100, sev: "good" },
    ],
  },
  {
    id: "proximity_speed",
    label: "Motion / Proximity",
    abbCode: "PROX 27",
    hardware: "Inductive Proximity Sensor",
    hardwareType: "Proximity Sensor (PIN 27)",
    method: "Object in Belt Zone & Motion Pulses",
    icon: Gauge,
    unit: "m/s",
    decimals: 2,
    nominal: 2.35,
    nodeX: 4.8,
    nodeY: 0.65,
    threshold: "1.5 m/s",
    adcThreshold: "0 ADC (Active LOW)",
    zones: [
      { from: 0, to: 1.5, sev: "crit" },
      { from: 1.5, to: 1.9, sev: "warn" },
      { from: 1.9, to: 2.7, sev: "good" },
      { from: 2.7, to: 3.0, sev: "warn" },
      { from: 3.0, to: 3.5, sev: "crit" },
    ],
  },
  {
    id: "vibration",
    label: "Motor Vibration",
    abbCode: "PIEZO 34",
    hardware: "Piezoelectric Peak Vibration Sensor",
    hardwareType: "Piezo Sensor (PIN 34)",
    method: "Peak ADC Acceleration & Velocity",
    icon: Waves,
    unit: "ADC",
    decimals: 0,
    nominal: 350,
    nodeX: 3.2,
    nodeY: 0.65,
    threshold: "800 ADC",
    adcThreshold: "800 ADC (0.64V)",
    zones: [
      { from: 0, to: 500, sev: "good" },
      { from: 500, to: 800, sev: "warn" },
      { from: 800, to: 4095, sev: "crit" },
    ],
  },
  {
    id: "temperature",
    label: "MLX90614 Temp",
    abbCode: "MLX90614",
    hardware: "Adafruit MLX90614 Non-Contact IR",
    hardwareType: "MLX90614 IR Temp (I2C)",
    method: "Motor & Bearing Housing Infrared",
    icon: Thermometer,
    unit: "°C",
    decimals: 1,
    nominal: 34.2,
    nodeX: 5.6,
    nodeY: 0.9,
    threshold: "40.0 °C",
    adcThreshold: "1638 ADC (1.32V)",
    zones: [
      { from: 20, to: 35, sev: "good" },
      { from: 35, to: 40, sev: "warn" },
      { from: 40, to: 100, sev: "crit" },
    ],
  },
];

const SEV_LABEL = { good: "Normal", warn: "Warning", crit: "Critical" };
const SCORE_MAP = { good: 100, warn: 55, crit: 10 };

function severityOf(sensor, value) {
  const zone = sensor.zones.find((z) => value >= z.from && value < z.to);
  if (zone) return zone.sev;
  return value < sensor.zones[0].from ? sensor.zones[0].sev : sensor.zones[sensor.zones.length - 1].sev;
}

function makeHistory(nominal, n = 30) {
  return Array.from({ length: n }, (_, i) => ({
    time: `${i * 2}s`,
    v: +(nominal + (Math.random() - 0.5) * 0.3).toFixed(2),
  }));
}

function playAlertChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// 3D Three.js Conveyor Model (Static Edge Rollers / Pulleys)
// ---------------------------------------------------------------------------
const BELT_X_MIN = -6.2;
const BELT_X_MAX = 6.2;

function InternalRoller3D({ x, speedRef, color = "#64748b" }) {
  const ref = useRef();
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z -= speedRef.current * 7 * delta;
  });
  return (
    <mesh ref={ref} position={[x, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.32, 0.32, 2.0, 24]} />
      <meshStandardMaterial color={color} metalness={0.7} roughness={0.3} />
    </mesh>
  );
}

function StaticEdgeRoller3D({ x, radius = 0.65, color = "#FF000F" }) {
  return (
    <group position={[x, 0, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, 2.2, 32]} />
        <meshStandardMaterial color={color} metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, -0.4, 1.25]}>
        <boxGeometry args={[0.5, 0.9, 0.25]} />
        <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.4, -1.25]}>
        <boxGeometry args={[0.5, 0.9, 0.25]} />
        <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 1.25]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.35, 16]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
      </mesh>
      <mesh position={[0, 0, -1.25]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.35, 16]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
      </mesh>
    </group>
  );
}

function ConveyorBelt3D({ beltColor = "#1e293b" }) {
  return (
    <group>
      <mesh position={[0, 0.65, 0]} receiveShadow castShadow>
        <boxGeometry args={[BELT_X_MAX - BELT_X_MIN + 1.3, 0.12, 1.9]} />
        <meshStandardMaterial color={beltColor} roughness={0.85} metalness={0.1} />
      </mesh>
      <mesh position={[0, -0.65, 0]} receiveShadow>
        <boxGeometry args={[BELT_X_MAX - BELT_X_MIN + 1.3, 0.1, 1.8]} />
        <meshStandardMaterial color={beltColor} roughness={0.9} metalness={0.1} opacity={0.9} transparent />
      </mesh>
    </group>
  );
}

function MaterialParticles3D({ speedRef, count = 8, color = "#FF000F" }) {
  const refs = useRef([]);
  const span = BELT_X_MAX - BELT_X_MIN + 1.2;
  useFrame((_, delta) => {
    refs.current.forEach((m) => {
      if (!m) return;
      m.position.x += speedRef.current * 3.4 * delta;
      const half = span / 2;
      if (m.position.x > half) m.position.x -= span;
      if (m.position.x < -half) m.position.x += span;
    });
  });
  const initial = useMemo(
    () => Array.from({ length: count }, (_, i) => BELT_X_MIN + (i / count) * (BELT_X_MAX - BELT_X_MIN)),
    [count]
  );
  return (
    <group>
      {initial.map((x, i) => (
        <mesh key={i} ref={(el) => (refs.current[i] = el)} position={[x, 0.8, (i % 3 - 1) * 0.4]}>
          <boxGeometry args={[0.22, 0.16, 0.22]} />
          <meshStandardMaterial color={color} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function LaserBeam3D({ laserActive }) {
  if (!laserActive) return null;
  return (
    <group position={[-1.2, 0.85, 0]}>
      <mesh position={[0, 0.4, 1.3]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.3, 16]} />
        <meshStandardMaterial color="#FF000F" emissive="#FF000F" emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0, 0.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 2.6, 12]} />
        <meshStandardMaterial color="#FF000F" emissive="#FF000F" emissiveIntensity={2.5} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function SensorPin3D({ s, st, goTo }) {
  const Icon = s.icon;
  const sev = st?.severity || "good";
  const sevColor = sev === "good" ? "#00875A" : sev === "warn" ? "#FF8B00" : "#DE350B";
  const [hovered, setHovered] = useState(false);

  return (
    <group position={[s.nodeX, s.nodeY, 0]}>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1.2, 8]} />
        <meshStandardMaterial color="#64748b" />
      </mesh>
      <mesh
        position={[0, 1.2, 0]}
        scale={hovered ? 1.3 : 1}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={() => goTo(s.id)}
      >
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshStandardMaterial color={sevColor} emissive={sevColor} emissiveIntensity={sev === "good" ? 0.3 : 1.2} />
      </mesh>
      <Html position={[0, 1.6, 0]} center distanceFactor={10} style={{ pointerEvents: "none" }}>
        <div
          className="abb-3d-pin-card"
          style={{ borderColor: sevColor }}
          onClick={() => goTo(s.id)}
          onPointerOver={() => setHovered(true)}
          onPointerOut={() => setHovered(false)}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Icon size={11} color={sevColor} />
              <span style={{ fontSize: 10, fontWeight: 800 }}>{s.label}</span>
            </div>
            <span style={{ fontSize: 8, fontWeight: 800, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{s.abbCode}</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: sevColor }}>
              {st?.value?.toFixed(s.decimals)}
            </span>
            <span style={{ fontSize: 9, color: "var(--text-dim)", fontWeight: 600 }}>{s.unit}</span>
          </div>
        </div>
      </Html>
    </group>
  );
}

function Conveyor3DScene({ sensorState, laserActive, speedMps, goTo }) {
  const speedRef = useRef(0.35);
  useEffect(() => {
    speedRef.current = Math.min(1.5, Math.max(0, speedMps / 2.5));
  }, [speedMps]);

  const rollerXs = [-4.5, -3.0, -1.5, 0.0, 1.5, 3.0, 4.5];

  return (
    <>
      <color attach="background" args={["#161c24"]} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[6, 9, 6]} intensity={1.3} castShadow />
      <directionalLight position={[-6, 4, -4]} intensity={0.4} />
      <Suspense fallback={null}>
        <Environment preset="city" />
      </Suspense>

      <group position={[0, -0.4, 0]}>
        <StaticEdgeRoller3D x={BELT_X_MAX} radius={0.65} color="#FF000F" />
        <StaticEdgeRoller3D x={BELT_X_MIN} radius={0.65} color="#475569" />

        {rollerXs.map((rx) => (
          <InternalRoller3D key={rx} x={rx} speedRef={speedRef} />
        ))}

        <ConveyorBelt3D beltColor="#1e293b" />
        {speedMps > 0.3 && <MaterialParticles3D speedRef={speedRef} color="#FF000F" />}
        <LaserBeam3D laserActive={laserActive} />

        {SENSOR_DEFS.map((s) => (
          <SensorPin3D key={s.id} s={s} st={sensorState[s.id]} goTo={goTo} />
        ))}

        <ContactShadows position={[0, -1.4, 0]} opacity={0.5} scale={18} blur={2.4} far={3} />
      </group>

      <OrbitControls enablePan={false} minDistance={5} maxDistance={14} minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.05} autoRotate autoRotateSpeed={0.25} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Simulated Adafruit SH1106G (128x64) OLED Screen
// ---------------------------------------------------------------------------
function OledDisplayWidget({ currentState, tempC, laserState, piezoVal, irLeft, irRight, magState, proxState }) {
  return (
    <div className="oled-container">
      {currentState === 0 && (
        <div className="oled-border-frame">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: 1 }}>INFO X</span>
            <span style={{ fontSize: 8, color: "#AAAAAA" }}>[OLED SH1106]</span>
          </div>
          <div style={{ overflow: "hidden", height: 16 }}>
            <span className="oled-scroll-text">INTELLIGENT BELT CONDITION MONITORING</span>
          </div>
          <div style={{ borderTop: "1px solid #FFFFFF", borderBottom: "1px solid #FFFFFF", padding: "2px 0", textAlign: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 900 }}>SCANNING</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, fontWeight: 700 }}>
            <span>T:{Math.round(tempC)}C</span>
            <span>LSR:{laserState ? "ON" : "OFF"}</span>
            <span>SYS ●</span>
          </div>
        </div>
      )}

      {currentState === 1 && (
        <div className="oled-border-frame" style={{ textAlign: "center", justifyContent: "center", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 900 }}>LASER</span>
          <span style={{ fontSize: 10, fontWeight: 700 }}>ACTIVATED</span>
        </div>
      )}

      {currentState === 7 && (
        <div className="oled-border-frame" style={{ textAlign: "center", justifyContent: "center", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 900 }}>LASER</span>
          <span style={{ fontSize: 10, fontWeight: 700 }}>DEACTIVATED</span>
        </div>
      )}

      {currentState === 2 && (
        <div className="oled-border-frame">
          <span style={{ fontSize: 9, fontWeight: 900, borderBottom: "1px solid #FFF", paddingBottom: 2 }}>
            [!] MOTOR VIBRATION ALERT
          </span>
          <div style={{ height: 38, display: "flex", alignItems: "flex-end", gap: 3 }}>
            {Array.from({ length: 24 }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 6,
                  height: Math.min(36, Math.max(4, (piezoVal / 4095) * 36 * (0.4 + Math.random() * 0.6))),
                  backgroundColor: "#FFFFFF",
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: 8, textAlign: "right" }}>PEAK: {piezoVal} ADC (TH: 800)</span>
        </div>
      )}

      {currentState === 3 && (
        <div className="oled-border-frame" style={{ textAlign: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 8, borderBottom: "1px solid #FFF" }}>[!] ALERT MODE</span>
          <span style={{ fontSize: 13, fontWeight: 900, margin: "2px 0" }}>TEMP CRITICAL</span>
          <span style={{ fontSize: 9 }}>READING {tempC.toFixed(1)} C</span>
        </div>
      )}

      {currentState === 4 && (
        <div className="oled-border-frame" style={{ textAlign: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 8, borderBottom: "1px solid #FFF" }}>[!] ALERT MODE</span>
          <span style={{ fontSize: 12, fontWeight: 900, margin: "2px 0" }}>BELT MISALIGNED</span>
          <span style={{ fontSize: 8 }}>
            ZONE: {irLeft === 0 && irRight === 0 ? "BOTH SIDES" : irLeft === 0 ? "LEFT SIDE" : "RIGHT SIDE"}
          </span>
        </div>
      )}

      {currentState === 5 && (
        <div className="oled-border-frame" style={{ textAlign: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 8, borderBottom: "1px solid #FFF" }}>[!] ALERT MODE</span>
          <span style={{ fontSize: 12, fontWeight: 900, margin: "2px 0" }}>MAGNETIC ANOMALY</span>
          <span style={{ fontSize: 8 }}>FIELD DISTURBANCE</span>
        </div>
      )}

      {currentState === 6 && (
        <div className="oled-border-frame" style={{ textAlign: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 8, borderBottom: "1px solid #FFF" }}>[!] DETECTION</span>
          <span style={{ fontSize: 13, fontWeight: 900, margin: "2px 0" }}>MOTION</span>
          <span style={{ fontSize: 8 }}>OBJECT IN BELT ZONE ●</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View 1: Home View (3D Conveyor + Live Stimulator)
// ---------------------------------------------------------------------------
function HomeView({
  sensorState,
  goTo,
  healthScore,
  goodCount,
  warnCount,
  critCount,
  total,
  donutCirc,
  segGood,
  segWarn,
  segCrit,
  isEspConnected,
  laserState,
  toggleLaser,
  currentState,
  tempC,
  setTempC,
  piezoVal,
  triggerPiezoSpike,
  irLeft,
  setIrLeft,
  irRight,
  setIrRight,
  magState,
  setMagState,
  proxState,
  setProxState,
  buzzerActive,
}) {
  const speedVal = sensorState.proximity_speed?.value || 2.35;
  const isRunning = speedVal > 0.4;

  return (
    <div>
      <div className="abb-card" style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: "var(--abb-red-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Activity size={22} color="var(--abb-red)" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h1 style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.2 }}>Info X — Overland Conveyor Digital Twin</h1>
                <span className={`abb-status-badge ${isRunning ? "good" : "crit"}`}>
                  {isRunning ? "● RUNNING (2.4 km)" : "■ STOPPED"}
                </span>
                {buzzerActive && (
                  <span className="abb-status-badge crit" style={{ animation: "pulse-ring 1s infinite" }}>
                    🔊 BUZZER ALARM (PIN 25)
                  </span>
                )}
              </div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                Static Edge Rollers · Piezo Threshold: 800 ADC · Individual Sensor Log Storage with ADC Outputs
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={toggleLaser} className={`abb-btn ${laserState ? "primary" : ""}`} style={{ padding: "8px 14px", fontSize: 12 }}>
              <Zap size={14} /> Laser (PIN 26): <strong>{laserState ? "ON" : "OFF"}</strong>
            </button>
            <button
              onClick={() => goTo("settings")}
              className="abb-btn"
              style={{
                backgroundColor: isEspConnected ? "var(--color-good-bg)" : "var(--color-warn-bg)",
                borderColor: isEspConnected ? "var(--color-good)" : "var(--color-warn)",
                color: isEspConnected ? "var(--color-good)" : "var(--color-warn)",
              }}
            >
              {isEspConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>{isEspConnected ? "ESP32 Live Stream" : "Simulation Mode"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3D Conveyor Canvas */}
      <div className="abb-card">
        <div className="abb-card-header">
          <div className="abb-card-title-group">
            <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "var(--abb-red)" }} />
            <span className="abb-card-title">Info X 3D Conveyor Layout &amp; Sensor Telemetry</span>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            Static Edge Pulleys · Orbit 360° · Click sensor pins for channel logs
          </span>
        </div>

        <div className="abb-3d-viewport">
          <Canvas shadows camera={{ position: [0.5, 3.8, 10.5], fov: 40 }}>
            <Conveyor3DScene sensorState={sensorState} laserActive={laserState} speedMps={speedVal} goTo={goTo} />
          </Canvas>
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 12,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              backgroundColor: "rgba(0,0,0,0.65)",
              color: "#FFFFFF",
              padding: "4px 10px",
              borderRadius: 6,
              backdropFilter: "blur(4px)",
            }}
          >
            3D THREE.JS TWIN · STATIC EDGE ROLLERS · REAL-TIME SENSOR NODES
          </div>
        </div>

        {/* Bottom Hardware Strip */}
        <div className="abb-grid-3" style={{ borderTop: "1px solid var(--border-color)", paddingTop: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--text-muted)" }}>
              SH1106 OLED (128x64) Screen
            </span>
            <OledDisplayWidget
              currentState={currentState}
              tempC={tempC}
              laserState={laserState}
              piezoVal={piezoVal}
              irLeft={irLeft}
              irRight={irRight}
              magState={magState}
              proxState={proxState}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
            <div style={{ width: 100, height: 100, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="100" height="100" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="38" fill="none" stroke="var(--border-color)" strokeWidth="10" />
                <circle cx="50" cy="50" r="38" fill="none" stroke="var(--color-good)" strokeWidth="10" strokeDasharray={`${segGood} ${donutCirc - segGood}`} strokeDashoffset="0" transform="rotate(-90 50 50)" />
                <circle cx="50" cy="50" r="38" fill="none" stroke="var(--color-warn)" strokeWidth="10" strokeDasharray={`${segWarn} ${donutCirc - segWarn}`} strokeDashoffset={-segGood} transform="rotate(-90 50 50)" />
                <circle cx="50" cy="50" r="38" fill="none" stroke="var(--color-crit)" strokeWidth="10" strokeDasharray={`${segCrit} ${donutCirc - segCrit}`} strokeDashoffset={-(segGood + segWarn)} transform="rotate(-90 50 50)" />
                <text x="50" y="48" textAnchor="middle" fontSize="18" className="mono" fill="var(--text-main)" fontWeight="800">{healthScore}%</text>
                <text x="50" y="62" textAnchor="middle" fontSize="7" fill="var(--text-muted)" fontWeight="700">HEALTH</text>
              </svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
              <span style={{ fontWeight: 800, fontSize: 13 }}>Conveyor Health Index</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "var(--color-good)" }} /> Normal <strong className="mono">{goodCount}/{total}</strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "var(--color-warn)" }} /> Warning <strong className="mono">{warnCount}/{total}</strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "var(--color-crit)" }} /> Critical <strong className="mono">{critCount}/{total}</strong>
              </div>
            </div>
          </div>

          <div style={{ backgroundColor: "var(--bg-surface-alt)", border: "1px solid var(--border-color)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>ESP32 Sensor Stimulator</span>
              <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>GPIO / ADC</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, margin: "8px 0" }}>
              <button onClick={() => setIrLeft(irLeft === 1 ? 0 : 1)} className={`abb-btn ${irLeft === 0 ? "crit" : ""}`} style={{ padding: "4px 8px", fontSize: 10 }}>
                IR Left (32): {irLeft === 0 ? "BLOCKED" : "CLEAR"}
              </button>
              <button onClick={() => setIrRight(irRight === 1 ? 0 : 1)} className={`abb-btn ${irRight === 0 ? "crit" : ""}`} style={{ padding: "4px 8px", fontSize: 10 }}>
                IR Right (33): {irRight === 0 ? "BLOCKED" : "CLEAR"}
              </button>
              <button onClick={triggerPiezoSpike} className={`abb-btn ${piezoVal > 800 ? "crit" : ""}`} style={{ padding: "4px 8px", fontSize: 10 }}>
                Piezo (34): {piezoVal > 800 ? "BURST >800" : "BURST SPIKE"}
              </button>
              <button onClick={() => setMagState(magState === 1 ? 0 : 1)} className={`abb-btn ${magState === 0 ? "crit" : ""}`} style={{ padding: "4px 8px", fontSize: 10 }}>
                Hall (35): {magState === 0 ? "ANOMALY" : "NORMAL"}
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10, borderTop: "1px solid var(--border-color)", paddingTop: 6 }}>
              <span>MLX90614 Temp: <strong>{tempC.toFixed(1)}°C</strong></span>
              <input type="range" min="25" max="55" step="0.5" value={tempC} onChange={(e) => setTempC(Number(e.target.value))} style={{ width: 80 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual Sensor Critical Alarm Log Table Component (With ADC Outputs)
// ---------------------------------------------------------------------------
function SensorCriticalLogTable({ sensorDef, logs, onClear }) {
  const exportCSV = () => {
    const header = "ID,Timestamp,Sensor,Hardware,ADC_Raw_Value,ADC_Voltage_Volts,Calibrated_Output,Critical_Threshold,Severity,Cause,Action\n";
    const rows = logs.map((l) =>
      `"${l.id}","${l.timestamp}","${l.sensorName}","${l.hardware}","${l.adcRaw || ''}","${l.adcVoltage || ''}","${l.outputValue}","${l.threshold || ''}","${l.severity}","${l.cause.replace(/"/g, '""')}","${l.action.replace(/"/g, '""')}"`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `critical-logs-${sensorDef.id}-ADC-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="abb-card" style={{ marginTop: 16 }}>
      <div className="abb-card-header">
        <div>
          <span className="abb-card-title">{sensorDef.label} — Saved Critical Alarm Logs &amp; ADC Outputs</span>
          <p className="abb-card-subtitle">
            Recorded whenever reading crossed above critical threshold · {logs.length} incidents logged
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={exportCSV} disabled={logs.length === 0} className="abb-btn">
            <FileSpreadsheet size={13} /> Export {sensorDef.label} Logs (CSV)
          </button>
          <button onClick={() => onClear(sensorDef.id)} disabled={logs.length === 0} className="abb-btn warn">
            <Trash2 size={13} /> Clear
          </button>
        </div>
      </div>

      {logs.length === 0 ? (
        <div style={{ textAlign: "center", padding: "30px 10px", color: "var(--text-dim)", fontSize: 12 }}>
          <CheckCircle2 size={24} color="var(--color-good)" style={{ margin: "0 auto 6px", opacity: 0.8 }} />
          <span>No critical alarm incidents recorded for {sensorDef.label}.</span>
        </div>
      ) : (
        <div className="abb-table-wrapper">
          <table className="abb-table">
            <thead>
              <tr>
                <th>Log ID</th>
                <th>Timestamp</th>
                <th>Raw ADC Output (12-bit)</th>
                <th>ADC Voltage (3.3V)</th>
                <th>Calibrated Reading</th>
                <th>Critical Limit</th>
                <th>Cause &amp; Diagnostics</th>
                <th>Action Taken</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{l.id}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{l.timestamp}</td>
                  <td className="mono" style={{ fontWeight: 800, color: "var(--color-crit)" }}>{l.adcRaw}</td>
                  <td className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{l.adcVoltage}</td>
                  <td style={{ fontWeight: 800, color: "var(--color-crit)" }}>{l.outputValue}</td>
                  <td className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{l.threshold}</td>
                  <td style={{ fontSize: 11, color: "var(--text-main)" }}>{l.cause}</td>
                  <td style={{ fontSize: 11, color: "var(--color-info)", fontWeight: 600 }}>{l.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alarms & Events Registry View (Multi-Sensor Individual Logs with ADC)
// ---------------------------------------------------------------------------
function AlarmsRegistryView({ criticalLogs, onClearSensorLogs, buzzerActive }) {
  const [activeTab, setActiveTab] = useState("all");

  const allLogs = useMemo(() => {
    let combined = [];
    Object.keys(criticalLogs).forEach((key) => {
      combined = [...combined, ...criticalLogs[key]];
    });
    return combined.sort((a, b) => b.timestampEpoch - a.timestampEpoch);
  }, [criticalLogs]);

  const exportAllCSV = () => {
    const header = "ID,Timestamp,Sensor,Hardware,ADC_Raw_Value,ADC_Voltage_Volts,Calibrated_Output,Critical_Threshold,Severity,Cause,Action\n";
    const rows = allLogs.map((l) =>
      `"${l.id}","${l.timestamp}","${l.sensorName}","${l.hardware}","${l.adcRaw || ''}","${l.adcVoltage || ''}","${l.outputValue}","${l.threshold || ''}","${l.severity}","${l.cause.replace(/"/g, '""')}","${l.action.replace(/"/g, '""')}"`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `all-critical-sensor-alarms-ADC-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="abb-card">
      <div className="abb-card-header">
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 800 }}>Info X — Individual Sensor Critical Alarm Registry</h1>
          <p className="abb-card-subtitle">
            Saved immediately when sensors cross above the critical line with exact ADC output readings
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className={`abb-status-badge ${buzzerActive ? "crit" : "good"}`}>
            {buzzerActive ? "BUZZER PIN 25 SOUNDING" : "BUZZER IDLE"}
          </span>
          <button onClick={exportAllCSV} disabled={allLogs.length === 0} className="abb-btn">
            <Download size={13} /> Export All Sensors CSV
          </button>
        </div>
      </div>

      {/* Sensor Tab Selectors */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, borderBottom: "1px solid var(--border-color)", paddingBottom: 12 }}>
        <button
          onClick={() => setActiveTab("all")}
          className={`abb-btn ${activeTab === "all" ? "primary" : ""}`}
          style={{ padding: "6px 12px" }}
        >
          All Critical Logs ({allLogs.length})
        </button>

        {SENSOR_DEFS.map((s) => {
          const count = (criticalLogs[s.id] || []).length;
          return (
            <button
              key={s.id}
              onClick={() => setActiveTab(s.id)}
              className={`abb-btn ${activeTab === s.id ? "primary" : ""}`}
              style={{ padding: "6px 12px" }}
            >
              {s.label} ({count})
            </button>
          );
        })}
      </div>

      {activeTab === "all" ? (
        <div>
          {allLogs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 10px", color: "var(--text-dim)" }}>
              <CheckCircle2 size={32} color="var(--color-good)" style={{ margin: "0 auto 8px", opacity: 0.8 }} />
              <p style={{ fontSize: 13, fontWeight: 700 }}>No critical alarm incidents recorded</p>
              <p style={{ fontSize: 11 }}>All sensors are operating within their specified safety envelopes.</p>
            </div>
          ) : (
            <div className="abb-table-wrapper">
              <table className="abb-table">
                <thead>
                  <tr>
                    <th>Log ID</th>
                    <th>Timestamp</th>
                    <th>Sensor Name</th>
                    <th>Hardware Channel</th>
                    <th>Raw ADC Output</th>
                    <th>ADC Voltage</th>
                    <th>Calibrated Output</th>
                    <th>Critical Limit</th>
                    <th>Cause &amp; Diagnostics</th>
                    <th>Action Required</th>
                  </tr>
                </thead>
                <tbody>
                  {allLogs.map((l) => (
                    <tr key={l.id}>
                      <td className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{l.id}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{l.timestamp}</td>
                      <td style={{ fontWeight: 800 }}>{l.sensorName}</td>
                      <td style={{ color: "var(--text-muted)", fontSize: 11 }}>{l.hardware}</td>
                      <td className="mono" style={{ fontWeight: 800, color: "var(--color-crit)" }}>{l.adcRaw}</td>
                      <td className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{l.adcVoltage}</td>
                      <td style={{ fontWeight: 800, color: "var(--color-crit)" }}>{l.outputValue}</td>
                      <td className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{l.threshold}</td>
                      <td style={{ fontSize: 11 }}>{l.cause}</td>
                      <td style={{ fontSize: 11, color: "var(--color-info)", fontWeight: 600 }}>{l.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <SensorCriticalLogTable
          sensorDef={SENSOR_DEFS.find((s) => s.id === activeTab)}
          logs={criticalLogs[activeTab] || []}
          onClear={onClearSensorLogs}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root App Component
// ---------------------------------------------------------------------------
export default function BeltMonitorPro() {
  const [theme, setTheme] = useState("light");
  const [activeView, setActiveView] = useState("home");
  const [tickMs, setTickMs] = useState(1000);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [language, setLanguage] = useState("English");
  const [now, setNow] = useState(new Date());

  // ESP32 State Variables
  const [laserState, setLaserState] = useState(false);
  const [showLaserMsg, setShowLaserMsg] = useState(false);
  const [laserTimer, setLaserTimer] = useState(0);
  const [piezoVal, setPiezoVal] = useState(350);
  const [piezoTimer, setPiezoTimer] = useState(0);
  const [tempC, setTempC] = useState(34.2);
  const [irLeft, setIrLeft] = useState(1);
  const [irRight, setIrRight] = useState(1);
  const [magState, setMagState] = useState(1);
  const [proxState, setProxState] = useState(1);

  const [espEndpoint, setEspEndpoint] = useState("http://localhost:5000/api/sensors");
  const [isEspConnected, setIsEspConnected] = useState(false);
  const [lastEspPayload, setLastEspPayload] = useState(null);
  const [productionBridge] = useState(() => createTelemetryBridge({ enabled: PRODUCTION_ENABLED }));

  useEffect(() => {
    productionBridge.setConnection(isEspConnected, espEndpoint);
  }, [productionBridge, isEspConnected, espEndpoint]);

  const setManualTempC = useCallback((value) => {
    setTempC(value);
    productionBridge.publishManual("tempC", value);
  }, [productionBridge]);
  const setManualIrLeft = useCallback((value) => {
    setIrLeft(value);
    productionBridge.publishManual("irLeft", value);
  }, [productionBridge]);
  const setManualIrRight = useCallback((value) => {
    setIrRight(value);
    productionBridge.publishManual("irRight", value);
  }, [productionBridge]);
  const setManualMagState = useCallback((value) => {
    setMagState(value);
    productionBridge.publishManual("magState", value);
  }, [productionBridge]);
  const setManualProxState = useCallback((value) => {
    setProxState(value);
    productionBridge.publishManual("proxState", value);
  }, [productionBridge]);

  // Individual Critical Alarm Logs per sensor (stored in localStorage)
  const [criticalLogs, setCriticalLogs] = useState(() => {
    try {
      const saved = localStorage.getItem("infox_critical_sensor_logs");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      misalignment: [],
      magnetic_hall: [],
      proximity_speed: [],
      vibration: [],
      temperature: [],
    };
  });

  const lastLoggedState = useRef({});

  // Sensor data state for charts
  const [sensorState, setSensorState] = useState(() => {
    const init = {};
    SENSOR_DEFS.forEach((s) => {
      init[s.id] = { value: s.nominal, history: makeHistory(s.nominal), severity: "good" };
    });
    return init;
  });

  useEffect(() => {
    try {
      localStorage.setItem("infox_critical_sensor_logs", JSON.stringify(criticalLogs));
    } catch (e) {}
  }, [criticalLogs]);

  // Record an individual critical log entry whenever a sensor moves above critical line
  const recordCriticalLog = useCallback((sensorId, outputValue, adcRaw, adcVoltage, cause, action) => {
    const sDef = SENSOR_DEFS.find((s) => s.id === sensorId);
    if (!sDef) return;

    const newLog = {
      id: `CRIT-${sDef.abbCode.replace(/[^a-zA-Z0-9]/g, "")}-${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toLocaleString(),
      timestampEpoch: Date.now(),
      sensorId: sDef.id,
      sensorName: sDef.label,
      hardware: sDef.hardwareType,
      adcRaw: adcRaw,
      adcVoltage: adcVoltage,
      outputValue: outputValue,
      threshold: sDef.threshold,
      severity: "CRITICAL",
      cause: cause,
      action: action,
    };

    setCriticalLogs((prev) => ({
      ...prev,
      [sensorId]: [newLog, ...(prev[sensorId] || [])].slice(0, 100),
    }));
  }, []);

  const clearSensorLogs = useCallback((sensorId) => {
    setCriticalLogs((prev) => ({
      ...prev,
      [sensorId]: [],
    }));
  }, []);

  const toggleLaser = useCallback(() => {
    productionBridge.publishManual("laserState", !laserState);
    setLaserState((prev) => {
      const next = !prev;
      setShowLaserMsg(true);
      setLaserTimer(Date.now());
      return next;
    });
  }, [productionBridge, laserState]);

  const triggerPiezoSpike = useCallback(() => {
    setPiezoVal(1850);
    setPiezoTimer(Date.now());
    productionBridge.publishManual("piezoVal", 1850);
  }, [productionBridge]);

  const currentState = useMemo(() => {
    if (showLaserMsg) return laserState ? 1 : 7;
    if (Date.now() - piezoTimer < 3000 || piezoVal > 800) return 2;
    if (tempC > 40.0) return 3;
    if (irLeft === 0 || irRight === 0) return 4;
    if (magState === 0) return 5;
    if (proxState === 0) return 6;
    return 0;
  }, [showLaserMsg, laserState, piezoTimer, piezoVal, tempC, irLeft, irRight, magState, proxState]);

  const buzzerActive = useMemo(() => {
    return irLeft === 0 || irRight === 0 || tempC > 40.0 || piezoVal > 800 || Date.now() - piezoTimer < 3000;
  }, [irLeft, irRight, tempC, piezoVal, piezoTimer]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (showLaserMsg) {
      const t = setTimeout(() => setShowLaserMsg(false), 2000);
      return () => clearTimeout(t);
    }
  }, [showLaserMsg, laserTimer]);

  // Main Polling Loop
  useEffect(() => {
    const tick = setInterval(async () => {
      setNow(new Date());

      if (Date.now() - piezoTimer >= 3000 && piezoVal > 500) {
        const demoPiezoVal = Math.round(300 + Math.random() * 100);
        setPiezoVal(demoPiezoVal);
        productionBridge.publishDemo("piezoVal", demoPiezoVal);
      } else {
        productionBridge.publishDemo("piezoVal", piezoVal);
      }

      if (isEspConnected && espEndpoint) {
        try {
          const productionContext = productionBridge.captureContext();
          const res = await fetch(espEndpoint, { signal: AbortSignal.timeout(1000) });
          if (res.ok) {
            const data = await res.json();
            productionBridge.publishHardwarePayload(data, productionContext);
            setLastEspPayload(data);
            if (data.tempC !== undefined) setTempC(Number(data.tempC));
            if (data.irLeft !== undefined) setIrLeft(Number(data.irLeft));
            if (data.irRight !== undefined) setIrRight(Number(data.irRight));
            if (data.piezoVal !== undefined) setPiezoVal(Number(data.piezoVal));
            if (data.magState !== undefined) setMagState(Number(data.magState));
            if (data.proxState !== undefined) setProxState(Number(data.proxState));
            if (data.laserState !== undefined) setLaserState(Boolean(data.laserState));
          }
        } catch (e) {}
      }

      // Publish once per polling tick, outside React's replayable state updater.
      const speedVal = proxState === 0 ? 0.0 : 2.35 + (Math.random() - 0.5) * 0.05;
      productionBridge.publishDemo("speed", speedVal);
      setSensorState((prev) => {
        const next = {};

        // 1. IR Misalignment (PIN 32, 33)
        const misVal = irLeft === 0 || irRight === 0 ? 32.5 : 5.4 + (Math.random() - 0.5) * 0.8;
        const misSev = severityOf(SENSOR_DEFS[0], misVal);
        next.misalignment = {
          value: misVal,
          severity: misSev,
          history: [...prev.misalignment.history.slice(1), { time: new Date().toLocaleTimeString(), v: +misVal.toFixed(1) }],
        };
        if (misSev === "crit" && lastLoggedState.current.misalignment !== "crit") {
          const zone = irLeft === 0 && irRight === 0 ? "Both Sides Blocked" : irLeft === 0 ? "Left Edge Blocked" : "Right Edge Blocked";
          const rawAdc = Math.round((misVal / 45.0) * 4095);
          const adcVolt = ((rawAdc / 4095.0) * 3.3).toFixed(2) + " V";
          recordCriticalLog("misalignment", `${misVal.toFixed(1)} mm (${zone})`, `${rawAdc} ADC`, adcVolt, "Lateral edge obstruction moved above critical threshold (>25.0 mm).", "Adjust conveyor training idlers and clear belt frame obstruction.");
        }
        lastLoggedState.current.misalignment = misSev;

        // 2. Magnetic Hall (PIN 35)
        const magVal = magState === 0 ? 55.0 : 96.5 + (Math.random() - 0.5) * 0.5;
        const magSev = severityOf(SENSOR_DEFS[1], magVal);
        next.magnetic_hall = {
          value: magVal,
          severity: magSev,
          history: [...prev.magnetic_hall.history.slice(1), { time: new Date().toLocaleTimeString(), v: +magVal.toFixed(1) }],
        };
        if (magSev === "crit" && lastLoggedState.current.magnetic_hall !== "crit") {
          const rawAdc = Math.round((magVal / 100.0) * 4095);
          const adcVolt = ((rawAdc / 4095.0) * 3.3).toFixed(2) + " V";
          recordCriticalLog("magnetic_hall", `${magVal.toFixed(1)}% Flux (Anomaly)`, `${rawAdc} ADC`, adcVolt, "Magnetic field disturbance dropped below 70.0% safe line.", "Inspect magnetic splice loop transponders for longitudinal tear.");
        }
        lastLoggedState.current.magnetic_hall = magSev;

        // 3. Proximity / Motion (PIN 27)
        const speedSev = severityOf(SENSOR_DEFS[2], speedVal);
        next.proximity_speed = {
          value: speedVal,
          severity: speedSev,
          history: [...prev.proximity_speed.history.slice(1), { time: new Date().toLocaleTimeString(), v: +speedVal.toFixed(2) }],
        };
        if (speedSev === "crit" && lastLoggedState.current.proximity_speed !== "crit") {
          const rawAdc = proxState === 0 ? 0 : 4095;
          const adcVolt = proxState === 0 ? "0.00 V" : "3.30 V";
          recordCriticalLog("proximity_speed", `${speedVal.toFixed(2)} m/s (ZERO SPEED)`, `${rawAdc} ADC (LOW)`, adcVolt, "Object detected in belt zone / pulley rotation halted below 1.50 m/s.", "Verify loading chute clearance and restart drive motor.");
        }
        lastLoggedState.current.proximity_speed = speedSev;

        // 4. Vibration (PIN 34 ADC > 800)
        const vibVal = piezoVal;
        const vibSev = severityOf(SENSOR_DEFS[3], vibVal);
        next.vibration = {
          value: vibVal,
          severity: vibSev,
          history: [...prev.vibration.history.slice(1), { time: new Date().toLocaleTimeString(), v: vibVal }],
        };
        if (vibSev === "crit" && lastLoggedState.current.vibration !== "crit") {
          const rawAdc = vibVal;
          const adcVolt = ((rawAdc / 4095.0) * 3.3).toFixed(2) + " V";
          recordCriticalLog("vibration", `${vibVal} ADC Peak`, `${rawAdc} ADC`, adcVolt, `Motor vibration exceeded critical limit (Reading: ${vibVal} ADC > 800 ADC threshold).`, "Inspect drive motor mounting, gearbox alignment, and bearing wear.");
        }
        lastLoggedState.current.vibration = vibSev;

        // 5. MLX90614 Temperature (I2C > 40.0°C)
        const tempVal = tempC;
        const tempSev = severityOf(SENSOR_DEFS[4], tempVal);
        next.temperature = {
          value: tempVal,
          severity: tempSev,
          history: [...prev.temperature.history.slice(1), { time: new Date().toLocaleTimeString(), v: +tempVal.toFixed(1) }],
        };
        if (tempSev === "crit" && lastLoggedState.current.temperature !== "crit") {
          const rawAdc = Math.round((tempVal / 100.0) * 4095);
          const adcVolt = ((rawAdc / 4095.0) * 3.3).toFixed(2) + " V";
          recordCriticalLog("temperature", `${tempVal.toFixed(1)} °C`, `${rawAdc} ADC eq.`, adcVolt, `MLX90614 infrared object temp moved above 40.0°C critical line (Reading: ${tempVal.toFixed(1)}°C).`, "Check motor bearing lubrication and cooling airflow.");
        }
        lastLoggedState.current.temperature = tempSev;

        if (buzzerActive && soundEnabled) {
          playAlertChime();
        }

        return next;
      });
    }, tickMs);

    return () => clearInterval(tick);
  }, [tickMs, isEspConnected, espEndpoint, piezoTimer, piezoVal, tempC, irLeft, irRight, magState, proxState, buzzerActive, soundEnabled, recordCriticalLog, productionBridge]);

  // Derived health metrics
  const total = SENSOR_DEFS.length;
  let goodCount = 0, warnCount = 0, critCount = 0, scoreSum = 0;
  SENSOR_DEFS.forEach((s) => {
    const sev = sensorState[s.id]?.severity || "good";
    if (sev === "good") goodCount++;
    else if (sev === "warn") warnCount++;
    else if (sev === "crit") critCount++;
    scoreSum += SCORE_MAP[sev];
  });
  const healthScore = Math.round(scoreSum / total);
  const donutCirc = 2 * Math.PI * 38;
  const segGood = (goodCount / total) * donutCirc;
  const segWarn = (warnCount / total) * donutCirc;
  const segCrit = (critCount / total) * donutCirc;

  const sevColor = (sev) => (sev === "good" ? "var(--color-good)" : sev === "warn" ? "var(--color-warn)" : "var(--color-crit)");

  return (
    <ProductionProvider enabled={PRODUCTION_ENABLED} bridge={productionBridge}>
    <div className="abb-app-container">
      {/* Top Header */}
      <header className="abb-header">
        <div className="abb-header-left">
          <div className="abb-logo-badge">Info X</div>
          <div className="abb-title-group">
            <span className="abb-app-title">Info X Condition Monitoring for belts</span>
            <span className="abb-app-subtitle">Intelligent Belt Condition Monitoring System · ESP32 Hardware Ingest</span>
          </div>
        </div>

        <div className="abb-header-right">
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className="abb-select">
            <option value="English">English</option>
            <option value="Deutsch">Deutsch</option>
            <option value="Español">Español</option>
          </select>

          <button onClick={() => setSoundEnabled(!soundEnabled)} className="abb-icon-btn" title="Alert Chime">
            {soundEnabled ? <Volume2 size={16} color="var(--color-good)" /> : <VolumeX size={16} />}
          </button>

          <button onClick={() => setTheme(theme === "light" ? "dark" : "light")} className="abb-icon-btn" title="Toggle Theme">
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          <div className="abb-time-badge">{now.toLocaleTimeString()}</div>
        </div>
      </header>

      {/* Body with Sidebar */}
      <div className="abb-body-layout">
        <aside className="abb-sidebar">
          <button onClick={() => setActiveView("home")} className={`abb-nav-item ${activeView === "home" ? "active" : ""}`}>
            <Home size={18} className="abb-nav-icon" />
            <span className="abb-nav-label">Home (3D)</span>
          </button>

          <button onClick={() => setActiveView("misalignment")} className={`abb-nav-item ${activeView === "misalignment" ? "active" : ""}`}>
            <MoveHorizontal size={18} className="abb-nav-icon" />
            <span className="abb-nav-label">Misalignment</span>
            <span className="abb-nav-dot" style={{ backgroundColor: sevColor(sensorState.misalignment?.severity) }} />
          </button>

          <button onClick={() => setActiveView("thickness")} className={`abb-nav-item ${activeView === "thickness" ? "active" : ""}`}>
            <Ruler size={18} className="abb-nav-icon" />
            <span className="abb-nav-label">Magnetic</span>
            <span className="abb-nav-dot" style={{ backgroundColor: sevColor(sensorState.magnetic_hall?.severity) }} />
          </button>

          <button onClick={() => setActiveView("speed")} className={`abb-nav-item ${activeView === "speed" ? "active" : ""}`}>
            <Gauge size={18} className="abb-nav-icon" />
            <span className="abb-nav-label">Speed/Motion</span>
            <span className="abb-nav-dot" style={{ backgroundColor: sevColor(sensorState.proximity_speed?.severity) }} />
          </button>

          <button onClick={() => setActiveView("damage")} className={`abb-nav-item ${activeView === "damage" ? "active" : ""}`}>
            <Thermometer size={18} className="abb-nav-icon" />
            <span className="abb-nav-label">Temp &amp; Vib</span>
            <span className="abb-nav-dot" style={{ backgroundColor: sevColor(sensorState.temperature?.severity) }} />
          </button>

          <button onClick={() => setActiveView("alarms")} className={`abb-nav-item ${activeView === "alarms" ? "active" : ""}`}>
            <Bell size={18} className="abb-nav-icon" />
            <span className="abb-nav-label">Alarm Logs</span>
            {buzzerActive && <span className="abb-nav-badge">!</span>}
          </button>

          {PRODUCTION_ENABLED && (
            <button onClick={() => setActiveView("production")} className={`abb-nav-item ${activeView === "production" ? "active" : ""}`}>
              <TrendingUp size={18} className="abb-nav-icon" />
              <span className="abb-nav-label">Production &amp; Prediction</span>
            </button>
          )}

          <div className="abb-sidebar-bottom">
            <button onClick={() => setActiveView("settings")} className={`abb-nav-item ${activeView === "settings" ? "active" : ""}`}>
              <SettingsIcon size={18} className="abb-nav-icon" />
              <span className="abb-nav-label">ESP32 Ingest</span>
            </button>
          </div>
        </aside>

        {/* Content View */}
        <main className="abb-main-content">
          {PRODUCTION_ENABLED && activeView === "production" && <ProductionView />}
          {activeView === "home" && (
            <HomeView
              sensorState={sensorState}
              goTo={setActiveView}
              healthScore={healthScore}
              goodCount={goodCount}
              warnCount={warnCount}
              critCount={critCount}
              total={total}
              donutCirc={donutCirc}
              segGood={segGood}
              segWarn={segWarn}
              segCrit={segCrit}
              isEspConnected={isEspConnected}
              laserState={laserState}
              toggleLaser={toggleLaser}
              currentState={currentState}
              tempC={tempC}
              setTempC={setManualTempC}
              piezoVal={piezoVal}
              triggerPiezoSpike={triggerPiezoSpike}
              irLeft={irLeft}
              setIrLeft={setManualIrLeft}
              irRight={irRight}
              setIrRight={setManualIrRight}
              magState={magState}
              setMagState={setManualMagState}
              proxState={proxState}
              setProxState={setManualProxState}
              buzzerActive={buzzerActive}
            />
          )}

          {activeView === "misalignment" && (
            <div>
              <div className="abb-card">
                <div className="abb-card-header">
                  <div>
                    <h1 style={{ fontSize: 16, fontWeight: 800 }}>IR Misalignment Status (PIN 32 &amp; 33)</h1>
                    <p className="abb-card-subtitle">Critical Threshold: &gt;25.0 mm · 2275 ADC (1.83V)</p>
                  </div>
                  <button onClick={() => setActiveView("home")} className="abb-btn">
                    <ChevronLeft size={16} /> Back to 3D
                  </button>
                </div>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sensorState.misalignment.history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
                      <XAxis dataKey="time" stroke="var(--text-dim)" fontSize={11} />
                      <YAxis stroke="var(--text-dim)" fontSize={11} domain={[0, 45]} unit="mm" />
                      <Tooltip contentStyle={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-color)", borderRadius: 8 }} />
                      <ReferenceLine y={25} stroke="var(--color-crit)" strokeDasharray="4 4" label="Trip (25mm / 2275 ADC)" />
                      <Line type="monotone" dataKey="v" stroke="#3B82F6" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <SensorCriticalLogTable
                sensorDef={SENSOR_DEFS[0]}
                logs={criticalLogs.misalignment || []}
                onClear={clearSensorLogs}
              />
            </div>
          )}

          {activeView === "thickness" && (
            <div>
              <div className="abb-card">
                <div className="abb-card-header">
                  <div>
                    <h1 style={{ fontSize: 16, fontWeight: 800 }}>Magnetic Field &amp; Splice Anomaly (Hall PIN 35)</h1>
                    <p className="abb-card-subtitle">Critical Threshold: &lt;70.0% · 2866 ADC (2.31V)</p>
                  </div>
                  <button onClick={() => setActiveView("home")} className="abb-btn">
                    <ChevronLeft size={16} /> Back to 3D
                  </button>
                </div>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sensorState.magnetic_hall.history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
                      <XAxis dataKey="time" stroke="var(--text-dim)" fontSize={11} />
                      <YAxis stroke="var(--text-dim)" fontSize={11} domain={[40, 100]} unit="%" />
                      <Tooltip contentStyle={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-color)", borderRadius: 8 }} />
                      <ReferenceLine y={70} stroke="var(--color-crit)" strokeDasharray="4 4" label="Limit (70% / 2866 ADC)" />
                      <Line type="monotone" dataKey="v" stroke="var(--color-good)" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <SensorCriticalLogTable
                sensorDef={SENSOR_DEFS[1]}
                logs={criticalLogs.magnetic_hall || []}
                onClear={clearSensorLogs}
              />
            </div>
          )}

          {activeView === "speed" && (
            <div>
              <div className="abb-card">
                <div className="abb-card-header">
                  <div>
                    <h1 style={{ fontSize: 16, fontWeight: 800 }}>Motion &amp; Object Detection (Proximity PIN 27)</h1>
                    <p className="abb-card-subtitle">Critical Threshold: &lt;1.50 m/s / Object Detected (0 ADC)</p>
                  </div>
                  <button onClick={() => setActiveView("home")} className="abb-btn">
                    <ChevronLeft size={16} /> Back to 3D
                  </button>
                </div>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sensorState.proximity_speed.history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
                      <XAxis dataKey="time" stroke="var(--text-dim)" fontSize={11} />
                      <YAxis stroke="var(--text-dim)" fontSize={11} domain={[0, 4]} unit="m/s" />
                      <Tooltip contentStyle={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-color)", borderRadius: 8 }} />
                      <ReferenceLine y={1.5} stroke="var(--color-crit)" strokeDasharray="4 4" label="Halt (1.5 m/s)" />
                      <Line type="monotone" dataKey="v" stroke="#0052CC" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <SensorCriticalLogTable
                sensorDef={SENSOR_DEFS[2]}
                logs={criticalLogs.proximity_speed || []}
                onClear={clearSensorLogs}
              />
            </div>
          )}

          {activeView === "damage" && (
            <div>
              <div className="abb-grid-2">
                <div className="abb-card">
                  <span className="abb-card-title">MLX90614 Temperature (°C) — Threshold: 40.0°C</span>
                  <div style={{ height: 200, marginTop: 10 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sensorState.temperature.history}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
                        <XAxis dataKey="time" stroke="var(--text-dim)" fontSize={11} />
                        <YAxis stroke="var(--text-dim)" fontSize={11} domain={[20, 60]} unit="°C" />
                        <ReferenceLine y={40} stroke="var(--color-crit)" strokeDasharray="4 4" label="Alert (40°C / 1638 ADC)" />
                        <Line type="monotone" dataKey="v" stroke="#F59E0B" strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="abb-card">
                  <span className="abb-card-title">Piezo Vibration Peak (PIN 34 ADC) — Threshold: 800 ADC</span>
                  <div style={{ height: 200, marginTop: 10 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sensorState.vibration.history}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
                        <XAxis dataKey="time" stroke="var(--text-dim)" fontSize={11} />
                        <YAxis stroke="var(--text-dim)" fontSize={11} domain={[0, 4095]} unit="ADC" />
                        <ReferenceLine y={800} stroke="var(--color-crit)" strokeDasharray="4 4" label="Limit (800 ADC / 0.64V)" />
                        <Line type="monotone" dataKey="v" stroke="#8B5CF6" strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <SensorCriticalLogTable
                sensorDef={SENSOR_DEFS[3]}
                logs={criticalLogs.vibration || []}
                onClear={clearSensorLogs}
              />

              <SensorCriticalLogTable
                sensorDef={SENSOR_DEFS[4]}
                logs={criticalLogs.temperature || []}
                onClear={clearSensorLogs}
              />
            </div>
          )}

          {activeView === "alarms" && (
            <AlarmsRegistryView
              criticalLogs={criticalLogs}
              onClearSensorLogs={clearSensorLogs}
              buzzerActive={buzzerActive}
            />
          )}

          {activeView === "settings" && (
            <div className="abb-card">
              <h1 style={{ fontSize: 16, fontWeight: 800, marginBottom: 16 }}>ESP32 Localhost &amp; Wi-Fi Connection Manager</h1>
              <div style={{ backgroundColor: "var(--bg-surface-alt)", border: "1px solid var(--border-color)", borderRadius: 8, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 800 }}>Localhost / Network API Endpoint</span>
                  <span className={`abb-status-badge ${isEspConnected ? "good" : "warn"}`}>
                    {isEspConnected ? "Connected" : "Simulated Stream"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    type="text"
                    value={espEndpoint}
                    onChange={(e) => setEspEndpoint(e.target.value)}
                    placeholder="http://localhost:5000/api/sensors or http://192.168.1.xxx/api/sensors"
                    className="abb-input mono"
                    style={{ flex: 1 }}
                  />
                  <button onClick={() => setIsEspConnected(!isEspConnected)} className={`abb-btn ${isEspConnected ? "" : "primary"}`}>
                    <RefreshCw size={13} /> {isEspConnected ? "Disconnect" : "Connect ESP32"}
                  </button>
                </div>
                {lastEspPayload && (
                  <pre className="mono" style={{ marginTop: 12, padding: 10, backgroundColor: "var(--bg-input)", borderRadius: 6, fontSize: 11, color: "var(--color-good)" }}>
                    {JSON.stringify(lastEspPayload, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
    </ProductionProvider>
  );
}
