// Load the shared report TypeScript in local Node tools without another runtime.
import fs from 'node:fs'
import path from 'node:path'
import Module from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function createSourceLoader(overrides = {}) {
  const cache = new Map()
  function loadSource(file) {
    const absolute = path.resolve(file)
    if (cache.has(absolute)) return cache.get(absolute).exports
    const loaded = new Module(absolute)
    loaded.filename = absolute
    loaded.paths = Module._nodeModulePaths(path.dirname(absolute))
    cache.set(absolute, loaded)
    const baseRequire = loaded.require.bind(loaded)
    loaded.require = (id) => {
      if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id]
      const candidate = id.startsWith('@/') ? path.join(projectRoot, id.slice(2))
        : id.startsWith('.') ? path.resolve(path.dirname(absolute), id) : null
      if (candidate) {
        for (const source of [candidate, `${candidate}.ts`]) {
          if (source.endsWith('.ts') && fs.existsSync(source)) return loadSource(source)
        }
        return baseRequire(candidate)
      }
      return baseRequire(id)
    }
    const { outputText } = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true },
      fileName: absolute,
    })
    loaded._compile(outputText, absolute)
    return loaded.exports
  }
  return loadSource
}

export const loadSource = createSourceLoader()
