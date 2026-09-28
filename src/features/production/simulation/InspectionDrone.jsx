import React from "react";
import { RoundedBox } from "@react-three/drei";

// Procedural inspection quadcopter: no remote assets or implied camera acquisition.
export default function InspectionDrone({ mission }) {
  const angle = mission.elapsedMissionMs * 0.045;
  return <group>
    <RoundedBox args={[0.72, 0.24, 0.44]} radius={0.09} smoothness={3} castShadow>
      <meshStandardMaterial color="#d5d9d9" metalness={0.4} roughness={0.32} />
    </RoundedBox>
    <RoundedBox args={[0.45, 0.1, 0.32]} radius={0.035} position={[-0.08, 0.16, 0]} castShadow>
      <meshStandardMaterial color="#252d34" metalness={0.25} roughness={0.6} />
    </RoundedBox>
    <mesh position={[0.3, 0.02, 0]}><boxGeometry args={[0.13, 0.15, 0.3]} /><meshStandardMaterial color="#e8a649" metalness={0.4} roughness={0.4} /></mesh>
    {[-1, 1].flatMap(a => [-1, 1].map(b => <group key={`${a}:${b}`}>
      <mesh position={[a * 0.39, 0, b * 0.28]} rotation={[0, -a * b * 0.62, 0]} castShadow>
        <boxGeometry args={[0.65, 0.07, 0.09]} /><meshStandardMaterial color="#283139" metalness={0.6} roughness={0.42} />
      </mesh>
      <group position={[a * 0.62, 0.06, b * 0.44]}>
        <mesh castShadow><cylinderGeometry args={[0.075, 0.065, 0.13, 20]} /><meshStandardMaterial color="#606b74" metalness={0.8} roughness={0.25} /></mesh>
        <group rotation={[0, angle * a * b, 0]} position={[0, 0.08, 0]}>
          <mesh castShadow><boxGeometry args={[0.53, 0.015, 0.045]} /><meshStandardMaterial color="#1c252a" metalness={0.25} roughness={0.5} /></mesh>
          <mesh><sphereGeometry args={[0.045, 12, 8]} /><meshStandardMaterial color="#8e999f" metalness={0.8} roughness={0.3} /></mesh>
        </group>
        <mesh position={[0, -0.09, 0]}><sphereGeometry args={[0.028, 8, 8]} /><meshStandardMaterial color={a > 0 ? "#6dd8bd" : "#e8584c"} emissive={a > 0 ? "#6dd8bd" : "#e8584c"} emissiveIntensity={1.5} /></mesh>
      </group>
    </group>))}
    {[-1, 1].map(side => <group key={side} position={[0, -0.22, side * 0.22]}>
      {[-0.2, 0.2].map(x => <mesh key={x} position={[x, 0, 0]} castShadow><cylinderGeometry args={[0.025, 0.025, 0.35, 10]} /><meshStandardMaterial color="#2a343c" metalness={0.5} roughness={0.5} /></mesh>)}
      <mesh position={[0, -0.17, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.03, 0.03, 0.68, 10]} /><meshStandardMaterial color="#2a343c" /></mesh>
    </group>)}
    <mesh position={[0.18, -0.21, 0]} castShadow><sphereGeometry args={[0.105, 20, 12]} /><meshStandardMaterial color="#424c53" metalness={0.65} roughness={0.3} /></mesh>
    <mesh position={[0.27, -0.22, 0]} rotation={[0, 0, -Math.PI / 2]}><cylinderGeometry args={[0.058, 0.065, 0.055, 20]} /><meshStandardMaterial color="#132a38" metalness={0.85} roughness={0.12} /></mesh>
  </group>;
}
