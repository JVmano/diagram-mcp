import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readConfig, type Config } from './config'
import { handleDiagramSyntax, handlePreviewDiagram, handleRenderDiagram, handleValidateDiagram } from './tools'

const root = mkdtempSync(join(tmpdir(), 'diagram-mcp-tools-'))

function config(overrides: Partial<Config> = {}): Config {
  return { ...readConfig({}), outputDir: join(root, 'renders'), ...overrides }
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const VALID = 'title "Flow"\nnode a "Start" shape=rounded\nnode b "End"\na -> b "go"\n'

describe('render_diagram', () => {
  it('returns the path and a summary of what was drawn', async () => {
    const result = await handleRenderDiagram({ code: VALID, name: 'summary' }, config())
    expect(result.isError).toBeUndefined()
    const body = result.content[0]!.text
    expect(body).toContain(join(root, 'renders', 'summary.png'))
    expect(body).toContain('2 shapes, 1 connections')
    expect(body).toMatch(/\d+ x \d+ px/)
    expect(body).toContain('placed by the automatic layout')
  })

  it('reports bad code as an error with the line numbers', async () => {
    const result = await handleRenderDiagram({ code: 'node a "A"\na -> ghost\n', name: 'bad' }, config())
    expect(result.isError).toBe(true)
    const body = result.content[0]!.text
    expect(body).toContain('error on line 2: edge refers to undefined node "ghost".')
    expect(body).toContain('diagram_syntax')
  })

  it('reports a refused output path instead of writing somewhere unexpected', async () => {
    const result = await handleRenderDiagram({ code: VALID, outputPath: '/etc/hosts.png' }, config(), root)
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('must be inside the render directory')
  })

  it('mentions warnings on an otherwise successful render', async () => {
    const result = await handleRenderDiagram({ code: 'node a "A" colour=red', name: 'warned' }, config())
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain('Warnings:')
  })
})

describe('validate_diagram', () => {
  it('confirms valid code without writing anything', () => {
    const result = handleValidateDiagram({ code: VALID }, config())
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain('The diagram code is valid. 2 shapes, 1 connections')
  })

  it('lists every problem for broken code', () => {
    const result = handleValidateDiagram({ code: 'node a "A"\nnode a "again"\nwibble\n' }, config())
    expect(result.isError).toBe(true)
    const body = result.content[0]!.text
    expect(body).toContain('error on line 2: duplicate node id "a"')
    expect(body).toContain('error on line 3')
  })

  it('separates warnings from errors', () => {
    const result = handleValidateDiagram({ code: 'node a "A" colour=red' }, config())
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain('valid, with warnings')
  })
})

describe('preview_diagram', () => {
  it('returns the drawing in a fenced block with a summary', () => {
    const result = handlePreviewDiagram({ code: VALID }, config())
    expect(result.isError).toBeUndefined()
    const body = result.content[0]!.text
    expect(body.startsWith('```')).toBe(true)
    expect(body).toContain('Start')
    expect(body).toContain('2 shapes, 1 connections.')
  })

  it('refuses broken code with the line numbers', () => {
    const result = handlePreviewDiagram({ code: 'node a "A"\na -> ghost' }, config())
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('error on line 2')
  })
})

describe('diagram_syntax', () => {
  it('returns a reference that covers the whole language', () => {
    const body = handleDiagramSyntax().content[0]!.text
    for (const token of ['title', 'direction LR', 'node <id>', 'shape=', 'at=', 'size=', 'style=solid|dashed']) {
      expect(body).toContain(token)
    }
  })
})
