import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

type Loader = () => Promise<{ default: ComponentType }>

/**
 * Interiors are code-split and never part of the city bundle. One entry per
 * location that has one; `hasInterior` in the dataset must agree.
 */
const LOADERS: Record<string, Loader> = {
  company: () => import('./CompanyInterior'),
  university: () => import('./UniversityInterior'),
}

export const INTERIORS: Record<string, LazyExoticComponent<ComponentType>> = Object.fromEntries(
  Object.entries(LOADERS).map(([id, load]) => [id, lazy(load)]),
)

/** Warm the chunk while the user is still reading the location panel. */
export const preloadInterior = (id: string | null) => {
  if (id) void LOADERS[id]?.()
}
