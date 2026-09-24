import { BaseMailer } from '@adonisjs/mail'

/**
 * A class whose useful method comes from a package base and has NO
 * application-side counterpart — unlike a transformer, where `transform()`
 * calls back into the `toObject()` the application wrote.
 *
 * So `sendLater` genuinely cannot be followed, and that is the point: the
 * tracer resolves the file, fails to find the body, and must SAY so. Dropping
 * it silently would lose a path with nobody the wiser.
 */
export default class InviteMailer extends BaseMailer {
  prepare() {}
}
