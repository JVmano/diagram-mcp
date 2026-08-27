import { describe, expect, it } from 'vitest'
import { parseDiagram, tokenize } from './parser'
import { LIMITS } from './types'

describe('tokenize', () => {
  it('separates quoted text from bare words', () => {
    const { tokens, error } = tokenize('node a "Hello world" shape=diamond')
    expect(error).toBeUndefined()
    expect(tokens).toEqual([
      { kind: 'word', value: 'node' },
      { kind: 'word', value: 'a' },
      { kind: 'string', value: 'Hello world' },
      { kind: 'word', value: 'shape=diamond' },
    ])
  })

  it('understands escaped quotes and newlines', () => {
    const { tokens } = tokenize('node a "say \\"hi\\"\\nnow"')
    expect(tokens[2]).toEqual({ kind: 'string', value: 'say "hi"\nnow' })
  })

  it('reports an unterminated quote instead of guessing', () => {
    const { error } = tokenize('node a "unfinished')
    expect(error).toMatch(/unterminated/)
  })
})

describe('parseDiagram', () => {
  it('parses a complete diagram', () => {
    const result = parseDiagram(`# a comment
title "Checkout"
direction TB

node start "Start" shape=rounded at=40,80 size=200x72
node check "Valid?" shape=diamond

start -> check "maybe" style=dashed
`)
    expect(result.problems).toEqual([])
    expect(result.diagram.title).toBe('Checkout')
    expect(result.diagram.direction).toBe('TB')
    expect(result.diagram.nodes).toHaveLength(2)
    expect(result.diagram.nodes[0]).toMatchObject({
      id: 'start',
      label: 'Start',
      shape: 'rounded',
      x: 40,
      y: 80,
      width: 200,
      height: 72,
    })
    expect(result.diagram.nodes[1]).toMatchObject({ id: 'check', shape: 'diamond', x: null, y: null })
    expect(result.diagram.edges[0]).toMatchObject({ from: 'start', to: 'check', label: 'maybe', style: 'dashed' })
  })

  it('accepts the optional edge keyword and shape aliases', () => {
    const result = parseDiagram('node a "A" shape=box\nnode b "B" shape=round\nedge a -> b')
    expect(result.problems).toEqual([])
    expect(result.diagram.nodes.map((node) => node.shape)).toEqual(['rect', 'rounded'])
    expect(result.diagram.edges).toHaveLength(1)
  })

  it('falls back to the id when no label is given', () => {
    const result = parseDiagram('node lonely')
    expect(result.diagram.nodes[0]?.label).toBe('lonely')
  })

  it('rejects an edge pointing at a node that does not exist', () => {
    const result = parseDiagram('node a "A"\na -> ghost')
    expect(result.diagram.edges).toHaveLength(0)
    expect(result.problems).toEqual([
      { severity: 'error', line: 2, message: 'edge refers to undefined node "ghost".' },
    ])
  })

  it('keeps the first of two nodes sharing an id and reports the clash', () => {
    const result = parseDiagram('node a "First"\nnode a "Second"')
    expect(result.diagram.nodes).toHaveLength(1)
    expect(result.diagram.nodes[0]?.label).toBe('First')
    expect(result.problems[0]).toMatchObject({ severity: 'error', line: 2 })
  })

  it('reports unknown instructions but keeps parsing the rest', () => {
    const result = parseDiagram('wibble\nnode a "A"')
    expect(result.diagram.nodes).toHaveLength(1)
    expect(result.problems[0]?.message).toMatch(/unknown instruction/)
  })

  it('rejects ids that could collide with the language', () => {
    const result = parseDiagram('node 9lives "Cat"')
    expect(result.diagram.nodes).toHaveLength(0)
    expect(result.problems[0]?.message).toMatch(/not a valid id/)
  })

  it('flags a bad shape, position and size individually', () => {
    const result = parseDiagram('node a "A" shape=blob at=oops size=big')
    expect(result.problems.map((problem) => problem.message)).toEqual([
      expect.stringMatching(/shape "blob" is unknown/),
      'at must look like at=120,80.',
      'size must look like size=160x64.',
    ])
    expect(result.diagram.nodes[0]).toMatchObject({ shape: 'rect', x: null, width: 160 })
  })

  it('clamps sizes and coordinates to the supported range', () => {
    const result = parseDiagram('node a "A" at=99999,-99999 size=5000x1')
    expect(result.diagram.nodes[0]).toMatchObject({
      x: LIMITS.maxCoord,
      y: LIMITS.minCoord,
      width: LIMITS.maxWidth,
      height: LIMITS.minHeight,
    })
  })

  it('gives repeated connections between the same pair distinct ids', () => {
    const result = parseDiagram('node a "A"\nnode b "B"\na -> b "one"\na -> b "two"')
    expect(result.diagram.edges.map((edge) => edge.id)).toEqual(['a->b#0', 'a->b#1'])
  })

  it('allows a self connection', () => {
    const result = parseDiagram('node a "A"\na -> a "retry"')
    expect(result.problems).toEqual([])
    expect(result.diagram.edges[0]).toMatchObject({ from: 'a', to: 'a' })
  })

  it('refuses to grow past the node limit', () => {
    const source = Array.from({ length: LIMITS.maxNodes + 3 }, (_, index) => `node n${index} "N"`).join('\n')
    const result = parseDiagram(source)
    expect(result.diagram.nodes).toHaveLength(LIMITS.maxNodes)
    expect(result.problems.some((problem) => problem.message.includes('limited to'))).toBe(true)
  })

  it('truncates a source longer than the character limit', () => {
    const result = parseDiagram('a'.repeat(LIMITS.maxSourceChars + 50))
    expect(result.problems[0]).toMatchObject({ severity: 'warning', line: 1 })
  })

  it('treats empty input as an empty diagram without complaining', () => {
    const result = parseDiagram('')
    expect(result.problems).toEqual([])
    expect(result.diagram.nodes).toEqual([])
  })
})
