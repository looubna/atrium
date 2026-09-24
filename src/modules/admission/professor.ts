/**
 * Who interviews the candidate: a professor on the selection committee, on a video call.
 *
 * The university's senior academic, the same person who examines orals, here sitting on the
 * committee. His face is a recording on our LiveTalking face server (`infra/livetalking`).
 * Mirrors `PROFESSOR` in `backend/app/modules/admission/agents/interviewer.py`.
 */
export const PROFESSOR = {
  avatarId: 'william',
  name: 'Prof. William Okonjo',
  role: 'Selection committee',
} as const
