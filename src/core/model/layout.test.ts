import { describe, expect, it } from 'vitest'
import { anchorOnShape, edgeGeometry, labelPosition, nodeCenter, wrapLabel } from './geometry'
import { diagramBounds, layoutDiagram } from './layout'
import { parseDiagram } from './parser'
import type { PlacedNode } from './types'

function layout(source: string) {
  return layoutDiagram(parseDiagram(source).diagram)
}

describe('layoutDiagram', () => {
  it('leaves pinned nodes exactly where the source put them', () => {
    const placed = layout('node a "A" at=123,456')
    expect(placed.nodes[0]).toMatchObject({ x: 123, y: 456, auto: false })
  })

  it('places unpinned nodes left to right for direction LR', () => {
    const placed = layout('direction LR\nnode a "A"\nnode b "B"\na -> b')
    const [a, b] = placed.nodes
    expect(a?.auto).toBe(true)
    expect(b!.x).toBeGreaterThan(a!.x)
    expect(b!.y).toBe(a!.y)
  })

  it('places unpinned nodes top to bottom for direction TB', () => {
    const placed = layout('direction TB\nnode a "A"\nnode b "B"\na -> b')
    const [a, b] = placed.nodes
    expect(b!.y).toBeGreaterThan(a!.y)
    expect(b!.x).toBe(a!.x)
  })

  it('spreads siblings across the cross axis instead of stacking them', () => {
    const placed = layout('node root "R"\nnode one "1"\nnode two "2"\nroot -> one\nroot -> two')
    const one = placed.nodes.find((node) => node.id === 'one')!
    const two = placed.nodes.find((node) => node.id === 'two')!
    expect(one.x).toBe(two.x)
    expect(two.y).toBeGreaterThan(one.y)
  })

  it('keeps a branch and the step it rejoins on the same layer', () => {
    const placed = layout(`direction TB
node tier "Tier bonus?"
node bonus "Add bonus"
node vault "Hold in vault"

tier -> bonus
tier -> vault
bonus -> vault`)
    const bonus = placed.nodes.find((node) => node.id === 'bonus')!
    const vault = placed.nodes.find((node) => node.id === 'vault')!
    expect(vault.y).toBe(bonus.y)
    expect(vault.x).toBeGreaterThan(bonus.x)
  })

  it('never routes a connection across an intervening layer', () => {
    const placed = layout(`direction LR
node a "A"
node b "B"
node c "C"
node d "D"

a -> b
b -> c
c -> d
a -> d`)
    const column = new Map(placed.nodes.map((node) => [node.id, node.x]))
    const columns = [...new Set(column.values())].sort((first, second) => first - second)
    const indexOf = (id: string) => columns.indexOf(column.get(id)!)
    for (const edge of [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['a', 'd'],
    ] as const) {
      expect(Math.abs(indexOf(edge[1]) - indexOf(edge[0]))).toBeLessThanOrEqual(1)
    }
  })

  it('does not hang or overlap on a cycle', () => {
    const placed = layout('node a "A"\nnode b "B"\nnode c "C"\na -> b\nb -> c\nc -> a')
    expect(placed.nodes).toHaveLength(3)
    expect(new Set(placed.nodes.map((node) => `${node.x},${node.y}`)).size).toBe(3)
  })

  it('is deterministic', () => {
    const source = 'node a "A"\nnode b "B"\nnode c "C"\na -> b\na -> c'
    expect(layout(source)).toEqual(layout(source))
  })
})

describe('diagramBounds', () => {
  it('pads the box around every node', () => {
    const placed = layout('node a "A" at=0,0 size=100x50')
    const bounds = diagramBounds(placed.nodes, 10)
    expect(bounds).toMatchObject({ minX: -10, minY: -10, maxX: 110, maxY: 60, width: 120, height: 70 })
  })

  it('returns a usable box for an empty diagram', () => {
    expect(diagramBounds([]).width).toBeGreaterThan(0)
  })
})

describe('geometry', () => {
  const rect: PlacedNode = {
    id: 'a',
    label: 'A',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    auto: false,
  }

  it('stops an edge on the border of a rectangle, not at its centre', () => {
    const anchor = anchorOnShape(rect, { x: 500, y: 50 })
    expect(anchor).toEqual({ x: 100, y: 50 })
  })

  it('uses the ellipse equation for round shapes', () => {
    const anchor = anchorOnShape({ ...rect, shape: 'ellipse' }, { x: 0, y: 50 })
    expect(anchor.x).toBeCloseTo(0)
    expect(anchor.y).toBeCloseTo(50)
  })

  it('uses the diamond equation for decisions', () => {
    const anchor = anchorOnShape({ ...rect, shape: 'diamond' }, { x: 50, y: -100 })
    expect(anchor).toEqual({ x: 50, y: 0 })
  })

  it('draws a self connection as a loop that leaves and returns to the node', () => {
    const geometry = edgeGeometry(rect, rect)
    expect(geometry.path.startsWith('M')).toBe(true)
    expect(geometry.path).toContain('C')
    expect(geometry.start).not.toEqual(geometry.end)
  })

  it('puts an edge label halfway between the two anchors', () => {
    const other: PlacedNode = { ...rect, id: 'b', x: 300 }
    const geometry = edgeGeometry(rect, other)
    expect(geometry.labelAt).toEqual({ x: 200, y: 50 })
  })

  it('leaves a label on the line when it fits in the gap', () => {
    const other: PlacedNode = { ...rect, id: 'b', x: 300 }
    expect(labelPosition(rect, other, 80, 22)).toEqual(edgeGeometry(rect, other).labelAt)
  })

  it('lifts a label clear of both shapes when it is wider than the gap', () => {
    const other: PlacedNode = { ...rect, id: 'b', x: 140 }
    const at = labelPosition(rect, other, 120, 22)
    expect(at.x).toBe(120)
    expect(at.y + 11).toBeLessThan(Math.min(rect.y, other.y))
  })

  it('lifts sideways for a cramped vertical connection', () => {
    const below: PlacedNode = { ...rect, id: 'b', y: 140 }
    const at = labelPosition(rect, below, 120, 22)
    expect(at.y).toBe(120)
    expect(at.x - 60).toBeGreaterThan(rect.x + rect.width)
  })

  it('leaves a self connection label alone', () => {
    expect(labelPosition(rect, rect, 400, 22)).toEqual(edgeGeometry(rect, rect).labelAt)
  })

  it('reports the centre of a node', () => {
    expect(nodeCenter(rect)).toEqual({ x: 50, y: 50 })
  })
})

describe('wrapLabel', () => {
  it('wraps on words to fit the shape width', () => {
    expect(wrapLabel('one two three four five six', 120)).toEqual(['one two three', 'four five six'])
    expect(wrapLabel('one two three four five six', 60)).toEqual(['one', 'two', 'three', 'four…'])
  })

  it('keeps explicit line breaks', () => {
    expect(wrapLabel('first\nsecond', 300)).toEqual(['first', 'second'])
  })

  it('truncates instead of overflowing the shape', () => {
    const lines = wrapLabel('word '.repeat(60), 100, 3)
    expect(lines).toHaveLength(3)
    expect(lines[2]?.endsWith('…')).toBe(true)
  })

  it('breaks a single very long word', () => {
    expect(wrapLabel('supercalifragilistic', 60)[0]?.endsWith('…')).toBe(true)
  })
})
