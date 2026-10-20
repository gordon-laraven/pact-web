// Thin, failure-tolerant wrapper over the Fullscreen API.

export const fullscreenSupported = () =>
  typeof document !== 'undefined' && !!document.fullscreenEnabled && !!document.documentElement.requestFullscreen

export const isFullscreen = () => !!document.fullscreenElement

export function toggleFullscreen(el: HTMLElement) {
  try {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
  } catch {
    /* ignore */
  }
}

export function exitFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
}
