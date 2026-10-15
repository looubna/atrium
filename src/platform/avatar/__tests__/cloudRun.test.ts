import { describe, expect, it } from 'vitest'
import { isCloudRun } from '../liveTalkingRenderer'

describe('isCloudRun', () => {
  it('recognises the Cloud Run face server', () => {
    expect(isCloudRun('https://atrium-face-ecu53mc2bq-uc.a.run.app')).toBe(true)
  })
  it('keeps the VMs on their own path', () => {
    expect(isCloudRun('https://34-136-143-37.sslip.io')).toBe(false)
    expect(isCloudRun('http://localhost:8010')).toBe(false)
    expect(isCloudRun('')).toBe(false)
  })
})
