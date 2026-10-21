import { DEFAULT_GEMINI_MODEL, type LinkEnv } from './env.ts'
import { LinkError, toLinkError, type Fetch } from './http.ts'

// The one place that talks to the Gemini API. The key stays on the server.

export type GeminiPart = { text: string } | { file_data: { file_uri: string; mime_type?: string } }

/** The workout shape, as a Gemini response schema (OpenAPI subset). */
export const WORKOUT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'Short workout title' },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    exercises: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          sets: { type: 'INTEGER', nullable: true },
          reps: { type: 'INTEGER', nullable: true, description: 'Reps per set (per side if one-sided)' },
          duration_seconds: { type: 'INTEGER', nullable: true, description: 'Seconds per set for timed moves' },
          rest_seconds: { type: 'INTEGER', nullable: true },
          notes: { type: 'STRING', nullable: true, description: 'Short form cue, or "each side"' },
        },
        required: ['name'],
      },
    },
  },
  required: ['title', 'exercises', 'confidence'],
} as const

export async function generateJson(
  env: LinkEnv,
  parts: GeminiPart[],
  opts: { timeoutMs: number; fetchImpl?: Fetch },
): Promise<unknown> {
  if (!env.GEMINI_API_KEY) throw new LinkError('not_configured')
  const model = env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  let res: Response
  try {
    res = await (opts.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: WORKOUT_SCHEMA },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    })
  } catch (e) {
    throw toLinkError(e)
  }
  if (res.status === 429) throw new LinkError('rate_limited')
  if (res.status === 401 || res.status === 403) throw new LinkError('not_configured', 'Gemini rejected the API key')
  let body: { candidates?: { content?: { parts?: { text?: string }[] } }[]; promptFeedback?: { blockReason?: string }; error?: { message?: string } }
  try {
    body = (await res.json()) as typeof body
  } catch (e) {
    throw toLinkError(e)
  }
  if (!res.ok) throw new LinkError('upstream', body.error?.message ?? `Gemini answered ${res.status}`)
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
