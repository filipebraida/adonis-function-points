/**
 * Fallback: parseia `routes.ts` quando não há registry gerado.
 *
 * Armadilhas já pagas (ver spike-findings.md):
 *  - rotas são multi-linha (`router\n  .get(...)`); normalizar whitespace ou
 *    o casamento falha em ~86% das rotas;
 *  - `.resource()` expande para até 7 rotas, filtradas por `.only()`/`.apiOnly()`;
 *  - o arquivo pode ser um só (`start/routes.ts`) ou um por módulo.
 */
export {}
