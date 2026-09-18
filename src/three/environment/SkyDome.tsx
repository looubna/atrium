import { useMemo } from 'react'
import { BackSide, Color, ShaderMaterial, Vector3 } from 'three'
import { P } from '../palette'

const vert = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const frag = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uBelow;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  varying vec3 vWorld;

  void main() {
    vec3 dir = normalize(vWorld);
    float h = dir.y;

    vec3 col;
    if (h >= 0.0) {
      // Above the horizon: warm band giving way to a cool zenith.
      col = mix(uHorizon, uMid, pow(h, 0.42));
      col = mix(col, uZenith, pow(h, 1.25));
    } else {
      // Below it. An elevated overview looks entirely below the horizon line,
      // so this half has to be a designed backdrop rather than a flat fill —
      // otherwise the whole background collapses to one colour.
      col = mix(uHorizon, uBelow, pow(smoothstep(0.0, -0.75, h), 0.85));
    }

    // Broad sun bloom, no hard disc — the sun itself stays offscreen.
    float sun = max(dot(dir, normalize(uSun)), 0.0);
    col += uSunColor * pow(sun, 7.0) * 0.30;
    col += uSunColor * pow(sun, 2.0) * 0.045;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface SkyColors {
  zenith: string
  mid: string
  horizon: string
  below: string
  sun: string
}

/** The daylight sky used by the interiors' outside views. */
const DAYLIGHT: SkyColors = {
  zenith: P.skyZenith,
  mid: P.skyMid,
  horizon: P.skyHorizon,
  below: P.backdrop,
  sun: P.sunTint,
}

interface Props {
  sun: [number, number, number]
  colors?: SkyColors
}

export function SkyDome({ sun, colors = DAYLIGHT }: Props) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        side: BackSide,
        depthWrite: false,
        uniforms: {
          uZenith: { value: new Color(colors.zenith) },
          uMid: { value: new Color(colors.mid) },
          uHorizon: { value: new Color(colors.horizon) },
          uBelow: { value: new Color(colors.below) },
          uSunColor: { value: new Color(colors.sun) },
          uSun: { value: new Vector3(...sun) },
        },
      }),
    [sun, colors],
  )

  return (
    <mesh material={material} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[900, 32, 16]} />
    </mesh>
  )
}
