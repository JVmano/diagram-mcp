/**
 * Core diagram data model.
 *
 * A diagram is the parsed form of the DiagramDesk source language. The source
 * text is always the single source of truth; canvas edits are applied to the
 * parsed model and then serialised back to text.
 */

export const NODE_SHAPES = ['rect', 'rounded', 'ellipse', 'diamond', 'hexagon'] as const

export type NodeShape = (typeof NODE_SHAPES)[number]

export const EDGE_STYLES = ['solid', 'dashed'] as const

export type EdgeStyle = (typeof EDGE_STYLES)[number]

export const DIRECTIONS = ['LR', 'TB'] as const

export type Direction = (typeof DIRECTIONS)[number]

export interface DiagramNode {
  id: string
  label: string
  shape: NodeShape
  /** Explicit top-left x, or null when the node is auto-placed by the layout pass. */
  x: number | null
  y: number | null
  width: number
  height: number
}

export interface DiagramEdge {
  id: string
  from: string
  to: string
  label: string
  style: EdgeStyle
}

export interface Diagram {
  title: string
  direction: Direction
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

export type ProblemSeverity = 'error' | 'warning'

export interface Problem {
  severity: ProblemSeverity
  /** 1-based line number in the source text. */
  line: number
  message: string
}

export interface ParseResult {
  diagram: Diagram
  problems: Problem[]
}

/** A node with resolved coordinates, produced by the layout pass. */
export interface PlacedNode extends DiagramNode {
  x: number
  y: number
  /** True when the position came from the layout pass rather than the source. */
  auto: boolean
}

export interface PlacedDiagram {
  title: string
  direction: Direction
  nodes: PlacedNode[]
  edges: DiagramEdge[]
}

/**
 * Hard limits applied to any parsed or imported source. They exist so that a
 * hand-written or pasted file cannot lock the browser up.
 */
export const LIMITS = {
  maxSourceChars: 200_000,
  maxLines: 5_000,
  maxNodes: 500,
  maxEdges: 1_000,
  maxLabelChars: 200,
  maxTitleChars: 120,
  maxIdChars: 64,
  minWidth: 40,
  maxWidth: 800,
  minHeight: 24,
  maxHeight: 400,
  minCoord: -20_000,
  maxCoord: 20_000,
} as const

export const DEFAULT_NODE_WIDTH = 160
export const DEFAULT_NODE_HEIGHT = 64

export const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/

export function emptyDiagram(): Diagram {
  return { title: '', direction: 'LR', nodes: [], edges: [] }
}
