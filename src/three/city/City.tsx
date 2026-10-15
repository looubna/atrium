import { Suspense } from 'react'
import { CATEGORIES, LOCATIONS } from '@/data/locations'
import { InteractiveLocation } from '../buildings/InteractiveLocation'
import { EXTERIORS } from '../buildings/registry'
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
      {/* Places added after the Blender export stand on their own drawn exteriors. */}
      {LOCATIONS.filter((l) => l.exterior).map((location) => {
        const Exterior = EXTERIORS[location.kind]
        return (
          <group key={`${location.id}-exterior`} position={location.position} rotation={[0, location.rotation ?? 0, 0]}>
            <Exterior accent={CATEGORIES[location.category].color} />
          </group>
        )
      })}
      {LOCATIONS.map((location) => (
        <InteractiveLocation key={location.id} location={location} />
      ))}
    </group>
  )
}
