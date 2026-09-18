import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const OWNER = 'alice'
const OTHER = 'bob'

// Every collection a client may read, instantiated for the owner.
const OWNED_DOCS = [
  'users/alice',
  'users/alice/consents/ai_processing',
  'users/alice/usage/m-2026-09',
  'users/alice/resumes/r1',
  'users/alice/applications/a1',
  'users/alice/applications/a1/blueprints/b1',
  'users/alice/sessions/s1',
  'users/alice/sessions/s1/turns/t1',
  'users/alice/sessions/s1/codeSnapshots/1',
  'users/alice/sessions/s1/evaluations/run1',
  'users/alice/sessions/s1/evaluations/run1/events/ev1',
  'users/alice/competencies/comm.clarity',
  'users/alice/competencyHistory/s1_comm.clarity',
  'users/alice/practice/progress',
  'users/alice/practiceAttempts/x1',
  'users/alice/courses/c1',
  'users/alice/courses/c1/materials/m1',
  'users/alice/courses/c1/analyses/an1',
]

// Server-owned state and any path the rules don't name explicitly.
const SERVER_ONLY_DOCS = [
  'liveSessions/s1',
  'liveLocks/alice',
  'jobs/j1',
  'config/runtime',
  'deletions/h1',
  'rateLimits/k1',
  'users/alice/private/profile',
  'users/alice/sessions/s1/unlistedSubcollection/x',
  'users/alice/applications/a1/blueprints/b1/drafts/d1',
  'users/alice/courses/c1/unlistedSubcollection/x',
]

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-atrium-rules',
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const path of [...OWNED_DOCS, ...SERVER_ONLY_DOCS, 'users/bob', 'users/bob/sessions/s9']) {
      await setDoc(doc(db, path), { seeded: true })
    }
  })
})

afterAll(async () => {
  await env.cleanup()
})

describe('user-owned data', () => {
  it.each(OWNED_DOCS)('owner can read %s', async (path) => {
    const db = env.authenticatedContext(OWNER).firestore()
    await assertSucceeds(getDoc(doc(db, path)))
  })

  it.each(OWNED_DOCS)('another user cannot read %s', async (path) => {
    const db = env.authenticatedContext(OTHER).firestore()
    await assertFails(getDoc(doc(db, path)))
  })

  it.each(OWNED_DOCS)('unauthenticated access to %s is denied', async (path) => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, path)))
  })

  it.each(OWNED_DOCS)('owner cannot write %s from the client', async (path) => {
    const db = env.authenticatedContext(OWNER).firestore()
    await assertFails(setDoc(doc(db, path), { tampered: true }))
    await assertFails(updateDoc(doc(db, path), { tampered: true }))
    await assertFails(deleteDoc(doc(db, path)))
  })

  it('owner cannot create new documents in their own collections', async () => {
    const db = env.authenticatedContext(OWNER).firestore()
    await assertFails(setDoc(doc(db, 'users/alice/sessions/new-session'), { status: 'live' }))
    await assertFails(setDoc(doc(db, 'users/alice/competencies/comm.clarity'), { current: 100 }))
  })

  it('a user cannot create a profile for someone else', async () => {
    const db = env.authenticatedContext(OTHER).firestore()
    await assertFails(setDoc(doc(db, 'users/alice'), { plan: 'internal' }))
  })

  it('custom claims cannot escalate access to another user', async () => {
    const db = env.authenticatedContext(OTHER, { admin: true, role: 'owner', owner: OWNER }).firestore()
    await assertFails(getDoc(doc(db, 'users/alice/sessions/s1')))
    await assertFails(getDocs(collection(db, 'users/alice/sessions')))
  })
})

describe('queries', () => {
  it('owner can list their own sessions', async () => {
    const db = env.authenticatedContext(OWNER).firestore()
    await assertSucceeds(getDocs(collection(db, 'users/alice/sessions')))
  })

  it("a user cannot list another user's sessions", async () => {
    const db = env.authenticatedContext(OWNER).firestore()
    await assertFails(getDocs(collection(db, 'users/bob/sessions')))
  })

  it('nobody can list all users', async () => {
    const db = env.authenticatedContext(OWNER).firestore()
    await assertFails(getDocs(collection(db, 'users')))
  })

  it('collection-group queries across users are denied', async () => {
    const db = env.authenticatedContext(OWNER).firestore()
    await assertFails(getDocs(collectionGroup(db, 'sessions')))
    await assertFails(getDocs(collectionGroup(db, 'events')))
  })
})

describe('server-only data', () => {
  it.each(SERVER_ONLY_DOCS)('%s is not readable by its owner or anyone else', async (path) => {
    for (const ctx of [
      env.authenticatedContext(OWNER),
      env.authenticatedContext(OTHER),
      env.unauthenticatedContext(),
    ]) {
      await assertFails(getDoc(doc(ctx.firestore(), path)))
      await assertFails(setDoc(doc(ctx.firestore(), path), { tampered: true }))
    }
  })

  it('invalid document paths are denied', async () => {
    const db = env.authenticatedContext(OWNER).firestore()
    await assertFails(getDoc(doc(db, 'users/alice/unknown/x')))
    await assertFails(getDoc(doc(db, 'sessions/s1')))
  })
})
