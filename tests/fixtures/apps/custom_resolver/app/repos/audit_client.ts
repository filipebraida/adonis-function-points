/**
 * A thin wrapper over an external audit endpoint. Its methods are generated at
 * runtime, so `push` is nowhere in the source: the tracer resolves the symbol,
 * finds no body, and reports the call.
 *
 * It reaches no data store of this application — but the package cannot know
 * that, and guessing from the name is exactly what it must not do.
 */
export default class AuditClient {
  constructor(private endpoint: string = '/audit') {}

  url() {
    return this.endpoint
  }
}
