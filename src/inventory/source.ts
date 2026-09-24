import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { toPosix } from './paths.js'

/**
 * What a count counted.
 *
 * A saved count used to say which RULESET produced it and nothing about its
 * subject — no revision, no branch, no date. Two such files compare cleanly and
 * mean nothing: the same application a month apart, or two different
 * applications, are indistinguishable once the number is on an invoice.
 *
 * This is not hypothetical. A production application here moved from 714 to 768
 * points, and the first explanation reached for was a defect in the counter.
 * It was a month of development: the counter returned identical totals across
 * twelve of its own commits. Half a day answering a question the artefact
 * should have answered itself.
 */
export type CountSource = {
  /**
   * Identity of the application counted.
   *
   * The package.json name when there is one, the directory name otherwise —
   * never the absolute path, which says where the machine keeps its files and
   * travels with every count sent anywhere.
   */
  app: string
  /** commit counted, when the root is a git repository */
  revision?: string
  branch?: string
  /**
   * Uncommitted changes were present.
   *
   * The field that matters most in billing: a count taken over a dirty tree
   * cannot be reproduced from any revision, and whoever receives the invoice is
   * entitled to know that before paying it.
   */
  dirty?: boolean
  countedAt: string
  /** configuration file that shaped the count, or null for the defaults */
  config: string | null
}

const git = (root: string, args: string[]): string | undefined => {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    // not a repository, or no git: the count is still valid, just less traceable
    return undefined
  }
}

export function describeSource(root: string, config: string | null): CountSource {
  /**
   * Normalised here rather than trusted from the caller. `loadConfig` already
   * returns a canonical path, but `analyze()` takes `configFile` from anyone
   * using the package as a library, and whatever arrives is what ships inside
   * every saved count.
   */
  const revision = git(root, ['rev-parse', 'HEAD'])
  const status = revision === undefined ? undefined : git(root, ['status', '--porcelain'])

  return {
    app: appName(root),
    revision,
    branch: revision === undefined ? undefined : git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: status === undefined ? undefined : status.length > 0,
    countedAt: new Date().toISOString(),
    config: config === null ? null : toPosix(config),
  }
}

function appName(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      name?: string
    }
    if (pkg.name) return pkg.name
  } catch {
    // no manifest, or unreadable: the directory name still identifies it
  }

  return path.basename(root)
}
