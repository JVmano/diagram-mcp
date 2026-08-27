/**
 * Layout pass.
 *
 * Nodes may omit their position in the source. Those nodes are placed by a
 * deterministic layered pass so that a diagram typed as pure text still looks
 * reasonable. Dragging a node writes an explicit position, which the layout
 * pass then leaves alone.
 */

import type { Diagram, PlacedDiagram, PlacedNode } from './types'

const GAP_MAIN = 80
const GAP_CROSS = 32
const ORIGIN = 40

/**
 * Assigns each node a layer index by breadth first distance from a root.
 *
 * Breadth first is what keeps a connection from being drawn straight through an
 * unrelated shape: it puts every target at most one layer past its source, so a
 * forward connection never has to cross an intervening layer. Longest path
 * layering reads better on paper but needs placeholder nodes to reserve a
 * corridor for connections that skip layers, which this layout does not have.
 *
 * Cycles and disconnected pieces are handled by seeding any node the traversal
 * has not reached yet.
 */
function computeLayers(diagram: Diagram): Map<string, number> {
  const indegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const node of diagram.nodes) {
    indegree.set(node.id, 0)
    outgoing.set(node.id, [])
  }
  for (const edge of diagram.edges) {
    if (edge.from === edge.to) continue
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue
    outgoing.get(edge.from)!.push(edge.to)
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  }

  const layer = new Map<string, number>()
  const queue: string[] = []

  const seed = (id: string, depth: number) => {
    if (layer.has(id)) return
    layer.set(id, depth)
    queue.push(id)
  }

  for (const node of diagram.nodes) {
    if ((indegree.get(node.id) ?? 0) === 0) seed(node.id, 0)
  }

  let cursor = 0
  let pending = 0
  while (layer.size < diagram.nodes.length || cursor < queue.length) {
    if (cursor >= queue.length) {
      while (pending < diagram.nodes.length && layer.has(diagram.nodes[pending]!.id)) pending += 1
      if (pending >= diagram.nodes.length) break
      seed(diagram.nodes[pending]!.id, 0)
    }
    const id = queue[cursor]!
    cursor += 1
    for (const next of outgoing.get(id) ?? []) seed(next, (layer.get(id) ?? 0) + 1)
  }

  for (const node of diagram.nodes) {
    if (!layer.has(node.id)) layer.set(node.id, 0)
  }
  return layer
}

export function layoutDiagram(diagram: Diagram): PlacedDiagram {
  const layers = computeLayers(diagram)
  const buckets = new Map<number, typeof diagram.nodes>()
  for (const node of diagram.nodes) {
    const index = layers.get(node.id) ?? 0
    const bucket = buckets.get(index) ?? []
    bucket.push(node)
    buckets.set(index, bucket)
  }

  const horizontal = diagram.direction === 'LR'
  const sortedLayers = [...buckets.keys()].sort((a, b) => a - b)
  const placed = new Map<string, PlacedNode>()
  let mainOffset = ORIGIN

  for (const layerIndex of sortedLayers) {
    const bucket = buckets.get(layerIndex)!
    let crossOffset = ORIGIN
    let layerExtent = 0
    for (const node of bucket) {
      const mainSize = horizontal ? node.width : node.height
      const crossSize = horizontal ? node.height : node.width
      layerExtent = Math.max(layerExtent, mainSize)
      const autoX = horizontal ? mainOffset : crossOffset
      const autoY = horizontal ? crossOffset : mainOffset
      const auto = node.x === null || node.y === null
      placed.set(node.id, {
        ...node,
        x: auto ? autoX : node.x!,
        y: auto ? autoY : node.y!,
        auto,
      })
      crossOffset += crossSize + GAP_CROSS
    }
    mainOffset += layerExtent + GAP_MAIN
  }

  return {
    title: diagram.title,
    direction: diagram.direction,
    nodes: diagram.nodes.map((node) => placed.get(node.id)!),
    edges: diagram.edges,
  }
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export function diagramBounds(nodes: PlacedNode[], padding = 40): Bounds {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 320, maxY: 200, width: 320, height: 200 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width)
    maxY = Math.max(maxY, node.y + node.height)
  }
  minX -= padding
  minY -= padding
  maxX += padding
  maxY += padding
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}
