import { Environment, Lightformer } from '@react-three/drei'
import { TV } from '../palette'

/**
 * Shared sun direction — the sky dome and the shadow caster must agree.
 * Low over the bay, behind the city from the opening shot, as in the
 * TalkVille render.
 */
export const SUN: [number, number, number] = [80, 72, -120]

interface Props {
  /**
   * Half-size of the shadow frustum. The city needs a wide one; an interior
   * gets a tight one, which is why this is a prop rather than a constant.
   */
  shadowExtent?: number
  intensity?: number
}

/** Golden-hour lighting for the city, matched to the Blender render. */
export function Lighting({ shadowExtent = 150, intensity = 3.2 }: Props) {
  return (
    <>
      {/* Warm sky / green ground bounce, standing in for Blender's sky light. */}
      <hemisphereLight args={[TV.hemiSky, TV.hemiGround, 0.6]} />

      <directionalLight
        position={SUN}
        intensity={intensity}
        color={TV.sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.035}
        shadow-camera-near={1}
        shadow-camera-far={420}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
      />

      {/* Cool fill from the opposite side so shadowed facades keep their form. */}
      <directionalLight position={[-90, 44, 90]} intensity={0.35} color={TV.fill} />

      {/*
        Procedural environment map for glass, metal and water. Rendered once,
        locally — deliberately not a drei `preset`, which would fetch an HDR
        from a CDN.
      */}
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={1.6} color={TV.skyHorizon} scale={[80, 24, 1]} position={[0, 6, -34]} rotation={[0, 0, 0]} />
        <Lightformer form="rect" intensity={2.6} color={TV.sun} scale={[26, 26, 1]} position={[24, 14, -30]} rotation={[0, Math.PI, 0]} />
        <Lightformer form="rect" intensity={1.0} color={TV.skyZenith} scale={[80, 80, 1]} position={[0, 40, 0]} rotation={[Math.PI / 2, 0, 0]} />
        <Lightformer form="rect" intensity={0.5} color={TV.hemiGround} scale={[80, 80, 1]} position={[0, -20, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      </Environment>
    </>
  )
}
