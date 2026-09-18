import { Suspense, useEffect } from 'react'
import { AdaptiveDpr } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { ACESFilmicToneMapping, NeutralToneMapping } from 'three'
import { useAppStore } from '@/state/useAppStore'
import { CameraRig } from './camera/CameraRig'
import { City } from './city/City'
import { Lighting, SUN } from './environment/Lighting'
import { SkyDome, type SkyColors } from './environment/SkyDome'
import { INTERIORS } from './interiors/registry'
import { TV } from './palette'

const CITY_SKY: SkyColors = {
  zenith: TV.skyZenith,
  mid: TV.skyMid,
  horizon: TV.skyHorizon,
  below: TV.backdrop,
  sun: TV.sun,
}

/**
 * The city uses Khronos PBR Neutral, which keeps the model's authored colours
 * as saturated as they were in Blender — three's AgX lacks the contrast look
 * the render used and washes the city out. Interiors keep the ACES grade they
 * were lit for. Materials recompile on their own when the mapping changes.
 */
function useToneMapping(indoors: boolean) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.toneMapping = indoors ? ACESFilmicToneMapping : NeutralToneMapping
    gl.toneMappingExposure = indoors ? 1.06 : 0.95
  }, [gl, indoors])
}

/**
 * Swaps between the city and an interior. Only one is ever mounted: an interior
 * is a separate scene graph, not a room hidden inside the city, which is what
 * keeps the overview cheap as interiors get more detailed.
 */
function Scene() {
  const view = useAppStore((s) => s.view)
  const selectedId = useAppStore((s) => s.selectedId)

  const indoors = view === 'interior' || view === 'exiting'
  const Interior = indoors && selectedId ? INTERIORS[selectedId] : null
  useToneMapping(Boolean(Interior))

  return (
    <>
      <CameraRig />
      {Interior ? (
        <Suspense fallback={null}>
          <Interior />
        </Suspense>
      ) : (
        <>
          <SkyDome sun={SUN} colors={CITY_SKY} />
          <Lighting />
          <City />
        </>
      )}
    </>
  )
}

/** Clears hover when the pointer leaves the canvas entirely. */
function usePointerLeaveReset() {
  const hover = useAppStore((s) => s.hover)
  useEffect(() => {
    const onLeave = () => hover(null)
    window.addEventListener('blur', onLeave)
    return () => window.removeEventListener('blur', onLeave)
  }, [hover])
}

export function Experience() {
  usePointerLeaveReset()
  const deselect = useAppStore((s) => s.deselect)
  const view = useAppStore((s) => s.view)
  // Full-screen footage (the meeting room) hides the scene: stop drawing it.
  const covered = useAppStore((s) => s.sceneCovered)

  return (
    <Canvas
      frameloop={covered ? 'never' : 'always'}
      shadows="soft"
      // Up to 2x so the model's thin edges (cables, mullions, labels' leaders)
      // stay crisp on phone screens; AdaptiveDpr backs off under load.
      dpr={[1, 2]}
      camera={{ fov: 42, near: 1.2, far: 1600, position: [126, 118, 192] }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      performance={{ min: 0.5 }}
      // Clicking empty ground is the natural "never mind" gesture.
      onPointerMissed={() => {
        if (view === 'location') deselect()
      }}
    >
      <color attach="background" args={[TV.skyHorizon]} />
      {/* Starts beyond the bay so the far shore and mountains keep their colour. */}
      <fog attach="fog" args={[TV.fog, 450, 1600]} />
      <Scene />
      <AdaptiveDpr />
    </Canvas>
  )
}
