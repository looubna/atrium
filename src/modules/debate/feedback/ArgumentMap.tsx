import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { IconCheck, IconTarget } from '@/components/ui/Icon'
import { firebase, firebaseConfigured } from '@/platform/firebase'
import { useLiveDocument } from '@/platform/firestore/live'
import {
  FLAG_LABEL,
  GOOD_FLAGS,
  type ArgumentFlag,
  type ArgumentMap as ArgumentMapData,
  type MapArgument,
  type NextPractice,
} from '@/modules/debate/api'

/**
 * How the debate actually unfolded (§27).
 *
 * Every mark here was recorded by the server while the debate ran, not worked out afterwards
 * from a transcript: "you never answered this", "this rested on an assumption", "this
 * contradicted what you said earlier". That is why it can be trusted to agree with the
 * debate the user remembers having.
 *
 * Clicking anything jumps the recording to the moment it happened (§28).
 */

/** The session document carries the map; the client reads its own sessions directly. */
interface DebateSessionDoc {
  id: string
  argumentMap?: ArgumentMapData
  debatePatterns?: { id: string; label: string }[]
  nextPractice?: NextPractice
}

function flagTone(flag: ArgumentFlag): string {
  if (GOOD_FLAGS.includes(flag)) return 'border-jade-400/30 bg-jade-500/12 text-jade-400'
  if (flag === 'unanswered' || flag === 'contradicted' || flag === 'evaded') {
    return 'border-[#fca5a5]/30 bg-[#fca5a5]/10 text-[#fca5a5]'
  }
  return 'border-[#fbbf24]/25 bg-[#fbbf24]/8 text-[#fbbf24]'
}

function Flag({ flag }: { flag: ArgumentFlag }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
        flagTone(flag),
      )}
    >
      {GOOD_FLAGS.includes(flag) && <IconCheck width={10} height={10} />}
      {FLAG_LABEL[flag]}
    </span>
  )
}

const clock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function Jump({ atMs, onSeek, children }: { atMs: number; onSeek?: (ms: number) => void; children: React.ReactNode }) {
  if (!onSeek) return <>{children}</>
  return (
    <button
      type="button"
      onClick={() => onSeek(atMs)}
      className="text-left underline-offset-2 transition-colors hover:text-chalk hover:underline"
    >
      {children}
    </button>
  )
}

/** One of the user's arguments, with the objections put to it hanging off it. */
function ArgumentNode({ argument, onSeek }: { argument: MapArgument; onSeek?: (ms: number) => void }) {
  return (
    <li className="relative pl-4 before:absolute before:left-0 before:top-[0.6rem] before:h-px before:w-2.5 before:bg-white/15">
      <div className="rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0 font-mono text-[10.5px] tabular-nums text-faint">
            <Jump atMs={argument.atMs} onSeek={onSeek}>
              {clock(argument.atMs)}
            </Jump>
          </span>
          <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug text-chalk">
            <Jump atMs={argument.atMs} onSeek={onSeek}>
              {argument.claim}
            </Jump>
          </span>
        </div>

        {argument.flags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {argument.flags.map((flag) => (
              <Flag key={flag} flag={flag} />
            ))}
          </div>
        )}

        {argument.evidence.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {argument.evidence.map((item) => (
              <li key={item.text} className="text-[11px] leading-snug text-mist">
                Evidence: {item.text}
                {!item.specific && <span className="text-faint"> — no source or figure given</span>}
              </li>
            ))}
          </ul>
        )}

        {argument.assumptions.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {argument.assumptions.map((assumption) => (
              <li key={assumption} className="text-[11px] leading-snug text-[#fbbf24]/90">
                Assumes: {assumption}
              </li>
            ))}
          </ul>
        )}

        {argument.challenges.length > 0 && (
          <ul className="mt-2 space-y-1.5 border-t border-white/8 pt-2">
            {argument.challenges.map((challenge) => (
              <li key={challenge.id}>
                <div className="flex items-start gap-2">
                  <IconTarget width={12} height={12} className="mt-0.5 shrink-0 text-mist" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] leading-snug text-mist">
                      <Jump atMs={challenge.atMs} onSeek={onSeek}>
                        “{challenge.text}”
                      </Jump>
                    </div>
                    {challenge.response ? (
                      <div className="mt-0.5 text-[11px] leading-snug text-faint">
                        You answered{' '}
                        {challenge.quality === 'direct'
                          ? 'it directly'
                          : challenge.quality === 'partial'
                            ? 'part of it'
                            : 'something else'}
                        :{' '}
                        <Jump atMs={challenge.response.atMs} onSeek={onSeek}>
                          {challenge.response.claim}
                        </Jump>
                      </div>
                    ) : (
                      <div className="mt-0.5 text-[11px] font-medium text-[#fca5a5]">
                        You never answered this
                        {challenge.pressed > 0 && ` — it was put to you ${challenge.pressed + 1} times`}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

export function ArgumentMapSection({
  sessionId,
  onSeek,
}: {
  sessionId: string
  /** Jump the recording to a moment, in milliseconds (§28). */
  onSeek?: (ms: number) => void
}) {
  const uid = firebaseConfigured() ? firebase().auth.currentUser?.uid : undefined
  const doc = useLiveDocument<DebateSessionDoc>(
    uid ? `users/${uid}/sessions/${sessionId}` : null,
    // No REST fallback: the map is a bonus view, and an unreadable session simply hides it.
    () => Promise.reject(new Error('no fallback')),
  )
  const map = doc?.argumentMap
  const patterns = useMemo(() => doc?.debatePatterns ?? [], [doc])

  if (!map || map.arguments.length === 0) return null

  const side = map.userPosition === 'for' ? 'FOR' : 'AGAINST'

  return (
    <section className="overflow-hidden rounded-3xl border border-white/8 bg-white/[0.03] p-5">
      <div className="eyebrow">How the debate unfolded</div>
      <h3 className="mt-1 text-[15px] font-semibold leading-snug text-chalk">{map.motion}</h3>
      <p className="mt-1 text-[11.5px] text-mist">
        You argued <span className="font-semibold text-jade-400">{side}</span> · {map.arguments.length}{' '}
        {map.arguments.length === 1 ? 'argument' : 'arguments'} · {map.counts.challengesByAi ?? 0} objections put
        to you
        {(map.counts.unansweredByUser ?? 0) > 0 && (
          <span className="text-[#fca5a5]"> · {map.counts.unansweredByUser} left unanswered</span>
        )}
      </p>

      <ul className="mt-3 space-y-2 border-l border-white/12 pl-1">
        {map.arguments.map((argument) => (
          <ArgumentNode key={argument.id} argument={argument} onSeek={onSeek} />
        ))}
      </ul>

      {map.contradictions.length > 0 && (
        <div className="mt-4">
          <div className="eyebrow">Where you argued against yourself</div>
          <ul className="mt-1.5 space-y-1.5">
            {map.contradictions.map((contradiction) => (
              <li
                key={contradiction.later}
                className="rounded-xl border border-[#fca5a5]/25 bg-[#fca5a5]/[0.07] px-3 py-2 text-[11.5px] leading-snug text-mist"
              >
                <Jump atMs={contradiction.atMs} onSeek={onSeek}>
                  <span className="block">Earlier: “{contradiction.earlier}”</span>
                  <span className="mt-0.5 block">Later: “{contradiction.later}”</span>
                  <span className="mt-1 block text-[11px] text-faint">{contradiction.why}</span>
                </Jump>
              </li>
            ))}
          </ul>
        </div>
      )}

      {map.concessions.length > 0 && (
        <div className="mt-4">
          <div className="eyebrow">Points granted</div>
          <ul className="mt-1.5 space-y-1">
            {map.concessions.map((concession) => (
              <li key={`${concession.side}${concession.atMs}`} className="text-[11.5px] leading-snug text-mist">
                <span className={concession.side === 'user' ? 'text-jade-400' : 'text-faint'}>
                  {concession.side === 'user' ? 'You' : 'Your opponent'}:
                </span>{' '}
                <Jump atMs={concession.atMs} onSeek={onSeek}>
                  {concession.text}
                </Jump>
              </li>
            ))}
          </ul>
        </div>
      )}

      {patterns.length > 0 && (
        <div className="mt-4 border-t border-white/8 pt-3">
          <div className="eyebrow">Your biggest opportunities</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {patterns.map((pattern) => (
              <span
                key={pattern.id}
                className="rounded-lg border border-[#fbbf24]/25 bg-[#fbbf24]/8 px-2 py-1 text-[11px] font-medium text-[#fbbf24]"
              >
                {pattern.label}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] leading-snug text-faint">
            Each of these was counted from the debate itself, not inferred.
          </p>
        </div>
      )}
    </section>
  )
}
