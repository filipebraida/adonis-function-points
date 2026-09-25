import { test } from '@japa/runner'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getCommand, getMetaData } from '../../commands/main.js'
import { configure } from '../../index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/**
 * AdonisJS resolves a package's commands by importing its `commands` entry and
 * calling `getMetaData()` and `getCommand()`. Exporting the classes instead did
 * not merely fail to register them — ace could not read the entry at all, so
 * EVERY command broke in the host application, `migration:run` included.
 *
 * Adding this package to `adonisrc.ts` made the application worse than not
 * having it, and nothing here tested the entry point, so nothing said so.
 */
test.group('commands entry: the contract ace actually calls', () => {
  test('getMetaData returns metadata for every command', async ({ assert }) => {
    const metaData = await getMetaData()

    assert.isNotEmpty(metaData)
    for (const item of metaData) {
      assert.isString(item.commandName)
      assert.isString(item.description)
    }
  })

  test('getCommand resolves each one to its class', async ({ assert }) => {
    for (const item of await getMetaData()) {
      const command = await getCommand(item)

      assert.exists(command, `${item.commandName} is indexed but does not load`)
      assert.equal(command!.commandName, item.commandName)
    }
  })

  test('an unknown command resolves to null rather than throwing', async ({ assert }) => {
    assert.isNull(await getCommand({ commandName: 'fp:nope' } as never))
  })

  /**
   * The drift this catches: a command file added and left out of the index, or
   * renamed on one side only. Either way ace would not see it and nothing else
   * would notice.
   */
  test('every command file is indexed', async ({ assert }) => {
    const entries = await readdir(path.join(HERE, '..', '..', 'commands'))
    const files = entries
      .filter((name) => name.startsWith('fp_') && name.endsWith('.ts'))
      .map((name) => name.replace(/\.ts$/, ''))

    const metaData = await getMetaData()
    const indexed = metaData.map((item) => item.commandName.replace(':', '_'))

    for (const file of files) {
      assert.include(indexed, file, `commands/${file}.ts is not in commands/main.ts`)
    }
    assert.lengthOf(indexed, files.length)
  })

  /**
   * `node ace configure` imports the hook from the package root. Without this
   * export the command reports the package as not configurable, while
   * `build/configure.js` sits there unreferenced.
   */
  test('the package root exports the configure hook', ({ assert }) => {
    assert.isFunction(configure)
  })
})
