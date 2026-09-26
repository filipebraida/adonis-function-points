import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { test } from '@japa/runner'

/**
 * THE LIBRARY IS FUNCTION POINTS, NOT FUNCTION POINTS FOR ONE APPLICATION
 *
 * Its rules are found by recounting real applications — that is the method — and the
 * names of those applications kept leaking in: a heuristic keyed on the words one team
 * uses for its result keys, a page layout only one front-end has, forty comments quoting
 * routes and models of somebody's domain. A heuristic keyed on one application's
 * vocabulary is not a rule; an example lifted from one application is not an example.
 *
 * So the words that belong to the validated applications live HERE, in the test, and
 * nowhere else in the repository. Behaviour may name only what the framework or the
 * language names; comments illustrate with the library's neutral domain; shipped docs
 * cite the measurement, not the domain. Fixtures are not scanned: their neutral domains
 * are the library's own. The plans under docs/design/plan-*.md are the field notebook and
 * may say anything.
 */
const FORBIDDEN = [
  // application names
  'peticao',
  'sae',
  'agencia-inovacao',
  'agenciainovacao',
  // domains of the validated applications
  'intake',
  'preintake',
  'pre_intake',
  'petition',
  'gestao',
  'atribuicao',
  'attachmentsforsignature',
  'egresso',
  'matricula',
  'comunicado',
  'questionario',
  'inpi',
  'inventor',
  'ufrrj',
  'govbr',
  'paralinha',
  'sincronizarbulk',
  'createfrombuffer',
  'intakeservice',
  'foregresso',
]

const ROOT = join(import.meta.dirname, '..', '..')
const SCANNED = ['src', 'docs', 'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md']
const SKIPPED = /^docs\/design\/plan-.*\.md$/

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* files(full)
    else if (/\.(ts|md)$/.test(entry)) yield full
  }
}

test.group('no project literals in the library', () => {
  test('src, docs, README and CHANGELOG name no validated application or its domain', ({
    assert,
  }) => {
    const offences: string[] = []
    const pattern = new RegExp(`(^|[^a-z0-9_])(${FORBIDDEN.join('|')})(?![a-z0-9_])`, 'i')

    for (const entry of SCANNED) {
      const full = join(ROOT, entry)
      const paths = statSync(full).isDirectory() ? [...files(full)] : [full]
      for (const path of paths) {
        const rel = relative(ROOT, path).split('\\').join('/')
        if (SKIPPED.test(rel) || rel.endsWith('no_project_literals.spec.ts')) continue
        const lines = readFileSync(path, 'utf8').split('\n')
        lines.forEach((line, i) => {
          const match = line.match(pattern)
          if (match) offences.push(`${rel}:${i + 1}  ${match[2]}  — ${line.trim().slice(0, 80)}`)
        })
      }
    }

    assert.deepEqual(
      offences,
      [],
      `a validated application's name or domain is in the library:\n${offences.join('\n')}`
    )
  })
})
