import type { CommandMetaData } from '@adonisjs/core/types/ace'

/**
 * Static index of the commands this package ships.
 *
 * AdonisJS resolves a package's commands by importing its `commands` entry and
 * calling `getMetaData()` and `getCommand()`. Exporting the classes instead —
 * which this module did until now — does not merely fail to register them: ace
 * cannot read the entry at all, so EVERY command breaks, `migration:run`
 * included. Adding the package to `adonisrc.ts` made the application worse than
 * not having it.
 *
 * The shape mirrors how `@adonisjs/lucid` exposes its own commands.
 */
const commands: Array<{
  commandName: string
  importer: () => Promise<{ default: { commandName: string; serialize(): CommandMetaData } }>
}> = [
  { commandName: 'fp:inventory', importer: () => import('./fp_inventory.js') },
  { commandName: 'fp:metrics', importer: () => import('./fp_metrics.js') },
  { commandName: 'fp:count', importer: () => import('./fp_count.js') },
  { commandName: 'fp:explain', importer: () => import('./fp_explain.js') },
  { commandName: 'fp:diff', importer: () => import('./fp_diff.js') },
  { commandName: 'fp:calibrate', importer: () => import('./fp_calibrate.js') },
]

let cache: CommandMetaData[] | null = null

export async function getMetaData(): Promise<CommandMetaData[]> {
  if (cache) return cache

  cache = await Promise.all(
    commands.map(async ({ importer }) => {
      const loaded = await importer()
      return loaded.default.serialize()
    })
  )

  return cache
}

export async function getCommand(metaData: CommandMetaData) {
  const match = commands.find(({ commandName }) => commandName === metaData.commandName)
  if (!match) return null

  const loaded = await match.importer()
  return loaded.default
}
