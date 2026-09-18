import { Suspense } from 'react'
import { LOCATIONS } from '@/data/locations'
import { InteractiveLocation } from '../buildings/InteractiveLocation'
import { TalkVilleModel } from './TalkVilleModel'

/**
 * The city overview. The static fabric is the Blender-built TalkVille model;
 * on top of it sits one InteractiveLocation per entry in the dataset — adding a
 * place to `data/locations.ts` puts it on the map with hover, selection, label
 * and camera framing already wired.
 */
export function City() {
  return (
    <group>
      <Suspense fallback={null}>
        <TalkVilleModel />
      </Suspense>
      {LOCATIONS.map((location) => (
        <InteractiveLocation key={location.id} location={location} />
      ))}
    </group>
  )
}
