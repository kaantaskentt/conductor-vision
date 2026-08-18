import { gzipSync } from 'node:zlib'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const distRoot = fileURLToPath(new URL('../dist/', import.meta.url))
const assetsRoot = fileURLToPath(new URL('../dist/assets/', import.meta.url))
const manifest = JSON.parse(
  await readFile(`${distRoot}.vite/manifest.json`, 'utf8'),
)
const manifestEntries = Object.entries(manifest)
const entryManifest = manifestEntries.find(([, output]) => output.isEntry)

if (!entryManifest) {
  throw new Error('Bundle budget could not find the production entry in Vite manifest.')
}

const [entrySource, entryOutput] = entryManifest
const mediaPipeManifest = manifestEntries.find(([source]) =>
  source.includes('@mediapipe/tasks-vision'),
)

if (
  !mediaPipeManifest ||
  !mediaPipeManifest[1].isDynamicEntry ||
  mediaPipeManifest[1].file === entryOutput.file ||
  !entryOutput.dynamicImports?.includes(mediaPipeManifest[0])
) {
  throw new Error(
    'Expected MediaPipe to be a dynamic import in its own deferred production chunk.',
  )
}

const entryFile = entryOutput.file.replace(/^assets\//, '')
const javascriptFiles = (await readdir(assetsRoot)).filter((file) => file.endsWith('.js'))
const deferredFiles = manifestEntries
  .filter(([, output]) => output.isDynamicEntry)
  .map(([, output]) => output.file)

if (deferredFiles.length === 0 || !javascriptFiles.includes(entryFile)) {
  throw new Error(
    `Bundle budget could not verify JavaScript outputs for ${entrySource}.`,
  )
}

const entryBytes = await readFile(`${assetsRoot}${entryFile}`)
const entryGzipBytes = gzipSync(entryBytes).byteLength
const entryBudgetBytes = 96 * 1024

if (entryGzipBytes > entryBudgetBytes) {
  throw new Error(
    `Initial JavaScript is ${entryGzipBytes} gzip bytes; the release budget is ${entryBudgetBytes}.`,
  )
}

console.log(
  `Bundle budget passed: ${(entryGzipBytes / 1024).toFixed(1)} KiB initial JavaScript; ${deferredFiles.length} deferred chunk${deferredFiles.length === 1 ? '' : 's'}.`,
)
