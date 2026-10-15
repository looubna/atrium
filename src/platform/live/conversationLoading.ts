import { create } from 'zustand'

/**
 * Whether a live conversation is still getting ready: the user has started it and the other side
 * has not said its first words yet (connecting, the face joining, the model opening). Set by the
 * live conversation (`useLiveInterview`, which every room uses) and shown once for the whole app
 * (`ConversationLoading`), so the start never looks like a conversation that is not working.
 */
interface ConversationLoadingStore {
  loading: boolean
  set: (loading: boolean) => void
}

export const useConversationLoading = create<ConversationLoadingStore>((set) => ({
  loading: false,
  set: (loading) => set((s) => (s.loading === loading ? s : { loading })),
}))
