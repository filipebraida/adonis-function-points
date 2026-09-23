/**
 * Fonte: hooks de model (`@afterCreate`, `@beforeSave`, …).
 *
 * Presentes em 4 das 6 aplicações levantadas. Pela decisão registrada em
 * docs/design/counting-decisions.md, um hook NÃO é transação própria — ele não
 * cruza a fronteira — mas suas escritas pertencem à transação que o disparou.
 *
 * Portanto o grafo precisa entrar nos hooks do model ao alcançar uma escrita
 * nele. Ignorá-los subconta FTR e pode classificar como AIE uma tabela que é
 * ALI.
 */
export {}
