// Armadilha: este arquivo EXISTE, e é para onde `#app/*` apontaria.
// O alias mais específico `#app/legacy/*` tem que vencer e resolver para
// vendor/legacy/importer.ts — senão o erro é silencioso e aponta para cá.
export default class WrongImporter {}
