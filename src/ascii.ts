/**
 * Text rendering, for showing a diagram in a conversation instead of a file.
 *
 * Same parsed model and same layout as the PNG path, projected onto a character
 * grid. Terminal cells are about twice as tall as they are wide, so the
 * horizontal scale is half the vertical one and the shapes keep their
 * proportions.
 */

import { edgeGeometry } from './core/model/geometry'
import { diagramBounds } from './core/model/layout'
import type { PlacedDiagram } from './core/model/types'

export interface AsciiOptions {
  maxCols?: number
  maxRows?: number
}

const CHAR_ASPECT = 2

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Greedy word wrap in characters, unlike the pixel wrap the SVG path uses. */
function wrapChars(label: string, width: number, maxLines: number): string[] {
  const out: string[] = []
  for (const paragraph of label.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line === '' ? word : `${line} ${word}`
      if (candidate.length <= width) {
        line = candidate
        continue
      }
      if (line !== '') out.push(line)
      line = word.length > width ? `${word.slice(0, Math.max(1, width - 1))}…` : word
    }
    out.push(line)
  }
  const lines = out.filter((line, index) => line !== '' || index === 0)
  if (lines.length <= maxLines) return lines
  const clipped = lines.slice(0, maxLines)
  clipped[maxLines - 1] = `${clipped[maxLines - 1]!.slice(0, Math.max(1, width - 1))}…`
  return clipped
}

export function renderDiagramAscii(diagram: PlacedDiagram, options: AsciiOptions = {}): string {
  if (diagram.nodes.length === 0) return diagram.title === '' ? '(empty diagram)' : `${diagram.title}\n\n(empty diagram)`

  const maxCols = clamp(Math.round(options.maxCols ?? 110), 24, 400)
  const maxRows = clamp(Math.round(options.maxRows ?? 46), 8, 400)
  const bounds = diagramBounds(diagram.nodes, 8)

  let cellW = Math.max(6, bounds.width / maxCols)
  let cellH = cellW * CHAR_ASPECT
  if (bounds.height / cellH > maxRows) {
    cellH = bounds.height / maxRows
    cellW = cellH / CHAR_ASPECT
  }

  const cols = clamp(Math.ceil(bounds.width / cellW) + 1, 4, maxCols)
  const rows = clamp(Math.ceil(bounds.height / cellH) + 1, 3, maxRows)
  const grid: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ' '))
  const taken: boolean[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))

  const toCol = (x: number) => clamp(Math.round((x - bounds.minX) / cellW), 0, cols - 1)
  const toRow = (y: number) => clamp(Math.round((y - bounds.minY) / cellH), 0, rows - 1)

  const put = (row: number, col: number, char: string, force: boolean) => {
    if (row < 0 || row >= rows || col < 0 || col >= cols) return
    if (!force && taken[row]![col]) return
    grid[row]![col] = char
    if (force) taken[row]![col] = true
  }

  const free = (row: number, col: number) =>
    row >= 0 && row < rows && col >= 0 && col < cols && !taken[row]![col] && grid[row]![col] === ' '

  const boxes = new Map<string, { top: number; left: number; bottom: number; right: number }>()

  for (const node of diagram.nodes) {
    const left = toCol(node.x)
    const top = toRow(node.y)
    const right = Math.max(left + 2, toCol(node.x + node.width))
    const bottom = Math.max(top + 2, toRow(node.y + node.height))
    boxes.set(node.id, { top, left, bottom, right })

    for (let row = top; row <= bottom; row += 1) {
      for (let col = left; col <= right; col += 1) taken[row]![col] = true
    }

    const round = node.shape === 'rounded' || node.shape === 'ellipse'
    const corners = round ? ['╭', '╮', '╰', '╯'] : ['┌', '┐', '└', '┘']
    for (let col = left; col <= right; col += 1) {
      put(top, col, '─', true)
      put(bottom, col, '─', true)
    }
    for (let row = top; row <= bottom; row += 1) {
      put(row, left, '│', true)
      put(row, right, '│', true)
    }
    put(top, left, corners[0]!, true)
    put(top, right, corners[1]!, true)
    put(bottom, left, corners[2]!, true)
    put(bottom, right, corners[3]!, true)
    if (node.shape === 'diamond') {
      const middle = Math.round((top + bottom) / 2)
      put(middle, left, '<', true)
      put(middle, right, '>', true)
    }

    const innerWidth = Math.max(1, right - left - 1)
    const innerHeight = Math.max(1, bottom - top - 1)
    const lines = wrapChars(node.label, innerWidth, innerHeight)
    const firstRow = top + 1 + Math.max(0, Math.floor((innerHeight - lines.length) / 2))
    lines.forEach((line, index) => {
      const start = left + 1 + Math.max(0, Math.floor((innerWidth - line.length) / 2))
      for (let offset = 0; offset < line.length; offset += 1) {
        put(firstRow + index, start + offset, line[offset]!, true)
      }
    })
  }

  const byId = new Map(diagram.nodes.map((node) => [node.id, node]))
  const pendingLabels: Array<{ row: number; col: number; text: string }> = []

  for (const edge of diagram.edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue

    if (edge.from === edge.to) {
      const box = boxes.get(edge.from)!
      put(box.top, box.right + 1, '↺', false)
      continue
    }

    const geometry = edgeGeometry(from, to)
    const line = plot(toCol(geometry.start.x), toRow(geometry.start.y), toCol(geometry.end.x), toRow(geometry.end.y))
    const drawn = line.filter((cell) => free(cell.row, cell.col))
    drawn.forEach((cell, index) => {
      const previous = drawn[index - 1]
      const next = drawn[index + 1]
      const dc = previous ? cell.col - previous.col : next ? next.col - cell.col : 0
      const dr = previous ? cell.row - previous.row : next ? next.row - cell.row : 0
      put(cell.row, cell.col, strokeChar(dc, dr), false)
    })

    const last = drawn[drawn.length - 1]
    if (last) {
      put(last.row, last.col, arrowChar(toCol(geometry.end.x) - toCol(geometry.start.x), toRow(geometry.end.y) - toRow(geometry.start.y)), false)
    }
    if (edge.label !== '') {
      const middle = drawn[Math.floor(drawn.length / 2)]
      if (middle) pendingLabels.push({ row: middle.row, col: middle.col, text: edge.label.slice(0, 24) })
    }
  }

  for (const label of pendingLabels) {
    const centre = label.col - Math.floor(label.text.length / 2)
    const spots = [label.row - 1, label.row + 1, label.row, label.row - 2, label.row + 2].flatMap((row) =>
      [centre, centre + 2, centre - 2, centre + 4, centre - 4].map((start) => ({ row, start })),
    )
    const spot = spots.find(({ row, start }) => {
      for (let offset = 0; offset < label.text.length; offset += 1) {
        if (!free(row, start + offset)) return false
      }
      return true
    })
    if (!spot) continue
    for (let offset = 0; offset < label.text.length; offset += 1) {
      put(spot.row, spot.start + offset, label.text[offset]!, true)
    }
  }

  const body = grid.map((row) => row.join('').replace(/\s+$/, '')).join('\n')
  return diagram.title === '' ? body : `${diagram.title}\n\n${body}`
}

function strokeChar(dc: number, dr: number): string {
  if (dc === 0 && dr === 0) return '·'
  if (dr === 0) return '─'
  if (dc === 0) return '│'
  return dc * dr > 0 ? '╲' : '╱'
}

function arrowChar(dc: number, dr: number): string {
  if (Math.abs(dc) >= Math.abs(dr)) return dc >= 0 ? '▶' : '◀'
  return dr >= 0 ? '▼' : '▲'
}

/** Bresenham, so a connection is a continuous run of cells. */
function plot(x0: number, y0: number, x1: number, y1: number): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = []
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const stepX = x0 < x1 ? 1 : -1
  const stepY = y0 < y1 ? 1 : -1
  let error = dx + dy
  let x = x0
  let y = y0
  for (let guard = 0; guard < 4000; guard += 1) {
    cells.push({ row: y, col: x })
    if (x === x1 && y === y1) break
    const doubled = 2 * error
    if (doubled >= dy) {
      error += dy
      x += stepX
    }
    if (doubled <= dx) {
      error += dx
      y += stepY
    }
  }
  return cells
}
