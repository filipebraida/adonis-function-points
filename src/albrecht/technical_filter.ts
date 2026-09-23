/**
 * Filtro de dados técnicos — AFP 6.5.2.1.1.
 *
 *   "Database tables identified as temporary or technical shall be marked as
 *    such to be presented in the final report, and shall be ignored in the rest
 *    of this process."
 *
 * Três mecanismos, do mais fraco ao mais forte:
 *
 *  1. estrutura de lookup (6.5.2.1.2): uma PK, no máximo um inteiro de ordem,
 *     nenhum cascade delete apontando para ela, menos de três atributos de
 *     texto ou nomes casando com name|message|type|code|description|label;
 *
 *  2. convenção de nome (6.5.2.1.3), configurável, defaults do próprio spec;
 *
 *  3. ORIGEM DA ESCRITA (nosso): se toda escrita numa tabela nasce em código de
 *     `node_modules` e nenhuma em código da aplicação, a tabela é infraestrutura
 *     daquele pacote. Não depende de nome nem de lista, e funciona para pacote
 *     que ninguém previu — que é o requisito real, já que qualquer pacote pode
 *     acrescentar tabela.
 *
 * E a rede normativa acima de todas, AFP 6.5.4:
 *
 *   "If a Data Function is not used in any of the processing of an
 *    application's Transactional Functions, the Data Function shall not be
 *    counted in the application."
 */
export {}
