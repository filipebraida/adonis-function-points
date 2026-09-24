// A framework service reached through an application alias. `env` lives in the
// app's own module graph, so the tracer resolves the symbol — and then finds no
// body, because `get` comes from the package.
export const env = { get: (key: string) => key }
