import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { readConfig, type Config } from './config'
import { RenderError, renderToPng, resolveOutputPath, safeBaseName, validateCode } from './render'

const root = mkdtempSync(join(tmpdir(), 'diagram-mcp-test-'))
const workdir = join(root, 'work')

function config(overrides: Partial<Config> = {}): Config {
  return { ...readConfig({}), outputDir: join(root, 'renders'), ...overrides }
}

const VALID = `title "Release checklist"
direction TB

node branch "Cut release branch" shape=rounded
node tests "CI green?" shape=diamond size=180x96
node ship "Deploy" shape=rounded

branch -> tests
tests -> ship "yes"
`

beforeEach(() => {
  rmSync(join(root, 'renders'), { recursive: true, force: true })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** The first eight bytes of every PNG file. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('safeBaseName', () => {
  it('keeps a readable name and drops the rest', () => {
    expect(safeBaseName('Release checklist / v2: final')).toBe('Release-checklist-v2-final')
  })

  it('falls back when nothing usable is left', () => {
    expect(safeBaseName('///')).toBe('diagram')
    expect(safeBaseName('   ')).toBe('diagram')
  })

  it('clamps a very long name', () => {
    expect(safeBaseName('n'.repeat(200))).toHaveLength(60)
  })
})

describe('validateCode', () => {
  it('accepts valid code and counts what it found', () => {
    const report = validateCode(VALID, config())
    expect(report).toMatchObject({ ok: true, title: 'Release checklist', nodeCount: 3, edgeCount: 2 })
    expect(report.autoPlacedCount).toBe(3)
    expect(report.problems).toEqual([])
  })

  it('reports errors with line numbers', () => {
    const report = validateCode('node a "A"\na -> ghost\nwibble', config())
    expect(report.ok).toBe(false)
    expect(report.problems).toEqual([
      { severity: 'error', line: 3, message: expect.stringMatching(/unknown instruction "wibble"/) },
      { severity: 'error', line: 2, message: 'edge refers to undefined node "ghost".' },
    ])
  })

  it('refuses code above the size limit before parsing it', () => {
    const report = validateCode('x'.repeat(2000), config({ maxCodeChars: 1000 }))
    expect(report.ok).toBe(false)
    expect(report.problems[0]?.message).toMatch(/above the 1000 limit/)
  })
})

describe('resolveOutputPath', () => {
  it('names the file after the title when nothing else is given', () => {
    const path = resolveOutputPath(config(), { title: 'Release checklist' })
    expect(path).toBe(resolve(root, 'renders', 'Release-checklist.png'))
  })

  it('prefers an explicit name over the title', () => {
    const path = resolveOutputPath(config(), { name: 'custom', title: 'Release checklist' })
    expect(path).toBe(resolve(root, 'renders', 'custom.png'))
  })

  it('adds a suffix rather than overwriting an existing render', async () => {
    await renderToPng({ code: VALID, name: 'dup' }, config())
    const second = resolveOutputPath(config(), { name: 'dup' })
    expect(second).toBe(resolve(root, 'renders', 'dup-2.png'))
  })

  it('reuses the same path when overwrite is asked for', async () => {
    await renderToPng({ code: VALID, name: 'over' }, config())
    expect(resolveOutputPath(config(), { name: 'over', overwrite: true })).toBe(
      resolve(root, 'renders', 'over.png'),
    )
  })

  it('accepts a path inside the working directory', () => {
    const path = resolveOutputPath(config(), { outputPath: 'docs/flow.png' }, workdir)
    expect(path).toBe(resolve(workdir, 'docs/flow.png'))
  })

  it('refuses a path outside the allowed roots', () => {
    expect(() => resolveOutputPath(config(), { outputPath: '/etc/evil.png' }, workdir)).toThrow(
      /must be inside the render directory/,
    )
    expect(() => resolveOutputPath(config(), { outputPath: '../../escape.png' }, workdir)).toThrow(
      /must be inside the render directory/,
    )
  })

  it('allows any path once the operator opts in', () => {
    const path = resolveOutputPath(config({ allowAnyOutputPath: true }), { outputPath: '/tmp/anywhere.png' }, workdir)
    expect(path).toBe(resolve('/tmp/anywhere.png'))
  })

  it('insists on a png extension', () => {
    expect(() => resolveOutputPath(config(), { outputPath: 'flow.jpg' }, workdir)).toThrow(/must end in \.png/)
  })
})

describe('renderToPng', () => {
  it('writes a real PNG and reports what it drew', async () => {
    const result = await renderToPng({ code: VALID }, config())

    expect(result.path).toBe(resolve(root, 'renders', 'Release-checklist.png'))
    expect(result).toMatchObject({ title: 'Release checklist', nodeCount: 3, edgeCount: 2, autoPlacedCount: 3 })
    expect(result.width).toBeGreaterThan(100)
    expect(result.height).toBeGreaterThan(100)

    const file = readFileSync(result.path)
    expect(file.subarray(0, 8)).toEqual(PNG_MAGIC)
    expect(file.length).toBe(result.bytes)
    expect(file.length).toBeGreaterThan(1000)
  })

  it('scales the output', async () => {
    const single = await renderToPng({ code: VALID, name: 'one', scale: 1 }, config())
    const double = await renderToPng({ code: VALID, name: 'two', scale: 2 }, config())
    expect(double.width).toBeGreaterThan(single.width * 1.8)
    expect(double.height).toBeGreaterThan(single.height * 1.8)
  })

  it('creates the render directory when it is missing', async () => {
    const result = await renderToPng({ code: VALID, name: 'fresh' }, config({ outputDir: join(root, 'brand/new') }))
    expect(readFileSync(result.path).subarray(0, 8)).toEqual(PNG_MAGIC)
  })

  it('refuses code with errors and never writes a file', async () => {
    const target = config()
    await expect(renderToPng({ code: 'node a "A"\na -> ghost', name: 'bad' }, target)).rejects.toThrow(RenderError)
    expect(() => readFileSync(resolve(target.outputDir, 'bad.png'))).toThrow()
  })

  it('carries the problem list on the error so the caller can fix the code', async () => {
    const error = await renderToPng({ code: 'wibble', name: 'bad' }, config()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(RenderError)
    expect((error as RenderError).problems[0]).toMatchObject({ line: 1, severity: 'error' })
  })

  it('refuses an empty diagram rather than writing a blank image', async () => {
    await expect(renderToPng({ code: '# just a comment', name: 'empty' }, config())).rejects.toThrow(/no shapes/)
  })

  it('reports warnings without failing the render', async () => {
    const result = await renderToPng({ code: 'node a "A" colour=red', name: 'warn' }, config())
    expect(result.warnings[0]?.message).toMatch(/ignored unknown node option/)
    expect(readFileSync(result.path).subarray(0, 8)).toEqual(PNG_MAGIC)
  })

  it('renders a transparent background when asked', async () => {
    const opaque = await renderToPng({ code: VALID, name: 'opaque', background: 'white' }, config())
    const clear = await renderToPng({ code: VALID, name: 'clear', background: 'transparent' }, config())
    expect(readFileSync(clear.path).length).not.toBe(readFileSync(opaque.path).length)
  })

  it('surfaces a write failure as a RenderError', async () => {
    const blocked = join(root, 'blocked')
    writeFileSync(blocked, 'not a directory')
    await expect(
      renderToPng({ code: VALID, name: 'nope' }, config({ outputDir: join(blocked, 'sub') })),
    ).rejects.toThrow(/could not be written/)
  })
})
