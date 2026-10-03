import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bounds, OrbitControls, ContactShadows } from '@react-three/drei'
import type { Group } from 'three'
import type { Context, Pair, Sample, Scenario } from './domain'

const positions: [number, number, number][] = [[-1.35, 0.48, 0.68], [0, 0.48, 0.68], [1.35, 0.48, 0.68], [-1.35, 0.48, -0.68], [0, 0.48, -0.68], [1.35, 0.48, -0.68]]
function Fan({ position, speed }: { position: [number, number, number]; speed: number }) {
  const rotor = useRef<Group>(null)
  useFrame((_state, delta) => { if (rotor.current) rotor.current.rotation.z += delta * speed * 14 })
  return <group position={position} rotation={[Math.PI / 2, 0, 0]}>
    <mesh><torusGeometry args={[0.32, 0.045, 12, 32]} /><meshStandardMaterial color="#424f4a" /></mesh>
    <group ref={rotor}>{[0, Math.PI / 3, Math.PI * 2 / 3].map(angle => <mesh key={angle} rotation={[0, 0, angle]}><boxGeometry args={[0.53, 0.065, 0.04]} /><meshStandardMaterial color="#c3d4cc" /></mesh>)}</group>
  </group>
}
function Flow({ fans, active, context }: { fans: Pair; active: boolean; context: Context }) {
  const particles = useRef<Group>(null)
  const particleColor = context === 'NORMAL' ? '#279db5' : '#b99b3e'
  useFrame(state => {
    particles.current?.children.forEach((particle, index) => {
      const fan = fans[index % 2]
      particle.visible = active && fan > 0
      particle.position.z = -1.55 + ((state.clock.elapsedTime * fan * 0.8 + index * 0.18) % 3.05)
    })
  })
  return <group ref={particles}>{Array.from({ length: 24 }, (_, index) => <mesh key={index} position={[index % 2 === 0 ? -0.75 : 0.75, 0.24 + (index % 4) * 0.26, 0]}><sphereGeometry args={[0.035, 8, 8]} /><meshBasicMaterial color={particleColor} /></mesh>)}</group>
}
function Geometry({ sample, scenario, animate, context, highlightZone }: { sample: Sample; scenario: Scenario; animate: boolean; context: Context; highlightZone: number }) {
  return <>
    <ambientLight intensity={1.1} /><directionalLight position={[4, 7, 4]} intensity={2} castShadow shadow-mapSize={[1024, 1024]} />
    <Bounds fit clip observe margin={1.18}><group>
      <mesh receiveShadow position={[0, -0.05, 0]}><boxGeometry args={[4.6, 0.12, 3.6]} /><meshStandardMaterial color="#dce5df" /></mesh>
      <mesh position={[0, 0.72, -1.72]}><boxGeometry args={[4.6, 1.5, 0.09]} /><meshStandardMaterial color="#e7eeea" /></mesh>
      <mesh position={[-2.25, 0.72, 0]}><boxGeometry args={[0.08, 1.5, 3.4]} /><meshStandardMaterial color="#d4dfd7" transparent opacity={0.32} /></mesh>
      <mesh position={[2.25, 0.72, 0]}><boxGeometry args={[0.08, 1.5, 3.4]} /><meshStandardMaterial color="#d4dfd7" transparent opacity={0.24} /></mesh>
      {positions.map((position, index) => {
        const warm = sample.temperatures[index] > 8
        const selected = index === highlightZone
        const color = warm ? '#e87654' : sample.temperatures[index] < 4 ? '#62b9d6' : '#80af95'
        return <group key={index} position={position}>
          <mesh castShadow><boxGeometry args={[1.05, 0.78, 0.88]} /><meshStandardMaterial color={color} emissive={selected ? '#d8a548' : warm ? '#8f3d2d' : '#000000'} emissiveIntensity={selected ? 0.3 : warm ? 0.08 : 0} roughness={0.85} /></mesh>
          {selected && <mesh position={[0, 0.43, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.43, 0.025, 8, 24]} /><meshBasicMaterial color="#d8a548" /></mesh>}
          {[0, 1, 2, 3].map(vent => <mesh key={vent} position={[-0.36 + vent * 0.24, 0, 0.447]}><boxGeometry args={[0.11, 0.49, 0.012]} /><meshStandardMaterial color="#364c41" /></mesh>)}
          <mesh position={[0, 0.42, 0]}><boxGeometry args={[1.09, 0.06, 0.92]} /><meshStandardMaterial color="#cad6ce" /></mesh>
        </group>
      })}
      {(scenario === 'partial' || scenario === 'blocked') && <mesh position={[-1.4, 0.59, -0.02]} castShadow><boxGeometry args={[1.12, scenario === 'blocked' ? 1.1 : 0.42, 0.08]} /><meshStandardMaterial color="#756b57" /></mesh>}
      <Fan position={[-0.75, 1.1, -1.62]} speed={animate ? sample.fans[0] : 0} /><Fan position={[0.75, 1.1, -1.62]} speed={animate ? sample.fans[1] : 0} />
      <Flow fans={sample.fans} active={animate} context={context} />
      <mesh position={[0, 0.25, -1.4]}><boxGeometry args={[2.2, 0.32, 0.38]} /><meshStandardMaterial color="#a5c6ce" /></mesh>
      <mesh position={[2.53, 0.25, 1]}><boxGeometry args={[0.45, 0.4, 0.65]} /><meshStandardMaterial color="#304d3e" /></mesh>
    </group></Bounds>
    <ContactShadows position={[0, -0.12, 0]} opacity={0.25} scale={10} blur={2.5} far={4} />
    <OrbitControls makeDefault minDistance={5.5} maxDistance={10} minPolarAngle={0.35} maxPolarAngle={Math.PI / 2.05} minAzimuthAngle={-Math.PI / 2.2} maxAzimuthAngle={Math.PI / 2.2} enablePan={false} autoRotate={animate} autoRotateSpeed={0.35} />
  </>
}
export default function Chamber({ sample, scenario, animate, context, highlightZone, resetToken }: { sample: Sample; scenario: Scenario; animate: boolean; context: Context; highlightZone: number; resetToken: number }) {
  return <div className="concept-canvas" role="img" aria-label="Interactive ColdFlow chamber concept, simulated air temperatures; 3D concept and simulation only"><Canvas key={resetToken} shadows camera={{ position: [6, 5.5, 7], fov: 39 }} gl={{ preserveDrawingBuffer: true, antialias: true }} dpr={[1, 1.5]}><color attach="background" args={['#f1f5f0']} /><Geometry sample={sample} scenario={scenario} animate={animate} context={context} highlightZone={highlightZone} /></Canvas></div>
}
