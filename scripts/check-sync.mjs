/**
 * Drift guard for the copied engine.
 *
 * src/core holds a verbatim copy of the Diagram Desk engine. A copy is only
 * honest if you can tell when it has gone stale, so this script diffs the copy
 * against the original when that project is checked out next door, and can
 * refresh it with --fix.
 *
 * Exits 0 when in sync or when the original is not present, 1 when it differs.
 */

import { readFileSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const upstream = process.env.DIAGRAM_DESK_PATH ?? resolve(root, '..', 'diagram-desk')

/** [file in this project, matching file in diagram-desk] */
const FILES = [
  ['src/core/model/types.ts', 'src/model/types.ts'],
  ['src/core/model/parser.ts', 'src/model/parser.ts'],
  ['src/core/model/layout.ts', 'src/model/layout.ts'],
  ['src/core/model/geometry.ts', 'src/model/geometry.ts'],
  ['src/core/export/svg.ts', 'src/export/svg.ts'],
  ['src/core/model/parser.test.ts', 'src/model/parser.test.ts'],
  ['src/core/model/layout.test.ts', 'src/model/layout.test.ts'],
]

const fix = process.argv.includes('--fix')

if (!existsSync(upstream)) {
  console.log(`diagram-desk is not at ${upstream}, nothing to compare. Set DIAGRAM_DESK_PATH to point at it.`)
  process.exit(0)
}

const drifted = []
for (const [mine, theirs] of FILES) {
  const minePath = join(root, mine)
  const theirsPath = join(upstream, theirs)
  if (!existsSync(theirsPath)) {
    console.log(`missing upstream: ${theirs}`)
    drifted.push(mine)
    continue
  }
  if (readFileSync(minePath, 'utf8') === readFileSync(theirsPath, 'utf8')) continue
  if (fix) {
    copyFileSync(theirsPath, minePath)
    console.log(`updated ${mine}`)
    continue
  }
  drifted.push(mine)
}

if (drifted.length === 0) {
  console.log(fix ? 'engine copy is up to date' : `engine copy matches ${upstream}`)
  process.exit(0)
}

console.error(`engine copy differs from ${upstream}:`)
for (const file of drifted) console.error(`  ${file}`)
console.error('Run npm run check:sync -- --fix to copy the current version over, then run the tests.')
process.exit(1)
