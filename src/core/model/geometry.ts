/**
 * Shape and edge geometry shared by the interactive canvas and the SVG export,
 * so that what you see on screen is what lands in the exported file.
 */

import type { NodeShape, PlacedNode } from './types'

export interface Point {
  x: number
  y: number
}

export function nodeCenter(node: PlacedNode): Point {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 }
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  return [
    `M ${x + radius} ${y}`,
    `H ${x + w - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + w} ${y + radius}`,
    `V ${y + h - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + w - radius} ${y + h}`,
    `H ${x + radius}`,
    `A ${radius} ${radius} 0 0 1 ${x} ${y + h - radius}`,
    `V ${y + radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
    'Z',
  ].join(' ')
}

/** Returns the outline of a node as a single SVG path command string. */
export function shapePath(node: { x: number; y: number; width: number; height: number; shape: NodeShape }): string {
  const { x, y, width: w, height: h, shape } = node
  switch (shape) {
    case 'rounded':
      return roundedRectPath(x, y, w, h, 12)
    case 'ellipse': {
      const rx = w / 2
      const ry = h / 2
      const cx = x + rx
      const cy = y + ry
      return `M ${x} ${cy} A ${rx} ${ry} 0 0 1 ${cx} ${y} A ${rx} ${ry} 0 0 1 ${x + w} ${cy} A ${rx} ${ry} 0 0 1 ${cx} ${y + h} A ${rx} ${ry} 0 0 1 ${x} ${cy} Z`
    }
    case 'diamond':
      return `M ${x + w / 2} ${y} L ${x + w} ${y + h / 2} L ${x + w / 2} ${y + h} L ${x} ${y + h / 2} Z`
    case 'hexagon': {
      const inset = Math.min(24, w / 4)
      return `M ${x + inset} ${y} H ${x + w - inset} L ${x + w} ${y + h / 2} L ${x + w - inset} ${y + h} H ${x + inset} L ${x} ${y + h / 2} Z`
    }
    case 'rect':
    default:
      return roundedRectPath(x, y, w, h, 4)
  }
}

/**
 * Finds where a ray leaving the node centre towards `target` crosses the node
 * outline. Used to stop edges at the border instead of under the shape.
 */
export function anchorOnShape(node: PlacedNode, target: Point): Point {
  const center = nodeCenter(node)
  const dx = target.x - center.x
  const dy = target.y - center.y
  if (dx === 0 && dy === 0) return center

  const halfW = node.width / 2
  const halfH = node.height / 2

  if (node.shape === 'ellipse') {
    const scale = 1 / Math.sqrt((dx * dx) / (halfW * halfW) + (dy * dy) / (halfH * halfH))
    return { x: center.x + dx * scale, y: center.y + dy * scale }
  }

  if (node.shape === 'diamond') {
    const scale = 1 / (Math.abs(dx) / halfW + Math.abs(dy) / halfH)
    return { x: center.x + dx * scale, y: center.y + dy * scale }
  }

  const scaleX = dx === 0 ? Infinity : halfW / Math.abs(dx)
  const scaleY = dy === 0 ? Infinity : halfH / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY)
  return { x: center.x + dx * scale, y: center.y + dy * scale }
}

export interface EdgeGeometry {
  path: string
  start: Point
  end: Point
  labelAt: Point
}

const SELF_LOOP_SIZE = 46

export function edgeGeometry(from: PlacedNode, to: PlacedNode): EdgeGeometry {
  if (from.id === to.id) {
    const top = { x: from.x + from.width * 0.7, y: from.y }
    const right = { x: from.x + from.width, y: from.y + from.height * 0.3 }
    const path = `M ${top.x} ${top.y} C ${top.x + SELF_LOOP_SIZE} ${top.y - SELF_LOOP_SIZE} ${right.x + SELF_LOOP_SIZE} ${right.y - SELF_LOOP_SIZE} ${right.x} ${right.y}`
    return {
      path,
      start: top,
      end: right,
      labelAt: { x: from.x + from.width + SELF_LOOP_SIZE * 0.5, y: from.y - SELF_LOOP_SIZE * 0.5 },
    }
  }
  const start = anchorOnShape(from, nodeCenter(to))
  const end = anchorOnShape(to, nodeCenter(from))
  return {
    path: `M ${round(start.x)} ${round(start.y)} L ${round(end.x)} ${round(end.y)}`,
    start,
    end,
    labelAt: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Where a connection label goes.
 *
 * Normally the midpoint of the line. When the label is wider than the line is
 * long, which happens between two shapes on the same layer, the midpoint sits
 * under the shapes at either end, so the label is pushed clear on the
 * perpendicular instead.
 */
export function labelPosition(
  from: PlacedNode,
  to: PlacedNode,
  labelWidth: number,
  labelHeight: number,
): Point {
  const geometry = edgeGeometry(from, to)
  const dx = geometry.end.x - geometry.start.x
  const dy = geometry.end.y - geometry.start.y
  const length = Math.hypot(dx, dy)
  if (from.id === to.id || length === 0 || labelWidth <= length) return geometry.labelAt

  const perpX = dy / length
  const perpY = -dx / length
  const clearance =
    (Math.abs(perpX) * Math.max(from.width, to.width)) / 2 +
    (Math.abs(perpY) * Math.max(from.height, to.height)) / 2
  const labelExtent = (Math.abs(perpX) * labelWidth) / 2 + (Math.abs(perpY) * labelHeight) / 2
  const lift = clearance + labelExtent + 6
  return { x: geometry.labelAt.x + perpX * lift, y: geometry.labelAt.y + perpY * lift }
}

const CHAR_WIDTH = 7.4
export const LINE_HEIGHT = 18

/** Greedy word wrap sized for the 14px UI font used by the canvas and export. */
export function wrapLabel(label: string, width: number, maxLines = 4): string[] {
  const usable = Math.max(1, Math.floor((width - 20) / CHAR_WIDTH))
  const out: string[] = []
  for (const paragraph of label.split('\n')) {
    let current = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current === '' ? word : `${current} ${word}`
      if (candidate.length <= usable) {
        current = candidate
        continue
      }
      if (current !== '') out.push(current)
      current = word.length > usable ? `${word.slice(0, Math.max(1, usable - 1))}…` : word
    }
    out.push(current)
  }
  const lines = out.filter((line, index) => line !== '' || index === 0)
  if (lines.length <= maxLines) return lines
  const clipped = lines.slice(0, maxLines)
  clipped[maxLines - 1] = `${clipped[maxLines - 1]!.slice(0, Math.max(1, Math.floor((width - 20) / CHAR_WIDTH) - 1))}…`
  return clipped
}

export function pointInNode(node: PlacedNode, point: Point): boolean {
  return (
    point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height
  )
}
