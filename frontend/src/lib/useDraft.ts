import { useState } from 'react'

/**
 * A local draft of a controlled value, for inputs whose owner updates the value later (from the
 * URL, say). Set the draft as the user acts, so the input shows each change at once and the next
 * keypress starts from it; whenever `value` changes, the draft follows it again.
 */
export function useDraft<T>(value: T): [T, (next: T) => void] {
  const [draft, setDraft] = useState(value)
  const [shown, setShown] = useState(value)
  // Adjusting state while rendering, as React recommends for following a prop: no effect, so
  // the input never renders the stale draft against the new value.
  if (!Object.is(shown, value)) {
    setShown(value)
    setDraft(value)
  }
  return [draft, setDraft]
}
