// Keeps the screen awake while the workout is playing. Failures (unsupported
// browser, low battery, permission policy) are ignored: it's a nicety.

export function createWakeLock() {
  let sentinel: WakeLockSentinel | null = null
  let wanted = false
  let pending = false

  const acquire = async () => {
    if (!wanted || sentinel || pending || !('wakeLock' in navigator)) return
    pending = true
    try {
      const s = await navigator.wakeLock.request('screen')
      if (!wanted) {
        void s.release().catch(() => {})
        return
      }
      sentinel = s
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null
      })
    } catch {
      /* silently ignore */
    } finally {
      pending = false
    }
  }

  // The browser drops the lock when the page is hidden; take it back on return.
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void acquire()
  }
  document.addEventListener('visibilitychange', onVisibility)

  return {
    set(on: boolean) {
      wanted = on
      if (on) void acquire()
      else if (sentinel) {
        void sentinel.release().catch(() => {})
        sentinel = null
      }
    },
    dispose() {
      this.set(false)
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
