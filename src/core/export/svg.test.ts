import { describe, expect, it } from 'vitest'
import { layoutDiagram } from '../model/layout'
import { parseDiagram } from '../model/parser'
import { escapeXml, renderDiagramSvg } from './svg'

function render(source: string, options?: Parameters<typeof renderDiagramSvg>[1]) {
  return renderDiagramSvg(layoutDiagram(parseDiagram(source).diagram), options)
}

describe('renderDiagramSvg', () => {
  it('produces a standalone svg with the diagram in it', () => {
    const svg = render('title "Flow"\nnode a "Start" at=0,0\nnode b "End" at=300,0\na -> b "go"')
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('>Start<')
    expect(svg).toContain('>End<')
    expect(svg).toContain('>go<')
    expect(svg).toContain('>Flow<')
  })

  it('references nothing outside the file', () => {
    const svg = render('node a "A"\nnode b "B"\na -> b')
    const withoutNamespace = svg.replace('xmlns="http://www.w3.org/2000/svg"', '')
    expect(withoutNamespace).not.toMatch(/https?:\/\//)
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('<image')
    expect(svg.match(/url\(#[^)]+\)/g)?.every((match) => match.startsWith('url(#'))).toBe(true)
  })

  it('escapes label text so a diagram cannot inject markup', () => {
    const svg = render('node a "<script>alert(1)</script>"')
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
  })

  it('draws a white background by default and none when asked', () => {
    expect(render('node a "A"')).toContain('fill="#ffffff"')
    const transparent = render('node a "A"', { background: 'transparent' })
    expect(transparent.split('fill="#ffffff"').length).toBeLessThan(
      render('node a "A"').split('fill="#ffffff"').length,
    )
  })

  it('draws connection labels after the shapes so a tight gap stays readable', () => {
    const svg = render('node a "A" at=0,0\nnode b "B" at=200,0\na -> b "decision"')
    const lastShape = svg.lastIndexOf('stroke="#334155"')
    expect(lastShape).toBeGreaterThan(-1)
    expect(svg.indexOf('>decision<')).toBeGreaterThan(lastShape)
  })

  it('marks dashed connections', () => {
    const svg = render('node a "A" at=0,0\nnode b "B" at=200,0\na -> b style=dashed')
    expect(svg).toContain('stroke-dasharray')
  })

  it('renders an empty diagram without failing', () => {
    const svg = render('')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
  })
})

describe('escapeXml', () => {
  it('escapes every character that would break the document', () => {
    expect(escapeXml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&apos;')
  })
})
