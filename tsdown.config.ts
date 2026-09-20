/**
 * dsh-sight standalone build: node-half library plus the browser client
 * bundle. Self-contained (no monorepo imports) so the package builds from a
 * standalone GitHub repo via plain `tsdown`. The client bundle is served by
 * the Web shell's module table (`window.__ModuleLoader__`).
 */
import { defineConfig, type UserConfig } from 'tsdown'

const PACKAGE_ID = '@eric.wen/dsh-sight'

/**
 * Specifiers resolved from the Web shell module table. Everything else is
 * inlined so a require() the table cannot answer never reaches the browser.
 */
const CLIENT_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-connection/client',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

/**
 * Packages that must stay as real installed modules rather than being bundled:
 * both Figma MCP servers are spawned as SEPARATE child processes by the
 * mcp-client bridge, so each needs its standalone entry file on disk (bundling
 * would inline them into lib/index.js and leave nothing for the child to run).
 * `@figwright/mcp` is required by path at runtime (never statically imported)
 * and resolved from the installed module tree.
 */
const NODE_EXTERNALS: readonly string[] = ['figma-ui-mcp', '@figwright/mcp', '@modelcontextprotocol/sdk']

const readServer: UserConfig = {
  name: `${PACKAGE_ID}/figma-read-server`,
  entry: { 'figma-read-server': 'src/figma-read-server.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: [...NODE_EXTERNALS],
}

const nodeLibrary: UserConfig = {
  name: PACKAGE_ID,
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: [...NODE_EXTERNALS],
}

/**
 * Write half: the facade that fronts the upstream figma-ui-mcp server. Like
 * the read facade it is spawned as its own child process by the mcp-client
 * bridge, so it needs a standalone entry file on disk.
 */
const writeServer: UserConfig = {
  name: `${PACKAGE_ID}/figma-ui-server`,
  entry: { 'figma-ui-server': 'src/figma-ui-server.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: [...NODE_EXTERNALS],
}

const clientBundle: UserConfig = {
  name: `${PACKAGE_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  plugins: [{
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null
      if (VENDORED_LIBRARY.test(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services',
      )
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([nodeLibrary, readServer, writeServer, clientBundle])
