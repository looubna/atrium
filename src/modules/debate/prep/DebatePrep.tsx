import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { ThinkingLogo } from '@/components/ui/ThinkingLogo'
import { IconCheck, IconTarget } from '@/components/ui/Icon'
import {
  CLAIM_TYPE_LABEL,
  type ClaimType,
  type DebatePosition,
  type Preparation,
} from '@/modules/debate/api'

/**
 * What the user reads before the debate starts (§10).
 *
 * It is here to help them think, not to hand them a speech. So it shows the motion, which
 * side they are on, the arguments they should be ready to defend *with the weak point of
 * each*, the concepts that will need pinning down, what is actually established, and the
 * questions they should expect. It does not show the opponent's plan — the server does not
 * send it, and there would be no debate left if it did.
 */

const SIDE_LABEL: Record<DebatePosition, string> = { for: 'FOR', against: 'AGAINST' }

/** Facts are labelled by how firm they are, so nothing reads as settled that is not. */
const CLAIM_TONE: Record<ClaimType, string> = {
  fact: 'border-jade-400/30 bg-jade-500/10 text-jade-400',
  source_based: 'border-jade-400/20 bg-jade-500/8 text-jade-400/90',
  argument: 'border-white/10 bg-white/5 text-mist',
  interpretation: 'border-white/10 bg-white/5 text-mist',
  opinion: 'border-[#fbbf24]/25 bg-[#fbbf24]/8 text-[#fbbf24]',
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow mt-4 first:mt-0">{children}</div>
}

/** While it is being prepared: what has been worked out so far, as it arrives. */
export function Preparing({ prep }: { prep: Preparation | null }) {
  const progress = prep?.progress ?? null
  const stage = progress?.stage ?? 'starting'
  const text: Record<string, string> = {
    starting: 'Setting the debate up…',
    reading: 'Reading your material…',
    researching: 'Looking up what is actually established…',
    briefing: 'Building the case on both sides…',
    done: 'Ready',
  }
  // The server reports which stage it is on, so the mark shows real ground
  // covered rather than a guess. Each stage claims only what it has finished.
  const reached: Record<string, number> = {
    starting: 0.06,
    reading: 0.3,
    researching: 0.58,
    briefing: 0.84,
    done: 1,
  }

  return (
    <div className="mx-auto w-full max-w-md text-center">
      <ThinkingLogo
        layout="stack"
        size={48}
        progress={reached[stage] ?? reached.starting}
        done={stage === 'done'}
        label="Preparing your debate"
        doneLabel="Ready"
      />
      <p className="mt-3 text-[13px] font-medium text-chalk">{text[stage] ?? text.starting}</p>
      {progress?.busy && (
        <p className="mt-1 text-[11px] text-faint">The AI service is busy — retrying automatically.</p>
      )}
      {progress?.motion && (
        <p className="mt-3 text-[12.5px] leading-snug text-mist">“{progress.motion}”</p>
      )}
      {progress?.sources && progress.sources.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {progress.sources.slice(0, 6).map((source) => (
            <span
              key={`${source.domain}${source.title}`}
              className="rounded-lg bg-white/6 px-1.5 py-0.5 text-[10px] font-medium text-mist"
            >
              {source.domain}
            </span>
          ))}
        </div>
      )}
      {progress?.facts && progress.facts.length > 0 && (
        <ul className="mt-3 space-y-1 text-left">
          {progress.facts.slice(0, 4).map((fact) => (
            <li key={fact} className="flex gap-2 text-[11.5px] leading-snug text-faint">
              <IconCheck width={12} height={12} className="mt-0.5 shrink-0 text-jade-400" />
              {fact}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DebatePrep({
  prep,
  onStart,
  starting,
}: {
  prep: Preparation
  onStart: () => void
  starting: boolean
}) {
  const side = prep.userPosition ?? 'for'
  const theirs = prep.aiPosition ?? (side === 'for' ? 'against' : 'for')
  const assigned = prep.positionMode && prep.positionMode !== 'user'

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
        <div className="eyebrow">The motion</div>
        <h2 className="mt-1 text-[16px] font-semibold leading-snug tracking-tight text-chalk">
          {prep.motion}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-jade-400/40 bg-jade-500/15 px-2 py-1 text-[11.5px] font-semibold text-jade-400">
            You argue {SIDE_LABEL[side]}
          </span>
          <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11.5px] font-medium text-mist">
            Your opponent argues {SIDE_LABEL[theirs]}
          </span>
        </div>
        {assigned && (
          <p className="mt-2 text-[11px] leading-snug text-faint">
            This side was chosen for you. You may not agree with it — arguing it anyway is the point.
          </p>
        )}
      </div>

      <div className="-mr-2 mt-4 max-h-[min(52vh,30rem)] overflow-y-auto pr-2">
        {prep.topicContext && (
          <>
            <Heading>What is at stake</Heading>
            <p className="mt-1 text-[12.5px] leading-relaxed text-mist">{prep.topicContext}</p>
          </>
        )}

        {prep.yourArguments && prep.yourArguments.length > 0 && (
          <>
            <Heading>What you should be ready to defend</Heading>
            <div className="mt-1.5 grid gap-1.5">
              {prep.yourArguments.map((argument) => (
                <div
                  key={argument.claim}
                  className="rounded-xl border border-white/8 bg-white/4 px-3 py-2.5"
                >
                  <div className="text-[12.5px] font-medium leading-snug text-chalk">
                    {argument.claim}
                  </div>
                  {argument.reason && (
                    <div className="mt-1 text-[11.5px] leading-snug text-mist">
                      Because {argument.reason.charAt(0).toLowerCase() + argument.reason.slice(1)}
                    </div>
                  )}
                  {argument.evidence && (
                    <div className="mt-1 text-[11px] leading-snug text-faint">
                      Support: {argument.evidence}
                    </div>
                  )}
                  {argument.weakness && (
                    <div className="mt-1.5 flex gap-1.5 border-t border-white/8 pt-1.5 text-[11px] leading-snug text-[#fbbf24]">
                      <IconTarget width={12} height={12} className="mt-0.5 shrink-0" />
                      <span>Weak point: {argument.weakness}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {prep.concepts && prep.concepts.length > 0 && (
          <>
            <Heading>Terms worth pinning down</Heading>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {prep.concepts.map((concept) => (
                <span
                  key={concept}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11.5px] text-mist"
                >
                  {concept}
                </span>
              ))}
            </div>
          </>
        )}

        {prep.keyFacts && prep.keyFacts.length > 0 && (
          <>
            <Heading>What is actually established</Heading>
            <div className="mt-1.5 grid gap-1.5">
              {prep.keyFacts.map((fact) => (
                <div key={fact.statement} className="flex gap-2">
                  <span
                    className={cn(
                      'mt-0.5 h-fit shrink-0 rounded-md border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide',
                      CLAIM_TONE[fact.claimType],
                    )}
                  >
                    {CLAIM_TYPE_LABEL[fact.claimType]}
                  </span>
                  <span className="text-[12px] leading-snug text-mist">{fact.statement}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] leading-snug text-faint">
              The labels matter in a debate: what a source says is not the same as what is settled,
              and neither is the same as an argument.
            </p>
          </>
        )}

        {prep.challengeAreas && prep.challengeAreas.length > 0 && (
          <>
            <Heading>Where you will be pressed</Heading>
            <div className="mt-1.5 grid gap-1.5">
              {prep.challengeAreas.map((area) => (
                <div key={area.area} className="rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                    {area.area}
                  </div>
                  <div className="mt-1 text-[12.5px] font-medium leading-snug text-chalk">
                    “{area.question}”
                  </div>
                  {area.why && (
                    <div className="mt-1 text-[11px] leading-snug text-faint">{area.why}</div>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] leading-snug text-faint">
              These are the questions, not the answers. Work out how you would meet them.
            </p>
          </>
        )}

        {prep.materialSummary && (
          <>
            <Heading>From your material</Heading>
            <p className="mt-1 text-[12px] leading-relaxed text-mist">{prep.materialSummary}</p>
            {prep.materialContradictions && prep.materialContradictions.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {prep.materialContradictions.map((item) => (
                  <li key={item} className="text-[11.5px] leading-snug text-[#fbbf24]">
                    It argues against itself: {item}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {prep.caveats && prep.caveats.length > 0 && (
          <>
            <Heading>Genuinely unsettled</Heading>
            <ul className="mt-1 space-y-1">
              {prep.caveats.map((caveat) => (
                <li key={caveat} className="text-[11.5px] leading-snug text-faint">
                  {caveat}
                </li>
              ))}
            </ul>
          </>
        )}

        {prep.sources && prep.sources.length > 0 && (
          <>
            <Heading>Sources</Heading>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {prep.sources.map((source) => (
                <span
                  key={source.id}
                  title={source.title}
                  className="rounded-lg bg-white/6 px-1.5 py-0.5 text-[10.5px] font-medium text-mist"
                >
                  {source.domain}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <Button variant="primary" className="mt-4 h-10 w-full" disabled={starting} onClick={onStart}>
        {starting ? 'One moment…' : 'Start the debate'}
      </Button>
      <p className="mt-1.5 text-center text-[10.5px] leading-snug text-faint">
        Speak naturally and take your time. You can interrupt, and so can your opponent.
      </p>
    </div>
  )
}
