/**
 * Standalone SVG export.
 *
 * The exported file is self contained: no external fonts, no scripts, no
 * references to anything on a network. It uses the same geometry helpers as the
 * canvas so the export matches what is on screen.
 */

import { diagramBounds } from '../model/layout'
import { LINE_HEIGHT, edgeGeometry, labelPosition, shapePath, wrapLabel } from '../model/geometry'
import type { PlacedDiagram, PlacedNode } from '../model/types'

export interface SvgExportOptions {
  background?: 'white' | 'transparent'
  padding?: number
}

const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

const FILL = '#ffffff'
const STROKE = '#334155'
const TEXT = '#0f172a'
const EDGE = '#475569'

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function nodeMarkup(node: PlacedNode): string {
  const lines = wrapLabel(node.label, node.width)
  const centerX = node.x + node.width / 2
  const centerY = node.y + node.height / 2
  const firstY = centerY - ((lines.length - 1) * LINE_HEIGHT) / 2 + 5
  const text = lines
    .map(
      (line, index) =>
        `<text x="${round(centerX)}" y="${round(firstY + index * LINE_HEIGHT)}" text-anchor="middle" font-family="${FONT_STACK}" font-size="14" fill="${TEXT}">${escapeXml(line)}</text>`,
    )
    .join('')
  return `<g><path d="${shapePath(node)}" fill="${FILL}" stroke="${STROKE}" stroke-width="1.5"/>${text}</g>`
}

function edgeLineMarkup(from: PlacedNode, to: PlacedNode, dashed: boolean): string {
  const geometry = edgeGeometry(from, to)
  const dash = dashed ? ' stroke-dasharray="7 5"' : ''
  return `<path d="${geometry.path}" fill="none" stroke="${EDGE}" stroke-width="1.5"${dash} marker-end="url(#dd-arrow)"/>`
}

/**
 * Connection labels are emitted after the shapes so a label in a tight gap stays
 * readable instead of disappearing under the next shape.
 */
function edgeLabelMarkup(from: PlacedNode, to: PlacedNode, label: string): string {
  if (label === '') return ''
  const lines = wrapLabel(label, 180, 2)
  const width = Math.max(...lines.map((line) => line.length)) * 7 + 12
  const height = lines.length * LINE_HEIGHT + 4
  const at = labelPosition(from, to, width, height)
  const box = `<rect x="${round(at.x - width / 2)}" y="${round(at.y - height / 2)}" width="${round(width)}" height="${round(height)}" rx="4" fill="${FILL}" stroke="none"/>`
  const text = lines
    .map(
      (line, index) =>
        `<text x="${round(at.x)}" y="${round(at.y - height / 2 + LINE_HEIGHT * (index + 1) - 4)}" text-anchor="middle" font-family="${FONT_STACK}" font-size="12" fill="${EDGE}">${escapeXml(line)}</text>`,
    )
    .join('')
  return `${box}${text}`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function renderDiagramSvg(diagram: PlacedDiagram, options: SvgExportOptions = {}): string {
  const padding = options.padding ?? 40
  const bounds = diagramBounds(diagram.nodes, padding)
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]))
  const titleHeight = diagram.title.trim() === '' ? 0 : 40

  const edgeLines = diagram.edges
    .map((edge) => {
      const from = byId.get(edge.from)
      const to = byId.get(edge.to)
      if (!from || !to) return ''
      return edgeLineMarkup(from, to, edge.style === 'dashed')
    })
    .join('')

  const edgeLabels = diagram.edges
    .map((edge) => {
      const from = byId.get(edge.from)
      const to = byId.get(edge.to)
      if (!from || !to) return ''
      return edgeLabelMarkup(from, to, edge.label)
    })
    .join('')

  const nodes = diagram.nodes.map(nodeMarkup).join('')

  const titleMarkup =
    titleHeight === 0
      ? ''
      : `<text x="${round(bounds.minX + 24)}" y="${round(bounds.minY - titleHeight + 26)}" font-family="${FONT_STACK}" font-size="18" font-weight="600" fill="${TEXT}">${escapeXml(diagram.title)}</text>`

  const viewBox = `${round(bounds.minX)} ${round(bounds.minY - titleHeight)} ${round(bounds.width)} ${round(bounds.height + titleHeight)}`
  const background =
    options.background === 'transparent'
      ? ''
      : `<rect x="${round(bounds.minX)}" y="${round(bounds.minY - titleHeight)}" width="${round(bounds.width)}" height="${round(bounds.height + titleHeight)}" fill="#ffffff"/>`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(bounds.width)}" height="${round(bounds.height + titleHeight)}" viewBox="${viewBox}" role="img" aria-label="${escapeXml(diagram.title || 'Diagram')}">`,
    '<defs><marker id="dd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">',
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="${EDGE}"/></marker></defs>`,
    background,
    titleMarkup,
    edgeLines,
    nodes,
    edgeLabels,
    '</svg>',
  ].join('')
}
