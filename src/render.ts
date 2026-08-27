/**
 * Rendering pipeline: diagram code to a PNG file on disk.
 *
 * Parsing, layout and SVG generation come from the copied core engine, so the
 * output matches the Diagram Desk editor. Only the rasterising step is new, and
 * it runs in process through resvg, with no browser and no network.
 */

import { Resvg } from '@resvg/resvg-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { renderDiagramSvg } from './core/export/svg'
import { layoutDiagram } from './core/model/layout'
import { hasErrors, parseDiagram } from './core/model/parser'
import type { Problem } from './core/model/types'
import type { Config } from './config'

export class RenderError extends Error {
  constructor(
    message: string,
    readonly problems: Problem[] = [],
  ) {
    super(message)
    this.name = 'RenderError'
  }
}

export interface RenderRequest {
  code: string
  name?: string
  outputPath?: string
  scale?: number
  background?: 'white' | 'transparent'
  padding?: number
  overwrite?: boolean
}

export interface RenderResult {
  path: string
  width: number
  height: number
  bytes: number
  title: string
  nodeCount: number
  edgeCount: number
  autoPlacedCount: number
  warnings: Problem[]
}

/** Turns any label into something safe to use as a file name. */
export function safeBaseName(raw: string, fallback = 'diagram'): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return cleaned === '' ? fallback : cleaned
}

/**
 * Decides where the PNG goes and refuses to write outside the allowed roots.
 * An agent choosing its own absolute path is useful, and also the one way this
 * server could overwrite something it should not.
 */
export function resolveOutputPath(
  config: Config,
  request: { name?: string; outputPath?: string; title?: string; overwrite?: boolean },
  cwd = process.cwd(),
): string {
  if (request.outputPath !== undefined && request.outputPath.trim() !== '') {
    const target = isAbsolute(request.outputPath)
      ? resolve(request.outputPath)
      : resolve(cwd, request.outputPath)
    if (!target.toLowerCase().endsWith('.png')) {
      throw new RenderError('outputPath must end in .png')
    }
    if (!config.allowAnyOutputPath) {
      const roots = [config.outputDir, cwd]
      const allowed = roots.some((root) => {
        const rel = relative(resolve(root), target)
        return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
      })
      if (!allowed) {
        throw new RenderError(
          `outputPath must be inside the render directory (${config.outputDir}) or the working directory (${cwd}). Set DIAGRAM_MCP_ALLOW_ANY_OUTPUT_PATH=true to lift this.`,
        )
      }
    }
    return target
  }

  const base = safeBaseName(request.name ?? request.title ?? 'diagram')
  const first = resolve(config.outputDir, `${base}.png`)
  if (request.overwrite === true || !existsSync(first)) return first
  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = resolve(config.outputDir, `${base}-${counter}.png`)
    if (!existsSync(candidate)) return candidate
  }
  throw new RenderError(`There are already 1000 files called ${base} in ${config.outputDir}.`)
}

export interface ValidationReport {
  ok: boolean
  title: string
  nodeCount: number
  edgeCount: number
  autoPlacedCount: number
  problems: Problem[]
}

export function validateCode(code: string, config: Config): ValidationReport {
  if (code.length > config.maxCodeChars) {
    return {
      ok: false,
      title: '',
      nodeCount: 0,
      edgeCount: 0,
      autoPlacedCount: 0,
      problems: [
        {
          severity: 'error',
          line: 1,
          message: `The diagram code is ${code.length} characters, above the ${config.maxCodeChars} limit.`,
        },
      ],
    }
  }
  const parsed = parseDiagram(code)
  const placed = layoutDiagram(parsed.diagram)
  return {
    ok: !hasErrors(parsed.problems),
    title: parsed.diagram.title,
    nodeCount: parsed.diagram.nodes.length,
    edgeCount: parsed.diagram.edges.length,
    autoPlacedCount: placed.nodes.filter((node) => node.auto).length,
    problems: parsed.problems,
  }
}

export async function renderToPng(request: RenderRequest, config: Config, cwd = process.cwd()): Promise<RenderResult> {
  const report = validateCode(request.code, config)
  if (!report.ok) {
    throw new RenderError('The diagram code has errors, so nothing was written.', report.problems)
  }
  if (report.nodeCount === 0) {
    throw new RenderError('The diagram has no shapes, so there is nothing to render.', report.problems)
  }

  const parsed = parseDiagram(request.code)
  const placed = layoutDiagram(parsed.diagram)
  const background = request.background ?? config.defaultBackground
  const svg = renderDiagramSvg(placed, {
    background,
    padding: request.padding ?? config.defaultPadding,
  })

  const scale = Math.min(6, Math.max(0.5, request.scale ?? config.defaultScale))
  let png: Buffer
  let width: number
  let height: number
  try {
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'zoom', value: scale },
      font: { loadSystemFonts: true, defaultFontFamily: config.fontFamily },
      ...(background === 'white' ? { background: '#ffffff' } : {}),
    })
    const image = resvg.render()
    width = image.width
    height = image.height
    png = image.asPng()
  } catch (error) {
    throw new RenderError(
      `The diagram could not be rasterised: ${error instanceof Error ? error.message : 'unknown resvg failure'}`,
    )
  }

  const target = resolveOutputPath(
    config,
    { ...request, title: parsed.diagram.title },
    cwd,
  )
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, png)
  } catch (error) {
    throw new RenderError(
      `The PNG could not be written to ${target}: ${error instanceof Error ? error.message : 'unknown write failure'}`,
    )
  }

  return {
    path: target,
    width,
    height,
    bytes: png.length,
    title: parsed.diagram.title,
    nodeCount: report.nodeCount,
    edgeCount: report.edgeCount,
    autoPlacedCount: report.autoPlacedCount,
    warnings: report.problems.filter((problem) => problem.severity === 'warning'),
  }
}
