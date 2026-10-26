import type { ReactNode } from 'react'

// Small inline SVG icons (currentColor), so there are no asset requests.

type P = { size?: number }

const Svg = ({ size = 24, children }: P & { children: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)

export const SoundOnIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
    <path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" />
  </Svg>
)

export const SoundOffIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </Svg>
)

export const FullscreenIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
  </Svg>
)

export const ExitFullscreenIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />
  </Svg>
)

export const PlayIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
  </Svg>
)

export const PauseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 5v14M16 5v14" strokeWidth={3.2} />
  </Svg>
)

export const PrevIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 5v14" strokeWidth={2.6} />
    <path d="M19 5.5v13L9 12z" fill="currentColor" />
  </Svg>
)

export const NextIcon = (p: P) => (
  <Svg {...p}>
    <path d="M18 5v14" strokeWidth={2.6} />
    <path d="M5 5.5v13L15 12z" fill="currentColor" />
  </Svg>
)

export const RestartIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 108-8 8.2 8.2 0 00-6 2.7" />
    <path d="M4 4v4.5h4.5" />
  </Svg>
)

export const UploadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
    <path d="M4.5 14.5v3A2.5 2.5 0 007 20h10a2.5 2.5 0 002.5-2.5v-3" />
  </Svg>
)

export const LinkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
  </Svg>
)
