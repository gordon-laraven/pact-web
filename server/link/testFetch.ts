// Test-only: a fake fetch that answers by URL, and records what was asked.

type Reply = { status?: number; json?: unknown; html?: string; headers?: Record<string, string> }
type Answer = Reply | ((init?: RequestInit) => Reply)

export function fakeFetch(routes: [RegExp, Answer][]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push({ url, init })
    const hit = routes.find(([re]) => re.test(url))
    if (!hit) return new Response('not found', { status: 404 })
    const a: Reply = typeof hit[1] === 'function' ? hit[1](init) : hit[1]
    const body = a.json !== undefined ? JSON.stringify(a.json) : (a.html ?? '')
    const type = a.json !== undefined ? 'application/json' : 'text/html; charset=utf-8'
    return new Response(body, { status: a.status ?? 200, headers: { 'content-type': type, ...a.headers } })
  }) as typeof fetch
  return { impl, calls }
}

/** A Gemini generateContent answer whose text is this JSON. */
export const geminiAnswer = (value: unknown) => ({
  json: { candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] },
})

export const publicHost = async () => ['93.184.216.34']
