/**
 * Camada de inventário: extrai fatos crus da aplicação.
 *
 * REGRA ARQUITETURAL: nada aqui pode importar de `src/albrecht/**`.
 * O inventário não sabe o que é um ALI. Isso é o que permite extrair esta
 * camada para um pacote próprio se as outras métricas crescerem.
 */
export * from './resolvers/index.js'
