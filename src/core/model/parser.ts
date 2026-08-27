/**
 * Parser for the DiagramDesk source language.
 *
 * The language is line oriented so that a text edit can never corrupt more than
 * the line it touches, and so that error reporting can always point at a line.
 *
 *   # comment
 *   title Checkout flow
 *   direction LR
 *   node start "Start" shape=rounded at=40,40 size=160x64
 *   start -> check "valid?" style=dashed
 *
 * Parsing is intentionally forgiving: a bad line is reported as a problem and
 * skipped, and everything else still renders. That keeps the canvas usable
 * while the user is halfway through typing.
 */

import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  DIRECTIONS,
  EDGE_STYLES,
  ID_PATTERN,
  LIMITS,
  NODE_SHAPES,
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  type Direction,
  type EdgeStyle,
  type NodeShape,
  type ParseResult,
  type Problem,
} from './types'

type Token = { kind: 'string' | 'word'; value: string }

const SHAPE_ALIASES: Record<string, NodeShape> = {
  rect: 'rect',
  box: 'rect',
  rounded: 'rounded',
  round: 'rounded',
  ellipse: 'ellipse',
  oval: 'ellipse',
  circle: 'ellipse',
  diamond: 'diamond',
  decision: 'diamond',
  hexagon: 'hexagon',
  hex: 'hexagon',
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Splits a line into quoted strings and bare words. Returns a message instead
 * of tokens when the line contains an unterminated quote.
 */
export function tokenize(input: string): { tokens: Token[]; error?: string } {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const char = input[i]!
    if (/\s/.test(char)) {
      i += 1
      continue
    }
    if (char === '"') {
      let value = ''
      i += 1
      let closed = false
      while (i < input.length) {
        const c = input[i]!
        if (c === '\\' && i + 1 < input.length) {
          const next = input[i + 1]!
          value += next === 'n' ? '\n' : next
          i += 2
          continue
        }
        if (c === '"') {
          closed = true
          i += 1
          break
        }
        value += c
        i += 1
      }
      if (!closed) return { tokens, error: 'unterminated quoted text, add a closing "' }
      tokens.push({ kind: 'string', value })
      continue
    }
    let value = ''
    while (i < input.length && !/\s/.test(input[i]!)) {
      value += input[i]!
      i += 1
    }
    tokens.push({ kind: 'word', value })
  }
  return { tokens }
}

interface Attributes {
  entries: Map<string, string>
  unknown: string[]
}

function readAttributes(tokens: Token[], allowed: readonly string[]): Attributes {
  const entries = new Map<string, string>()
  const unknown: string[] = []
  for (const token of tokens) {
    if (token.kind !== 'word') continue
    const eq = token.value.indexOf('=')
    if (eq <= 0) {
      unknown.push(token.value)
      continue
    }
    const key = token.value.slice(0, eq).toLowerCase()
    const value = token.value.slice(eq + 1)
    if (!allowed.includes(key)) {
      unknown.push(token.value)
      continue
    }
    entries.set(key, value)
  }
  return { entries, unknown }
}

function parsePosition(raw: string): { x: number; y: number } | null {
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(raw.trim())
  if (!match) return null
  const x = Number(match[1])
  const y = Number(match[2])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return {
    x: clamp(Math.round(x), LIMITS.minCoord, LIMITS.maxCoord),
    y: clamp(Math.round(y), LIMITS.minCoord, LIMITS.maxCoord),
  }
}

function parseSize(raw: string): { width: number; height: number } | null {
  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i.exec(raw.trim())
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  return {
    width: clamp(Math.round(width), LIMITS.minWidth, LIMITS.maxWidth),
    height: clamp(Math.round(height), LIMITS.minHeight, LIMITS.maxHeight),
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

/** Builds a stable edge id so that selection survives a reparse. */
export function edgeId(from: string, to: string, occurrence: number): string {
  return `${from}->${to}#${occurrence}`
}

export function parseDiagram(source: string): ParseResult {
  const problems: Problem[] = []
  const nodes: DiagramNode[] = []
  const edges: DiagramEdge[] = []
  const nodeIndex = new Map<string, number>()
  const pairCount = new Map<string, number>()

  let title = ''
  let direction: Direction = 'LR'

  let text = source ?? ''
  if (text.length > LIMITS.maxSourceChars) {
    text = text.slice(0, LIMITS.maxSourceChars)
    problems.push({
      severity: 'warning',
      line: 1,
      message: `Source is longer than ${LIMITS.maxSourceChars} characters and was truncated.`,
    })
  }

  const lines = text.split(/\r?\n/)
  if (lines.length > LIMITS.maxLines) {
    problems.push({
      severity: 'warning',
      line: LIMITS.maxLines,
      message: `Only the first ${LIMITS.maxLines} lines are read.`,
    })
    lines.length = LIMITS.maxLines
  }

  const pendingEdges: Array<{ line: number; from: string; to: string; label: string; style: EdgeStyle }> = []

  lines.forEach((rawLine, index) => {
    const line = index + 1
    const trimmed = rawLine.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return

    const { tokens, error } = tokenize(trimmed)
    if (error) {
      problems.push({ severity: 'error', line, message: error })
      return
    }
    if (tokens.length === 0) return

    const head = tokens[0]!
    const keyword = head.kind === 'word' ? head.value.toLowerCase() : ''

    if (keyword === 'title') {
      const rest = trimmed.slice(trimmed.toLowerCase().indexOf('title') + 5).trim()
      const quoted = tokens[1]?.kind === 'string' ? tokens[1]!.value : rest.replace(/^"|"$/g, '')
      if (quoted === '') {
        problems.push({ severity: 'warning', line, message: 'title has no text and is ignored.' })
        return
      }
      title = truncate(quoted, LIMITS.maxTitleChars)
      return
    }

    if (keyword === 'direction') {
      const value = (tokens[1]?.value ?? '').toUpperCase()
      if (!DIRECTIONS.includes(value as Direction)) {
        problems.push({
          severity: 'error',
          line,
          message: `direction must be one of ${DIRECTIONS.join(', ')}.`,
        })
        return
      }
      direction = value as Direction
      return
    }

    const arrowIndex = tokens.findIndex((token) => token.kind === 'word' && token.value === '->')
    if (arrowIndex > -1 || keyword === 'edge') {
      const body = keyword === 'edge' ? tokens.slice(1) : tokens
      const arrowAt = body.findIndex((token) => token.kind === 'word' && token.value === '->')
      if (arrowAt < 1) {
        problems.push({
          severity: 'error',
          line,
          message: 'edge needs the form: <from> -> <to> ["label"].',
        })
        return
      }
      const from = body[arrowAt - 1]!
      const to = body[arrowAt + 1]
      if (from.kind !== 'word' || !to || to.kind !== 'word') {
        problems.push({ severity: 'error', line, message: 'edge endpoints must be node ids.' })
        return
      }
      const rest = body.slice(arrowAt + 2)
      const labelToken = rest.find((token) => token.kind === 'string')
      const attrs = readAttributes(rest, ['style'])
      for (const token of attrs.unknown) {
        problems.push({ severity: 'warning', line, message: `ignored unknown edge option "${token}".` })
      }
      const styleRaw = attrs.entries.get('style')
      let style: EdgeStyle = 'solid'
      if (styleRaw !== undefined) {
        if (!EDGE_STYLES.includes(styleRaw as EdgeStyle)) {
          problems.push({
            severity: 'error',
            line,
            message: `style must be one of ${EDGE_STYLES.join(', ')}.`,
          })
        } else {
          style = styleRaw as EdgeStyle
        }
      }
      pendingEdges.push({
        line,
        from: from.value,
        to: to.value,
        label: truncate(labelToken?.value ?? '', LIMITS.maxLabelChars),
        style,
      })
      return
    }

    if (keyword === 'node') {
      const idToken = tokens[1]
      if (!idToken || idToken.kind !== 'word') {
        problems.push({ severity: 'error', line, message: 'node needs an id, for example: node start "Start".' })
        return
      }
      const id = idToken.value
      if (id.length > LIMITS.maxIdChars || !ID_PATTERN.test(id)) {
        problems.push({
          severity: 'error',
          line,
          message: `"${truncate(id, 32)}" is not a valid id. Use letters, digits, _ or - and start with a letter.`,
        })
        return
      }
      if (nodeIndex.has(id)) {
        problems.push({ severity: 'error', line, message: `duplicate node id "${id}", the later one is ignored.` })
        return
      }
      if (nodes.length >= LIMITS.maxNodes) {
        problems.push({
          severity: 'error',
          line,
          message: `this diagram is limited to ${LIMITS.maxNodes} nodes.`,
        })
        return
      }

      const rest = tokens.slice(2)
      const labelToken = rest.find((token) => token.kind === 'string')
      const attrs = readAttributes(rest, ['shape', 'at', 'size'])
      for (const token of attrs.unknown) {
        problems.push({ severity: 'warning', line, message: `ignored unknown node option "${token}".` })
      }

      let shape: NodeShape = 'rect'
      const shapeRaw = attrs.entries.get('shape')
      if (shapeRaw !== undefined) {
        const resolved = SHAPE_ALIASES[shapeRaw.toLowerCase()]
        if (!resolved) {
          problems.push({
            severity: 'error',
            line,
            message: `shape "${truncate(shapeRaw, 32)}" is unknown. Use ${NODE_SHAPES.join(', ')}.`,
          })
        } else {
          shape = resolved
        }
      }

      let x: number | null = null
      let y: number | null = null
      const atRaw = attrs.entries.get('at')
      if (atRaw !== undefined) {
        const position = parsePosition(atRaw)
        if (!position) {
          problems.push({ severity: 'error', line, message: 'at must look like at=120,80.' })
        } else {
          x = position.x
          y = position.y
        }
      }

      let width = DEFAULT_NODE_WIDTH
      let height = DEFAULT_NODE_HEIGHT
      const sizeRaw = attrs.entries.get('size')
      if (sizeRaw !== undefined) {
        const size = parseSize(sizeRaw)
        if (!size) {
          problems.push({ severity: 'error', line, message: 'size must look like size=160x64.' })
        } else {
          width = size.width
          height = size.height
        }
      }

      nodeIndex.set(id, nodes.length)
      nodes.push({
        id,
        label: truncate(labelToken?.value ?? id, LIMITS.maxLabelChars),
        shape,
        x,
        y,
        width,
        height,
      })
      return
    }

    problems.push({
      severity: 'error',
      line,
      message: `unknown instruction "${truncate(head.value, 32)}". Expected title, direction, node or an edge with ->.`,
    })
  })

  for (const pending of pendingEdges) {
    if (edges.length >= LIMITS.maxEdges) {
      problems.push({
        severity: 'error',
        line: pending.line,
        message: `this diagram is limited to ${LIMITS.maxEdges} edges.`,
      })
      break
    }
    const missing: string[] = []
    if (!nodeIndex.has(pending.from)) missing.push(pending.from)
    if (!nodeIndex.has(pending.to) && pending.to !== pending.from) missing.push(pending.to)
    if (missing.length > 0) {
      problems.push({
        severity: 'error',
        line: pending.line,
        message: `edge refers to undefined node ${missing.map((id) => `"${truncate(id, 32)}"`).join(' and ')}.`,
      })
      continue
    }
    const key = `${pending.from}->${pending.to}`
    const occurrence = pairCount.get(key) ?? 0
    pairCount.set(key, occurrence + 1)
    edges.push({
      id: edgeId(pending.from, pending.to, occurrence),
      from: pending.from,
      to: pending.to,
      label: pending.label,
      style: pending.style,
    })
  }

  const diagram: Diagram = { title, direction, nodes, edges }
  return { diagram, problems }
}

export function hasErrors(problems: Problem[]): boolean {
  return problems.some((problem) => problem.severity === 'error')
}
