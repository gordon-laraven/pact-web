// Feature flags. One switch per feature, all in this file.

/**
 * "Paste a link" (read a reel or Short's caption, Gemini, the YouTube video
 * step). Off for now: it comes back later as a paid feature. When false, the
 * home screen shows no link option, the link screen never renders, and the
 * dev/preview server doesn't mount /api/link/*, so no link requests happen.
 * The code and its tests stay in src/link, server/link and LinkBuilder.tsx.
 */
export const ENABLE_LINK_IMPORT = false
