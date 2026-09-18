import type { ComponentType } from 'react'
import type { BuildingKind } from '@/data/types'
import { Auditorium, Campus, PracticeHall, Tower, type ShapeProps } from './shapes/Civic'
import { Cafe, Mall, Mart, Restaurant } from './shapes/Commerce'
import { BusStop, House, Park } from './shapes/Domestic'

/**
 * Kind → exterior. Adding a location to `data/locations.ts` and a component
 * here is the whole job of adding a place to the city.
 */
export const EXTERIORS: Record<BuildingKind, ComponentType<ShapeProps>> = {
  tower: Tower,
  campus: Campus,
  auditorium: Auditorium,
  practice: PracticeHall,
  mall: Mall,
  mart: Mart,
  cafe: Cafe,
  restaurant: Restaurant,
  house: House,
  busStop: BusStop,
  park: Park,
}
