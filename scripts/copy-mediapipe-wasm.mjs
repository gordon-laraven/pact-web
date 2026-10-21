// Copies MediaPipe's WebAssembly runtime into public/ so the app serves it
// itself (no CDN). Runs automatically after install and before dev/build.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const to = join(root, 'public', 'mediapipe', 'wasm')

if (!existsSync(from)) {
  console.warn('[copy-mediapipe-wasm] @mediapipe/tasks-vision not installed yet; skipping')
} else {
  mkdirSync(to, { recursive: true })
  cpSync(from, to, { recursive: true })
}
