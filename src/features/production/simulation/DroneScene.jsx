import React, { useEffect } from "react";
import { Html } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";

function ContextGuard({ onFailure }) {
  const { gl } = useThree();
  useEffect(() => {
    const lost = event => { event.preventDefault(); onFailure(); };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => gl.domElement.removeEventListener("webglcontextlost", lost);
  }, [gl, onFailure]);
  return null;
}

function CameraRig({ mode, position, targetPosition }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    const target = mode === "follow" ? position : mode === "waypoint" ? targetPosition : 0;
    camera.position.set(target + (mode === "overview" ? 3 : 2), mode === "overview" ? 8 : 4, mode === "overview" ? 11 : 5);
    camera.lookAt(target, 0.4, 0);
    invalidate();
  }, [camera, invalidate, mode, position, targetPosition]);
  return null;
}

export default function DroneScene({ mission, markers, onFailure, cameraMode }) {
  const scale = 12 / (mission.registry.lengthKm * 1000);
  const x = positionM => positionM * scale - 6;
  const altitude = mission.phase === "idle" || mission.phase === "complete" ? 0.22 : mission.phase === "takingOff"
    ? 0.22 + 1.1 * mission.phaseElapsedMs / mission.config.takeoffMs : mission.phase === "returning" && mission.positionM === mission.registry.baseKm * 1000
      ? 1.32 - 1.1 * mission.phaseElapsedMs / mission.config.landingMs : 1.32;
  // All geometries/materials are declarative R3F resources, automatically disposed on unmount.
  return <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: [4, 8, 11], fov: 48 }} gl={{ antialias: true, powerPreference: "low-power" }}>
    <CameraRig mode={cameraMode} position={x(mission.positionM)} targetPosition={x((mission.route[mission.waypointIndex]?.km ?? mission.registry.baseKm) * 1000)} />
    <color attach="background" args={["#19242d"]} />
    <ContextGuard onFailure={onFailure} />
    <ambientLight intensity={1.2} /><directionalLight position={[4, 8, 5]} intensity={2} />
    <mesh position={[0, -0.1, 0]}><boxGeometry args={[12, 0.12, 0.5]} /><meshStandardMaterial color="#39414a" /></mesh>
    <mesh position={[0, -0.8, 0]}><boxGeometry args={[18, 0.1, 8]} /><meshStandardMaterial color="#26343c" roughness={1} /></mesh>
    {[-0.32, 0.32].map(z => <mesh key={z} position={[0, -0.18, z]}><boxGeometry args={[12, 0.18, 0.06]} /><meshStandardMaterial color="#82909b" /></mesh>)}
    {Array.from({ length: 25 }, (_, i) => <group key={i} position={[i * 0.5 - 6, -0.22, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.09, 0.09, 0.65, 10]} /><meshStandardMaterial color="#647580" /></mesh>
      {i % 4 === 0 && [-0.26, 0.26].map(z => <mesh key={z} position={[0, -0.23, z]}><boxGeometry args={[0.1, 0.5, 0.1]} /><meshStandardMaterial color="#778690" /></mesh>)}
    </group>)}
    {markers.map(marker => <group key={marker.id} position={[x(marker.km * 1000), 0, -0.7]}>
      <mesh position={[0, 0.4, 0]}><cylinderGeometry args={[0.035, 0.035, 0.8, 8]} /><meshStandardMaterial color="#9ba7b4" /></mesh>
      <Html position={[0, 1.3, 0]} center><span className="prod-scene-label">{marker.id}</span></Html>
      <mesh position={[0, 0.9, 0]}><sphereGeometry args={[0.14, 12, 8]} /><meshStandardMaterial color={marker.color} /></mesh>
    </group>)}
    <group position={[x(mission.positionM), altitude, 0]} scale={1.5}>
      {[-1, 1].map(side => <mesh key={side} rotation={[0, side * Math.PI / 4, 0]}><boxGeometry args={[0.7, 0.05, 0.05]} /><meshStandardMaterial color="#e1e8ed" /></mesh>)}
      <mesh><boxGeometry args={[0.35, 0.14, 0.24]} /><meshStandardMaterial color="#d7e3eb" /></mesh>
      {[-1, 1].flatMap(a => [-1, 1].map(b => <group key={`${a}:${b}`} position={[a * 0.25, 0.02, b * 0.22]}>
        <mesh><cylinderGeometry args={[0.045, 0.045, 0.13, 8]} /><meshStandardMaterial color="#abb5bf" /></mesh>
        <mesh position={[0, 0.075, 0]}><cylinderGeometry args={[0.16, 0.16, 0.018, 12]} /><meshStandardMaterial color="#dd3344" /></mesh>
      </group>))}
    </group>
  </Canvas>;
}
