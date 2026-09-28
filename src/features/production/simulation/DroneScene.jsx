import React, { useEffect, useRef } from "react";
import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import InspectionDrone from "./InspectionDrone";

function ContextGuard({ onFailure }) {
  const { gl } = useThree();
  useEffect(() => {
    const lost = event => { event.preventDefault(); onFailure(); };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => gl.domElement.removeEventListener("webglcontextlost", lost);
  }, [gl, onFailure]);
  return null;
}

function CameraRig({ mode, position, targetPosition, resetKey }) {
  const controls = useRef();
  const { camera, invalidate } = useThree();
  useEffect(() => {
    const target = mode === "follow" ? position : mode === "waypoint" ? targetPosition : 0;
    const wide = mode === "overview";
    camera.position.set(target + (wide ? 6 : 3), wide ? 8 : 3.7, wide ? 12 : 4.3);
    controls.current?.target.set(target, wide ? 0 : 0.5, wide ? 0 : 1.1);
    controls.current?.update();
    invalidate();
    // Orbit remains user-controlled until the selected view or its tracked target changes.
  }, [camera, invalidate, mode, mode === "follow" ? position : null, mode === "waypoint" ? targetPosition : null, resetKey]);
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} minDistance={2} maxDistance={27} maxPolarAngle={Math.PI * 0.48} />;
}

function Conveyor() {
  return <group>
    <mesh receiveShadow position={[0, 0, 0]}><boxGeometry args={[16, 0.12, 0.72]} /><meshStandardMaterial color="#252c2c" roughness={0.94} /></mesh>
    {[-0.46, 0.46].map(z => <mesh key={z} position={[0, -0.12, z]} castShadow><boxGeometry args={[16, 0.22, 0.09]} /><meshStandardMaterial color="#86918a" metalness={0.65} roughness={0.56} /></mesh>)}
    {Array.from({ length: 33 }, (_, i) => <group key={i} position={[i * 0.5 - 8, -0.14, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.12, 0.12, 0.96, 12]} /><meshStandardMaterial color="#717a76" metalness={0.7} roughness={0.5} /></mesh>
      {i % 4 === 0 && <group>
        {[-0.42, 0.42].map(z => <mesh key={z} position={[0, -0.46, z]} castShadow><boxGeometry args={[0.1, 0.86, 0.1]} /><meshStandardMaterial color="#7b8883" metalness={0.6} roughness={0.55} /></mesh>)}
        <mesh position={[0, -0.6, 0]} rotation={[Math.PI / 4, 0, 0]} castShadow><boxGeometry args={[0.065, 1, 0.065]} /><meshStandardMaterial color="#68766d" metalness={0.6} roughness={0.5} /></mesh>
      </group>}
    </group>)}
    {Array.from({ length: 80 }, (_, i) => <mesh key={i} position={[-7.8 + i * 0.196, 0.11 + (i % 3) * 0.015, Math.sin(i * 2.4) * 0.22]} rotation={[i, i * 0.7, 0]} scale={[0.13, 0.09, 0.1]} castShadow>
      <dodecahedronGeometry args={[1, 0]} /><meshStandardMaterial color={i % 2 ? "#696057" : "#807065"} roughness={1} />
    </mesh>)}
    <mesh position={[-7.7, 0.48, 0]} castShadow><cylinderGeometry args={[0.65, 0.25, 0.7, 4]} /><meshStandardMaterial color="#87928a" metalness={0.5} roughness={0.6} /></mesh>
    <mesh position={[7.8, -0.14, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.3, 0.3, 1.1, 24]} /><meshStandardMaterial color="#ac975e" metalness={0.5} roughness={0.6} /></mesh>
  </group>;
}

export default function DroneScene({ mission, markers, onFailure, cameraMode, selectedNode, onSelectNode, resetKey }) {
  const x = positionM => positionM * 16 / (mission.registry.lengthKm * 1000) - 8;
  const landed = -0.42;
  const altitude = mission.phase === "idle" || mission.phase === "complete" ? landed : mission.phase === "takingOff"
    ? landed + 2.5 * mission.phaseElapsedMs / mission.config.takeoffMs : mission.phase === "returning" && mission.positionM === mission.registry.baseKm * 1000
      ? landed + 2.5 * (1 - mission.phaseElapsedMs / mission.config.landingMs) : landed + 2.5;
  const target = markers.find(marker => marker.id === selectedNode) ?? mission.route[mission.waypointIndex] ?? markers[0];
  return <Canvas shadows frameloop="demand" dpr={[1, 1.5]} camera={{ position: [6, 8, 12], fov: 45 }} gl={{ antialias: true, powerPreference: "low-power" }}>
    <CameraRig mode={cameraMode} position={x(mission.positionM)} targetPosition={x(target.km * 1000)} resetKey={resetKey} />
    <color attach="background" args={["#b4c2c8"]} />
    <fog attach="fog" args={["#b4c2c8", 24, 65]} />
    <ContextGuard onFailure={onFailure} />
    <hemisphereLight args={["#dceeff", "#5f594a", 2.2]} />
    <directionalLight castShadow position={[-5, 12, 6]} intensity={3} shadow-mapSize={[1024, 1024]} shadow-camera-left={-13} shadow-camera-right={13} shadow-camera-top={10} shadow-camera-bottom={-10} shadow-normalBias={0.04} />
    <mesh receiveShadow position={[0, -1, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[160, 160]} /><meshStandardMaterial color="#817e6c" roughness={1} /></mesh>
    <mesh receiveShadow position={[0, -0.97, 0]}><boxGeometry args={[20, 0.06, 4]} /><meshStandardMaterial color="#a8a392" roughness={1} /></mesh>
    <mesh receiveShadow position={[0, -0.94, 2.5]}><boxGeometry args={[24, 0.06, 1.6]} /><meshStandardMaterial color="#686b67" roughness={1} /></mesh>
    {Array.from({ length: 12 }, (_, i) => <mesh key={i} position={[i * 2 - 11, -0.902, 2.5]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.8, 0.035]} /><meshStandardMaterial color="#d8ceb0" /></mesh>)}
    {[-10, 10].map(side => <group key={side} position={[side, -0.8, -5]}><mesh castShadow position={[0, 0.7, 0]}><boxGeometry args={[2.5, 1.4, 2]} /><meshStandardMaterial color="#8c9a96" metalness={0.3} roughness={0.8} /></mesh><mesh position={[0, 1.43, 0]}><boxGeometry args={[2.7, 0.1, 2.2]} /><meshStandardMaterial color="#505e61" /></mesh></group>)}
    <mesh position={[-8, -0.9, 1.1]} receiveShadow><cylinderGeometry args={[0.85, 0.85, 0.1, 48]} /><meshStandardMaterial color="#34474b" roughness={0.9} /></mesh>
    <mesh position={[-8, -0.84, 1.1]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.67, 0.7, 48]} /><meshStandardMaterial color="#e1c776" /></mesh>
    <Conveyor />
    {markers.map(marker => <group key={marker.id} position={[x(marker.km * 1000), 0, -0.8]}>
      <mesh position={[0, 0.4, 0]} castShadow><cylinderGeometry args={[0.035, 0.035, 0.8, 8]} /><meshStandardMaterial color="#aab3ae" metalness={0.7} roughness={0.4} /></mesh>
      <Html position={[0, 1.05, 0]} center><button className={`prod-scene-node ${selectedNode === marker.id ? "is-selected" : ""}`} onClick={() => onSelectNode(marker.id)} aria-label={`Focus ${marker.id}: ${marker.label}`} style={{ "--node-color": marker.color }}><span />{marker.id}</button></Html>
      <mesh position={[0, 0.82, 0]}><sphereGeometry args={[0.085, 12, 8]} /><meshStandardMaterial color={marker.color} emissive={marker.color} emissiveIntensity={0.6} /></mesh>
    </group>)}
    <group position={[x(mission.positionM), altitude, 1.1]} rotation={[0, mission.phase === "returning" ? Math.PI : 0, mission.phase === "travelling" ? -0.045 : 0]}>
      <InspectionDrone mission={mission} />
    </group>
  </Canvas>;
}
