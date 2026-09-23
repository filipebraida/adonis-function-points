/**
 * Camada de inventário: extrai fatos crus da aplicação.
 *
 * REGRA ARQUITETURAL: nada aqui importa de `src/albrecht/**`.
 * O inventário não sabe o que é um ALI.
 *
 * ORDEM DAS FONTES, do mais confiável ao menos:
 *   1. artefato gerado  — registry de rotas, schema de dados
 *   2. runtime          — router.toJSON(), metadados do Lucid
 *   3. AST              — grafo de chamadas, detecção de escrita
 *   4. convenção        — só para agrupar relatório, nunca para encontrar
 */
export * from './resolvers/index.js'
export type { AppContext } from './app_context.js'
