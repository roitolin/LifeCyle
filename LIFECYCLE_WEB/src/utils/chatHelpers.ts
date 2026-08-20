import { arrayRemove, doc, serverTimestamp, setDoc, type Supabase } from '@/lib/supabaseDbCompat'

export function getConversationId(uid1: string, uid2: string) {
  return [uid1, uid2].sort().join('_')
}

export async function ensureConversationForUsers(db: Supabase, uid1: string, uid2: string) {
  const conversationId = getConversationId(uid1, uid2)
  const participants = [uid1, uid2].sort()
  const conversationRef = doc(db, 'conversations', conversationId)

  try {
    await setDoc(
      conversationRef,
      {
        updatedAt: serverTimestamp(),
        hiddenFor: arrayRemove(uid1, uid2),
      },
      { merge: true },
    )
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : ''

    if (code !== 'not-found' && code !== 'permission-denied') {
      throw error
    }

    await setDoc(conversationRef, {
      participants,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }

  return conversationId
}

