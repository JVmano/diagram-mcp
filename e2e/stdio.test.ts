/**
 * End to end smoke test: launch the built server the way an MCP client does,
 * over stdio, and drive it with a real MCP client.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const outputDir = mkdtempSync(join(tmpdir(), 'diagram-mcp-e2e-'))
const serverPath = resolve(process.cwd(), 'dist/index.js')

let client: Client

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content
  return content.map((part) => part.text ?? '').join('\n')
}

beforeAll(async () => {
  client = new Client({ name: 'diagram-mcp-test-client', version: '1.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: { ...process.env, DIAGRAM_MCP_OUTPUT_DIR: outputDir },
    }),
  )
})

afterAll(async () => {
  await client?.close()
  rmSync(outputDir, { recursive: true, force: true })
})

describe('the server over stdio', () => {
  it('advertises the three tools with usable schemas', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['diagram_syntax', 'render_diagram', 'validate_diagram'])

    const render = tools.find((tool) => tool.name === 'render_diagram')!
    expect(render.description).toContain('PNG')
    expect(Object.keys(render.inputSchema.properties ?? {}).sort()).toEqual([
      'background',
      'code',
      'name',
      'outputPath',
      'overwrite',
      'padding',
      'scale',
    ])
    expect(render.inputSchema.required).toEqual(['code'])
  })

  it('renders diagram code to a PNG on disk', async () => {
    const result = await client.callTool({
      name: 'render_diagram',
      arguments: {
        code: `title "Ambassador ingest"
direction LR

node upload "CSV uploaded" shape=rounded
node parse "Parse rows"
node valid "Valid?" shape=diamond size=180x96
node store "Write to database"
node reject "Send error report"

upload -> parse
parse -> valid
valid -> store "yes"
valid -> reject "no"
`,
        name: 'ingest',
      },
    })

    expect(result.isError).toBeFalsy()
    const body = textOf(result)
    const expectedPath = join(outputDir, 'ingest.png')
    expect(body).toContain(expectedPath)
    expect(body).toContain('5 shapes, 4 connections')

    const file = readFileSync(expectedPath)
    expect(file.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(file.length).toBeGreaterThan(2000)
  })

  it('returns an error result for code that does not parse, and writes nothing', async () => {
    const result = await client.callTool({
      name: 'render_diagram',
      arguments: { code: 'node a "A"\na -> nowhere\n', name: 'broken' },
    })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('edge refers to undefined node "nowhere".')
    expect(() => readFileSync(join(outputDir, 'broken.png'))).toThrow()
  })

  it('validates code without writing a file', async () => {
    const result = await client.callTool({
      name: 'validate_diagram',
      arguments: { code: 'node a "A"\nnode b "B"\na -> b\n' },
    })
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('The diagram code is valid. 2 shapes, 1 connections')
  })

  it('hands out the language reference', async () => {
    const result = await client.callTool({ name: 'diagram_syntax', arguments: {} })
    expect(textOf(result)).toContain('Diagram code reference')
  })

  it('rejects a call that is missing the code argument', async () => {
    const result = await client.callTool({ name: 'render_diagram', arguments: { name: 'nope' } }).catch(() => null)
    if (result === null) return
    expect(result.isError).toBe(true)
  })
})
