import type { LinkFailure, LinkPlatform } from './types'

// What the fallback screen says for each reason. Calm, one step forward, never blame.

export function fallbackMessage(reason: LinkFailure, platform: LinkPlatform | null): { title: string; body: string } {
  const where = platform === 'instagram' ? 'Instagram' : platform === 'facebook' ? 'Facebook' : platform === 'tiktok' ? 'TikTok' : null
  switch (reason) {
    case 'bad_link':
      return { title: "That link didn't open", body: 'Check it starts with https:// and try again, or use one of these instead.' }
    case 'no_text':
      return {
        title: where ? `${where} keeps this one to itself` : "This post didn't share its caption",
        body: "That's common for reels. One more step and you're set:",
      }
    case 'no_exercises':
      return { title: "The caption doesn't list the moves", body: "No problem. One more step and you're set:" }
    case 'not_configured':
      return { title: 'Link reading is resting', body: "It isn't set up on this server yet. You can still build this workout:" }
    case 'rate_limited':
    case 'too_many_requests':
      return { title: 'Lots of links at once', body: 'Give it a minute and try again, or keep going another way:' }
    case 'timeout':
      return { title: 'That took too long', body: 'The post was slow to answer. Try again, or keep going another way:' }
    case 'not_youtube':
    case 'upstream':
    default:
      return { title: "Couldn't read that one", body: "One more step and you're set:" }
  }
}
