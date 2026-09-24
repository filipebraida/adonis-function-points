// A configuration that throws on load. It must NEVER fall back to the defaults:
// the count would change without anyone being told.
throw new Error('boom: this config is broken on purpose')
