/**
 * Figwright plugin fetch/install, host side, standalone-testable.
 *
 * The Figma-side Figwright plugin is not published to npm, so the settings
 * page offers one-click download + extraction. This module talks only to
 * GitHub, extracts the release zip with fflate (no system unzip) and writes
 * the result into a single plugin directory that is overwritten on every
 * update. Figma Desktop copies the plugin into its own directory at import
 * time, so the extracted copy is an import entry point, not a permanent asset.
 */

import https from 'node:https'
import { unzipSync } from 'fflate'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import type { SightFigwrightPluginInfo, SightFigwrightPluginUpdateResult } from './config.ts'

export type { SightFigwrightPluginInfo, SightFigwrightPluginUpdateResult }

/** Plugin directory holding the single, latest extracted copy. */
export const figwrightPluginDir = (baseDir: string): string => join(baseDir, 'figwright-plugin')

/** Read the locally installed copy state (version.json + manifest.json). */
export const readFigwrightPluginAt = (pluginDir: string): SightFigwrightPluginInfo => {
  const manifest = join(pluginDir, 'manifest.json')
  if (!existsSync(manifest)) return { installedTag: null, manifestPath: null }
  let installedTag: string | null = null
  try {
    const value = JSON.parse(readFileSync(join(pluginDir, 'version.json'), 'utf8')) as { tag?: unknown }
    installedTag = typeof value.tag === 'string' && value.tag.length > 0 ? value.tag : null
  } catch { /* keep null */ }
  return { installedTag, manifestPath: manifest }
}

function httpsGetBuffer(url: string, accept: 'json' | 'binary', redirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'dsh-sight/0.1.13 (figwright plugin updater)',
        // GitHub's JSON endpoints reject application/octet-stream (415), while
        // the release-asset endpoint needs it to return the 302 to the CDN.
        ...(accept === 'binary' ? { 'Accept': 'application/octet-stream' } : {}),
      },
      timeout: 30000,
    }, res => {
      const status = res.statusCode ?? 0
      const location = res.headers.location
      if (status >= 300 && status < 400 && typeof location === 'string' && redirects > 0) {
        res.resume()
        httpsGetBuffer(location, accept, redirects - 1).then(resolve, reject)
        return
      }
      if (status !== 200) {
        res.resume()
        reject(new Error(`下载失败: HTTP ${status}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', chunk => { chunks.push(chunk as Buffer) })
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('下载超时')))
    request.on('error', reject)
  })
}

/** Retry a fetch a few times; GitHub egress is intermittently flaky. */
async function fetchWithRetry(url: string, accept: 'json' | 'binary', attempts = 3): Promise<Buffer> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await httpsGetBuffer(url, accept)
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

interface LatestZip { tag: string; assetId: number }

/**
 * Resolve the latest release's plugin zip (never the auto source zip). The
 * download itself goes through the API asset endpoint (Accept: octet-stream),
 * which 302s straight to the release-assets CDN — this deliberately avoids
 * `github.com` as a hop, since that redirector is frequently unreachable even
 * when api.github.com and the asset CDN both work.
 */
export async function resolveLatestFigwrightZip(): Promise<LatestZip> {
  const body = await fetchWithRetry('https://api.github.com/repos/awdr74100/figwright/releases/latest', 'json')
  const release = JSON.parse(body.toString('utf8')) as {
    tag_name?: unknown
    assets?: readonly { name?: unknown; id?: unknown }[]
  }
  const tag = typeof release.tag_name === 'string' ? release.tag_name : null
  const asset = Array.isArray(release.assets)
    ? release.assets.find(a => typeof a.name === 'string'
        && /^figwright-plugin-.*\.zip$/i.test(a.name)
        && typeof a.id === 'number')
    : undefined
  if (tag === null || asset === undefined || typeof asset.id !== 'number') {
    throw new Error('无法从 GitHub 解析最新 Figwright 插件资源')
  }
  return { tag, assetId: asset.id }
}

/**
 * Download the latest release zip and extract it into `pluginDir`
 * (overwriting any previous copy). Returns the outcome for the settings UI.
 */
export async function installLatestFigwrightPlugin(pluginDir: string): Promise<SightFigwrightPluginUpdateResult> {
  try {
    const latest = await resolveLatestFigwrightZip()
    const current = readFigwrightPluginAt(pluginDir)
    if (current.manifestPath !== null && current.installedTag === latest.tag) {
      return { ok: true, upToDate: true, tag: latest.tag, manifestPath: current.manifestPath, error: null }
    }
    const assetUrl = `https://api.github.com/repos/awdr74100/figwright/releases/assets/${latest.assetId}`
    const zip = await fetchWithRetry(assetUrl, 'binary')
    rmSync(pluginDir, { recursive: true, force: true })
    mkdirSync(pluginDir, { recursive: true })
    const files = unzipSync(new Uint8Array(zip)) as Readonly<Record<string, Uint8Array>>
    const names = Object.keys(files)
    const flat = names.includes('manifest.json')
    const firstParts = names.map(name => name.split('/')[0])
    const singleRoot = !flat && names.length > 0
      && firstParts.every(part => part !== undefined && part.length > 0 && part === firstParts[0])
    let wroteManifest = false
    for (const [rawName, data] of Object.entries(files)) {
      if (rawName.endsWith('/')) continue
      let parts = rawName.split('/')
      if (singleRoot) parts = parts.slice(1)
      parts = parts.filter(part => part.length > 0 && part !== '.' && part !== '..' && part !== '__MACOSX')
      if (parts.length === 0) continue
      const target = join(pluginDir, ...parts)
      if (target !== pluginDir && !target.startsWith(pluginDir + sep)) throw new Error(`zip 内含不安全路径: ${rawName}`)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, Buffer.from(data))
      if (parts[parts.length - 1] === 'manifest.json') wroteManifest = true
    }
    const manifest = join(pluginDir, 'manifest.json')
    if (!wroteManifest || !existsSync(manifest)) throw new Error('解压后未找到 manifest.json')
    writeFileSync(join(pluginDir, 'version.json'), JSON.stringify({ tag: latest.tag }, null, 2), 'utf8')
    return { ok: true, upToDate: false, tag: latest.tag, manifestPath: manifest, error: null }
  } catch (error) {
    return { ok: false, upToDate: false, tag: null, manifestPath: null, error: error instanceof Error ? error.message : String(error) }
  }
}
