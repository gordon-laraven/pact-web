// Server-side settings for the link pipeline. Read from the environment (or a
// .env / .env.local file next to package.json). None of these are sent to the
// browser: only variables starting with VITE_ ever are, so never prefix these.

export type LinkEnv = {
  /** Google AI Studio key. Turns on AI reading of captions and, for YouTube, the video model. */
  GEMINI_API_KEY?: string
  /** Gemini model id. Defaults to the "latest Flash" alias. */
  GEMINI_MODEL?: string
  /** Optional YouTube Data API key: gets the full description (oEmbed only has the title). */
  YOUTUBE_API_KEY?: string
  /** Optional Meta app token ("app-id|client-token") for Instagram/Facebook oEmbed. */
  META_OEMBED_TOKEN?: string
}

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest'

export function pickLinkEnv(source: Record<string, string | undefined>): LinkEnv {
  const get = (k: keyof LinkEnv) => source[k]?.trim() || undefined
  return {
    GEMINI_API_KEY: get('GEMINI_API_KEY'),
    GEMINI_MODEL: get('GEMINI_MODEL'),
    YOUTUBE_API_KEY: get('YOUTUBE_API_KEY'),
    META_OEMBED_TOKEN: get('META_OEMBED_TOKEN'),
  }
}
