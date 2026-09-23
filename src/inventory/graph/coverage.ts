/**
 * Cobertura do rastreamento — e o AFP exige que ela exista:
 *
 *   "If the transaction execution depends on code that is unknown or
 *    unavailable to the automated tool, the code end point shall be cataloged
 *    and listed in the generated report in order to detect and quantify the
 *    missing patterns and libraries."  — AFP 6.5.3
 *
 * Um endpoint que não alcança dado nenhum significa duas coisas opostas: a rota
 * é legitimamente estática, ou o rastreador falhou. As duas têm que ser
 * visíveis; abaixo de `minCoverage` a contagem falha em vez de emitir número.
 */
export {}
