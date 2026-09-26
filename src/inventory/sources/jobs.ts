import { Node, Project, SyntaxKind } from 'ts-morph'

import type { AppContext } from '../app_context.js'
import { importMapsOf } from '../graph/call_graph.js'
import { isApplicationCode, toPosix } from '../paths.js'
import { DISPATCH_METHODS, EXECUTION_METHODS } from '../resolvers/job_dispatch.js'

/**
 * The application's queue jobs, and who dispatches each — plan 0.7 §D.
 *
 * A job dispatched by a handler is part of that handler's transaction (§9): the
 * user clicks, the effect happens, asynchronously or not. A job that NO
 * transaction reaches is one of two things, and the code cannot say which:
 *
 *   scheduled    `PodarAuditoriaJob.schedule({}).cron('0 3 * * *')` in a start
 *                file — an elementary process nobody is counting
 *   dead code    dispatched by nothing at all
 *
 * Reported, not counted: inventing an elementary process is the error this
 * package exists to avoid. When a scheduler appears on a real application, it
 * becomes an entry point `job:<Class>` with the identity §5 already decided.
 */

export type CollectedJob = {
  /** the class name */
  name: string
  /** absolute, posix */
  file: string
  /** files that dispatch it (`X.dispatch(…)`), absolute posix — inside a transaction or not */
  dispatchedFrom: string[]
  /** files that schedule it (`X.schedule({}).cron(…)`): a scheduler, which no transaction is */
  scheduledFrom: string[]
}

/** `X.schedule({}).cron(…)`: a scheduler's way of dispatching */
const SCHEDULE_METHODS = new Set(['schedule'])

export function collectJobs(app: AppContext): CollectedJob[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false },
  })
  const root = toPosix(app.root)
  for (const dir of app.scanRoots) project.addSourceFilesAtPaths(`${toPosix(dir)}/**/*.ts`)
  // a scheduler lives in `start/`, a batch dispatcher in `commands/`: neither is an alias root
  project.addSourceFilesAtPaths(`${root}/start/**/*.ts`)
  project.addSourceFilesAtPaths(`${root}/commands/**/*.ts`)

  const jobs = new Map<string, CollectedJob>()
  for (const file of project.getSourceFiles()) {
    const filePath = toPosix(file.getFilePath())
    if (!isApplicationCode(app.root, filePath) || !inJobsDirectory(filePath)) continue
    for (const cls of file.getClasses()) {
      const name = cls.getName()
      if (!name || !looksLikeJob(cls)) continue
      jobs.set(filePath, { name, file: filePath, dispatchedFrom: [], scheduledFrom: [] })
    }
  }
  if (jobs.size === 0) return []

  for (const file of project.getSourceFiles()) {
    const filePath = toPosix(file.getFilePath())
    if (/\.(spec|test)\.ts$/.test(file.getBaseName())) continue
    const { imports } = importMapsOf(file, app)
    if (imports.size === 0) continue

    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression()
      if (!Node.isPropertyAccessExpression(callee)) continue
      const method = callee.getName()
      const scheduled = SCHEDULE_METHODS.has(method)
      if (!scheduled && !DISPATCH_METHODS.has(method)) continue
      const receiver = callee.getExpression()
      if (!Node.isIdentifier(receiver)) continue
      const target = imports.get(receiver.getText())
      const job = target ? jobs.get(toPosix(target)) : undefined
      if (!job) continue
      const sites = scheduled ? job.scheduledFrom : job.dispatchedFrom
      if (!sites.includes(filePath)) sites.push(filePath)
    }
  }

  return [...jobs.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const inJobsDirectory = (filePath: string) =>
  filePath
    .split('/')
    .slice(0, -1)
    .some((segment) => segment === 'jobs' || segment === 'job')

/** extends something called `…Job`, or declares the method a queue would run */
function looksLikeJob(cls: import('ts-morph').ClassDeclaration): boolean {
  const parent = cls.getExtends()?.getExpression().getText() ?? ''
  if (/Job$/.test(parent)) return true
  return EXECUTION_METHODS.some((method) => cls.getMethod(method) !== undefined)
}
