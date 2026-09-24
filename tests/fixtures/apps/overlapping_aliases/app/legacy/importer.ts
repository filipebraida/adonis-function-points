// Trap: this file EXISTS, and it is where `#app/*` would point.
// The more specific alias `#app/legacy/*` must win and resolve to
// vendor/legacy/importer.ts — otherwise the error is silent and lands here.
export default class WrongImporter {}
