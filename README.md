# @filipebraida/adonis-function-points

Contagem automatizada de pontos de função e métricas de código para aplicações
AdonisJS.

> **Estado: em desenvolvimento.** O scaffold e o desenho estão prontos; os
> coletores ainda não. Ver [`docs/design/architecture.md`](docs/design/architecture.md).

## Por quê

Fábricas de software faturam por ponto de função, e a contagem é manual, lenta
e varia de contador para contador. Existem ferramentas comerciais de contagem
automatizada para legado enterprise, mas **nenhum framework moderno tem uma** —
nem Laravel, nem Rails, nem AdonisJS. O que existe nesses ecossistemas
(`rails stats`, `laravel-stats`, `adonisjs-stats`) conta classes e linhas, que
é outra coisa.

Este pacote implementa o padrão **OMG Automated Function Points**
(ISO/IEC 19515), que define como automatizar o IFPUG CPM substituindo os
julgamentos subjetivos por regras determinísticas.

## O que faz

```bash
node ace fp:inventory     # extrai os fatos crus da aplicação
node ace fp:count         # conta PF não ajustados
node ace fp:diff HEAD~50  # inclusão / alteração / exclusão entre duas versões
node ace fp:explain orders.store    # por que esta função foi contada assim
node ace fp:calibrate contagens.csv # fatores de correção vs contagem manual
```

`fp:diff` é o que vira fatura num contrato por demanda: classifica cada função
como inclusão, alteração ou exclusão, que é o que o roteiro de métricas do SISP
precisa.

## Princípios

**Rastreabilidade.** Toda função contada diz de onde veio: arquivo, linha,
regra aplicada, origem de cada DET e de cada FTR. Se PF vira fatura, alguém vai
contestar um número — e um número sem procedência é indefensável.

**Dizer "não sei" em vez de errar em silêncio.** Chamada que o rastreamento não
consegue seguir entra na métrica de cobertura. Se a cobertura cai abaixo do
limite configurado, a contagem falha em vez de emitir um número que parece
certo.

**Extensibilidade como requisito.** AdonisJS não impõe padrão de organização —
controller gordo, action object, service estático, repository, job. As
estratégias de rastreamento são registráveis; um projeto com convenção própria
registra a sua.

**Consistência acima de exatidão.** Contra um contador certificado, espere
5–15% de desvio. Mas a repetibilidade é total: a mesma regra, sempre, sem
variação entre analistas. Erro sistemático se calibra; variância entre
contadores, não.

## Instalação

```bash
npm i @filipebraida/adonis-function-points
node ace configure @filipebraida/adonis-function-points
```

## Configuração

A fronteira da aplicação é uma decisão de negócio, não técnica — por isso é
configuração, não heurística.

```ts
// config/function_points.ts
import { defineConfig } from '@filipebraida/adonis-function-points'

export default defineConfig({
  boundary: {
    infrastructure: ['access_tokens', 'audits'],
    externallyMaintained: ['erp_customers'],   // viram AIE em vez de ALI
    ignoreEntryPoints: ['prometheus.metrics'],
  },
  retStrategy: 'constant',
  maxCallDepth: 3,
  minCoverage: 0.85,
})
```

### Padrão de código próprio

```ts
import type { CallResolver } from '@filipebraida/adonis-function-points'

const repositoryResolver: CallResolver = {
  name: 'my-repository',
  order: 5,
  resolve(call, ctx) {
    /* devolve os corpos a seguir */
    return []
  },
}

export default defineConfig({
  resolvers: { call: [repositoryResolver] },
})
```

## Limitações conhecidas

Herdadas do próprio padrão AFP, não da implementação:

- **CE é colapsado em SE.** Distinguir consulta de saída exige saber se há
  cálculo ou dado derivado, o que análise estática não vê. É o que o AFP manda.
- **RET aproximado.** O que o usuário reconhece como subgrupo lógico não é
  derivável do código.
- **Mensagens de erro e confirmação** contam 1 DET na contagem manual e são
  invisíveis aqui. Em casos limítrofes isso muda a faixa de complexidade.
- **VAF não é calculado.** As 14 características gerais do sistema exigem
  julgamento humano. O AFP fixa VAF = 1, e contagem não ajustada é o que vale
  em contrato público brasileiro.

Medições e divergências esperadas em
[`docs/research/spike-findings.md`](docs/research/spike-findings.md).

## Licença

MIT
