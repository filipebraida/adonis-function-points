/**
 * Fonte: `database/schema.ts` (gerado das migrations).
 *
 * Classes `<Nome>Schema extends BaseModel` com `static $columns` canônico.
 * Localização varia (`database/` ou `app/core/database/`); identifica-se pelo
 * cabeçalho de geração e pela forma das classes, nunca pelo caminho.
 *
 * É a fonte certa de DETs, e resolve sozinha duas variações que quebrariam
 * um parser de models:
 *
 *  - models que não estendem BaseModel do Lucid (numa app: 35 arquivos, zero);
 *  - colunas acrescentadas por PACOTES via migration própria, que aparecem
 *    aqui sem o contador precisar saber que aquele pacote existe.
 *
 * Parsear `app/**\/models/*.ts` subcontou DETs em ~20% no spike.
 */
export {}
