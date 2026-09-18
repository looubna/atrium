import { readFileSync } from 'node:fs'
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteObject, getBytes, getMetadata, ref, uploadBytes } from 'firebase/storage'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const OBJECTS = [
  'users/alice/resumes/r1/original.pdf',
  'users/alice/sessions/s1/audio.m4a',
  'users/alice/sessions/s1/video-u1.mp4',
  'users/alice/sessions/s1/transcript.json',
  'users/alice/sessions/s1/evaluations/run1.json',
]

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-atrium-rules',
    storage: {
      rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  })
})

beforeEach(async () => {
  await env.clearStorage()
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const path of OBJECTS) {
      await uploadBytes(ref(ctx.storage(), path), new Uint8Array([1, 2, 3]))
    }
  })
})

afterAll(async () => {
  await env.cleanup()
})

describe('Cloud Storage is not reachable from clients', () => {
  it.each(OBJECTS)('owner cannot read %s directly (signed URLs only)', async (path) => {
    const storage = env.authenticatedContext('alice').storage()
    await assertFails(getBytes(ref(storage, path)))
    await assertFails(getMetadata(ref(storage, path)))
  })

  it.each(OBJECTS)('another user cannot read %s', async (path) => {
    const storage = env.authenticatedContext('bob').storage()
    await assertFails(getBytes(ref(storage, path)))
  })

  it.each(OBJECTS)('unauthenticated access to %s is denied', async (path) => {
    const storage = env.unauthenticatedContext().storage()
    await assertFails(getBytes(ref(storage, path)))
  })

  it('nobody can upload, overwrite or delete objects', async () => {
    for (const uid of ['alice', 'bob']) {
      const storage = env.authenticatedContext(uid).storage()
      await assertFails(uploadBytes(ref(storage, 'users/alice/sessions/s1/audio.m4a'), new Uint8Array([9])))
      await assertFails(uploadBytes(ref(storage, `users/${uid}/sessions/new/video.mp4`), new Uint8Array([9])))
      await assertFails(deleteObject(ref(storage, 'users/alice/resumes/r1/original.pdf')))
    }
  })

  it('path manipulation does not grant access', async () => {
    const storage = env.authenticatedContext('bob').storage()
    await assertFails(getBytes(ref(storage, 'users/bob/../alice/sessions/s1/audio.m4a')))
  })
})
