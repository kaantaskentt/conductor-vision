/// <reference types="node" />

import { createHash } from 'node:crypto'
import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  cameraErrorMessage,
  FACE_MODEL,
  getVerifiedVisionModel,
  HAND_MODEL,
  type VerifiedVisionModelAsset,
  VISION_WASM_ROOT,
  VisionModelAssetError,
} from './useVisionRuntime'

type ManifestAsset = {
  path: string
  bytes: number
  sha256: string
  source: string
  upstream: string
  license: string
}

type ExternalModel = {
  id: string
  url: string
  expectedBytes: number
  sha256: string
  license: string
  distribution: string
  verification: string
}

type AssetManifest = {
  package: {
    name: string
    version: string
    resolved: string
    integrity: string
    license: string
  }
  assets: ManifestAsset[]
  externalModels: ExternalModel[]
}

const repositoryRoot = process.cwd()
const vendorRoot = path.join(repositoryRoot, 'public/vendor/mediapipe')
const abc = new TextEncoder().encode('abc')
const abcSha256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

async function sha256(filePath: string) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

function modelFixture(
  url: string,
  overrides: Partial<VerifiedVisionModelAsset> = {},
): VerifiedVisionModelAsset {
  return {
    label: 'Test model',
    url,
    bytes: abc.byteLength,
    sha256: abcSha256,
    ...overrides,
  }
}

function modelResponse(bytes = abc, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

function cspDirective(policy: string, name: string) {
  return policy
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `))
}

describe('MediaPipe asset integrity', () => {
  it('self-hosts only the lock-pinned WASM assets and constrains model fetching', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(vendorRoot, 'manifest.json'), 'utf8'),
    ) as AssetManifest
    const lockfile = JSON.parse(
      await readFile(path.join(repositoryRoot, 'package-lock.json'), 'utf8'),
    ) as {
      packages: Record<
        string,
        { version?: string; resolved?: string; integrity?: string; license?: string }
      >
    }
    const packageEntry = lockfile.packages['node_modules/@mediapipe/tasks-vision']

    expect(manifest.package).toEqual({
      name: '@mediapipe/tasks-vision',
      version: packageEntry.version,
      resolved: packageEntry.resolved,
      integrity: packageEntry.integrity,
      license: packageEntry.license,
    })
    expect(manifest.assets).toHaveLength(6)

    for (const asset of manifest.assets) {
      const vendoredPath = path.join(vendorRoot, asset.path)
      expect((await stat(vendoredPath)).size, asset.path).toBe(asset.bytes)
      expect(await sha256(vendoredPath), asset.path).toBe(asset.sha256)

      const packagePath = path.join(repositoryRoot, asset.source)
      expect(await sha256(vendoredPath), `${asset.path} differs from ${asset.source}`).toBe(
        await sha256(packagePath),
      )
    }

    expect(manifest.externalModels).toHaveLength(2)
    expect(manifest.externalModels.map(({ url, expectedBytes, sha256, license }) => ({
      url,
      expectedBytes,
      sha256,
      license,
    }))).toEqual([
      {
        url: HAND_MODEL.url,
        expectedBytes: HAND_MODEL.bytes,
        sha256: HAND_MODEL.sha256,
        license: 'NOASSERTION',
      },
      {
        url: FACE_MODEL.url,
        expectedBytes: FACE_MODEL.bytes,
        sha256: FACE_MODEL.sha256,
        license: 'NOASSERTION',
      },
    ])

    await expect(
      access(path.join(vendorRoot, 'models/hand_landmarker/float16/1/hand_landmarker.task')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      access(path.join(vendorRoot, 'models/face_landmarker/float16/1/face_landmarker.task')),
    ).rejects.toMatchObject({ code: 'ENOENT' })

    expect(VISION_WASM_ROOT).toBe('/vendor/mediapipe/tasks-vision/0.10.35/wasm')
    const runtimeSource = await readFile(
      path.join(repositoryRoot, 'src/hooks/useVisionRuntime.ts'),
      'utf8',
    )
    expect(runtimeSource).toContain('modelAssetBuffer')
    expect(runtimeSource).not.toContain('modelAssetPath')

    const vercel = JSON.parse(
      await readFile(path.join(repositoryRoot, 'vercel.json'), 'utf8'),
    ) as {
      headers: Array<{
        source: string
        headers: Array<{ key: string; value: string }>
      }>
    }
    const vercelPolicy = vercel.headers[0].headers.find(
      ({ key }) => key === 'Content-Security-Policy',
    )?.value
    const html = await readFile(path.join(repositoryRoot, 'index.html'), 'utf8')
    const htmlPolicy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1]

    for (const policy of [vercelPolicy, htmlPolicy]) {
      expect(policy).toBeDefined()
      expect(policy).not.toContain('cdn.jsdelivr.net')
      expect(cspDirective(policy ?? '', 'script-src')).not.toContain('storage.googleapis.com')
      expect(cspDirective(policy ?? '', 'connect-src')).toContain(
        'https://storage.googleapis.com',
      )
      expect(policy).toContain("'wasm-unsafe-eval'")
    }

    expect(
      vercel.headers.find(
        ({ source }) =>
          source === '/vendor/mediapipe/tasks-vision/0.10.35/wasm/(.*)',
      )?.headers,
    ).toContainEqual({
      key: 'Cache-Control',
      value: 'public, max-age=31536000, immutable',
    })

    const apacheLicensePath = path.join(vendorRoot, 'LICENSE-APACHE-2.0.txt')
    const apacheLicense = await readFile(apacheLicensePath, 'utf8')
    expect(await sha256(apacheLicensePath)).toBe(
      'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
    )
    expect(apacheLicense).toContain('Apache License\n                           Version 2.0')
    expect(apacheLicense).toContain(
      '(a) You must give any other recipients of the Work or\n          Derivative Works a copy of this License;',
    )
    expect(apacheLicense).toContain('END OF TERMS AND CONDITIONS')

    const vendorNotice = await readFile(
      path.join(vendorRoot, 'THIRD_PARTY_NOTICES.md'),
      'utf8',
    )
    expect(vendorNotice).toContain('[Apache License 2.0](./LICENSE-APACHE-2.0.txt)')
  })

  it('checks HTTP status, byte length, and SHA-256 before caching verified bytes', async () => {
    const successAsset = modelFixture('https://example.invalid/success.task')
    const successFetch = vi.fn(async () => modelResponse())
    const first = getVerifiedVisionModel(successAsset, successFetch)
    const second = getVerifiedVisionModel(successAsset, successFetch)

    expect(second).toBe(first)
    expect(Array.from(await first)).toEqual(Array.from(abc))
    expect(successFetch).toHaveBeenCalledOnce()

    await expect(
      getVerifiedVisionModel(
        modelFixture('https://example.invalid/http.task'),
        vi.fn(async () => modelResponse(abc, 503)),
      ),
    ).rejects.toThrow('HTTP 503')

    await expect(
      getVerifiedVisionModel(
        modelFixture('https://example.invalid/length.task', { bytes: abc.byteLength + 1 }),
        vi.fn(async () => modelResponse()),
      ),
    ).rejects.toThrow('failed its integrity check')

    await expect(
      getVerifiedVisionModel(
        modelFixture('https://example.invalid/digest.task', { sha256: '0'.repeat(64) }),
        vi.fn(async () => modelResponse()),
      ),
    ).rejects.toThrow('failed its integrity check')

    await expect(
      getVerifiedVisionModel(
        modelFixture('https://example.invalid/no-crypto.task'),
        vi.fn(async () => modelResponse()),
        null,
      ),
    ).rejects.toThrow('cannot be verified in this browser')

    const actionable = new VisionModelAssetError(
      'Hand tracking model failed its integrity check. Refresh the page.',
    )
    expect(cameraErrorMessage(actionable)).toBe(actionable.message)
  })

  it('does not retain failed fetches in the in-memory cache', async () => {
    const asset = modelFixture('https://example.invalid/retry.task')
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(modelResponse(abc, 502))
      .mockResolvedValueOnce(modelResponse())

    await expect(getVerifiedVisionModel(asset, fetcher)).rejects.toThrow('HTTP 502')
    expect(Array.from(await getVerifiedVisionModel(asset, fetcher))).toEqual(Array.from(abc))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
