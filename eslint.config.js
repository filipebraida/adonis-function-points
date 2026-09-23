import { configPkg } from '@adonisjs/eslint-config'

export default [
  {
    // fixtures imitam código de aplicação de propósito: são ENTRADA da
    // análise, não código do pacote. Lintá-las mudaria o que está sob teste.
    // `tmp/` são sondas descartáveis contra apps reais, fora do pacote
    ignores: ['build/**', 'coverage/**', 'tmp/**', 'tests/fixtures/**'],
  },
  ...configPkg(),
]
