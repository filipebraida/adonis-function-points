/**
 * O grafo transação -> funções de dados.
 *
 * É a espinha da contagem, e a origem de quase toda a incerteza do pacote.
 * Três das quatro decisões de borda em counting-decisions.md se resolvem aqui:
 * rota estática não alcança dado e não conta; rota de pacote terceiro idem;
 * hook de model entra porque está no caminho.
 *
 * O AFP manda agregar TODOS os caminhos alcançáveis:
 *
 *   "When the static code analyzer finds multiple optional paths in the context
 *    of a transaction, it shall consider these multiple optional paths to be
 *    part of the same transaction in order to capture all data functions
 *    handled."  — AFP 6.5.3
 *
 * Percorre em nível de MÉTODO, nunca de arquivo: um service de domínio com 38
 * escritas marcaria como escritor todo mundo que o importa.
 */
export {}
