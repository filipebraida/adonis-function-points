import type Configure from '@adonisjs/core/commands/configure'

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  await codemods.makeUsingStub(import.meta.dirname!, 'stubs/config.stub', {})

  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('@filipebraida/adonis-function-points/function_points_provider')
    rcFile.addCommand('@filipebraida/adonis-function-points/commands')
  })
}
