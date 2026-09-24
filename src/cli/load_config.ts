import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createJiti } from 'jiti'

import { DEFAULTS, defineConfig } from '../define_config.js'
import { toPosix } from '../inventory/paths.js'
import type { FunctionPointsConfig } from '../define_config.js'

/**
 * Loads `config/function_points.ts` from the application being analysed.
 *
 * Both front-ends need this and neither could do it alone: the ace commands run
 * with `startApp: false`, so there is no booted container to read config from;
 * and the standalone CLI has no container at all. The file is therefore
 * imported directly, through jiti, which transforms the whole module graph —
 * a config may import a resolver from the application, and that resolver may
 * import files using decorators, which Node's type stripping cannot handle.
 *
 * **A config that exists and fails to load is an error, never a fallback.**
 * Falling back to defaults with a warning would silently change the count, and
 * the count becomes an invoice. Absence of a config file is a different thing,
 * and is legitimate: it means the defaults.
 */

export const CONFIG_PATHS = ['config/function_points.ts', 'config/function_points.js']

export class ConfigLoadError extends Error {
  constructor(
    readonly file: string,
    readonly cause: unknown
  ) {
    super(
      `failed to load ${file}: ${cause instanceof Error ? cause.message : String(cause)}\n` +
        `The count was NOT produced. Fix the configuration, or remove the file to use ` +
        `the defaults — falling back silently would change the number without telling you.`
    )
    this.name = 'ConfigLoadError'
  }
}

export type LoadedConfig = {
  config: FunctionPointsConfig
  /** absolute path of the file used, or null when the defaults apply */
  file: string | null
}

export async function loadConfig(root: string): Promise<LoadedConfig> {
  const found = CONFIG_PATHS.map((candidate) => path.join(root, candidate)).find((candidate) =>
    existsSync(candidate)
  )

  if (!found) return { config: { ...DEFAULTS }, file: null }

  let loaded: unknown
  try {
    const jiti = createJiti(pathToFileURL(path.join(root, 'noop.js')).href, {
      interopDefault: true,
    })
    loaded = await jiti.import(found, { default: true })
  } catch (error) {
    throw new ConfigLoadError(found, error)
  }

  if (!loaded || typeof loaded !== 'object') {
    throw new ConfigLoadError(found, new Error('the default export is not a configuration object'))
  }

  // this path is recorded in the count's `source`, so it leaves the process
  return { config: defineConfig(loaded as Partial<FunctionPointsConfig>), file: toPosix(found) }
}
