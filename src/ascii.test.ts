import { describe, expect, it } from 'vitest'
import { renderDiagramAscii } from './ascii'
import { layoutDiagram } from './core/model/layout'
import { parseDiagram } from './core/model/parser'

function draw(code: string, maxCols?: number) {
  return renderDiagramAscii(layoutDiagram(parseDiagram(code).diagram), maxCols ? { maxCols } : {})
}

describe('renderDiagramAscii', () => {
  it('draws every shape and connects them with an arrow', () => {
    const art = draw('node a "Start"\nnode b "Finish"\na -> b')
    expect(art).toContain('Start')
    expect(art).toContain('Finish')
    expect(art).toMatch(/[▶◀▲▼]/)
    expect(art).toContain('┌')
  })

  it('puts the title above the drawing', () => {
    expect(draw('title "My flow"\nnode a "A"').startsWith('My flow\n')).toBe(true)
  })

  it('uses round corners for rounded shapes and angle brackets for a decision', () => {
    expect(draw('node a "A" shape=rounded')).toContain('╭')
    expect(draw('node a "A" shape=diamond size=200x100')).toContain('<')
  })

  it('never exceeds the requested width', () => {
    const art = draw('direction LR\nnode a "A"\nnode b "B"\nnode c "C"\na -> b\nb -> c', 40)
    for (const line of art.split('\n')) expect(line.length).toBeLessThanOrEqual(40)
  })

  it('places a connection label when there is room for it', () => {
    expect(draw('direction TB\nnode a "A"\nnode b "B"\na -> b "maybe"')).toContain('maybe')
  })

  it('marks a self connection', () => {
    expect(draw('node a "A"\na -> a "retry"')).toContain('↺')
  })

  it('never draws a connection through a shape', () => {
    const art = draw(`direction TB
node a "A"
node b "B"
node c "C"

a -> b
a -> c
b -> c`)
    for (const line of art.split('\n')) {
      if ((line.match(/│/g) ?? []).length !== 2) continue
      expect(line).not.toMatch(/[╲╱▶◀▲▼]/)
    }
  })

  it('says so when there is nothing to draw', () => {
    expect(draw('')).toBe('(empty diagram)')
  })
})
