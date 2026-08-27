/**
 * Tool handlers, kept free of transport concerns so they can be tested directly.
 *
 * Every handler returns MCP text content. Failures come back as isError results
 * with the offending line numbers, so the caller can fix the code and retry
 * instead of guessing what went wrong.
 */

import type { Config } from './config'
import type { Problem } from './core/model/types'
import { renderDiagramAscii } from './ascii'
import { layoutDiagram } from './core/model/layout'
import { parseDiagram } from './core/model/parser'
import { RenderError, renderToPng, validateCode, type RenderRequest } from './render'
import { SYNTAX_GUIDE } from './syntax'

export interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function text(body: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text: body }], ...(isError ? { isError: true } : {}) }
}

function formatProblems(problems: Problem[]): string {
  return problems
    .map((problem) => `  ${problem.severity} on line ${problem.line}: ${problem.message}`)
    .join('\n')
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`
}

export async function handleRenderDiagram(
  args: RenderRequest,
  config: Config,
  cwd = process.cwd(),
): Promise<ToolResult> {
  try {
    const result = await renderToPng(args, config, cwd)
    const lines = [
      `Rendered ${result.title === '' ? 'the diagram' : `"${result.title}"`} to ${result.path}`,
      `${result.width} x ${result.height} px, ${formatBytes(result.bytes)}, ${result.nodeCount} shapes, ${result.edgeCount} connections.`,
    ]
    if (result.autoPlacedCount > 0) {
      lines.push(
        `${result.autoPlacedCount} shapes had no at= position and were placed by the automatic layout.`,
      )
    }
    if (result.warnings.length > 0) {
      lines.push('Warnings:', formatProblems(result.warnings))
    }
    return text(lines.join('\n'))
  } catch (error) {
    if (error instanceof RenderError) {
      const body = [error.message]
      if (error.problems.length > 0) body.push(formatProblems(error.problems))
      body.push('Call diagram_syntax for the language reference.')
      return text(body.join('\n'), true)
    }
    return text(`The render failed: ${error instanceof Error ? error.message : 'unknown failure'}`, true)
  }
}

export function handleValidateDiagram(args: { code: string }, config: Config): ToolResult {
  const report = validateCode(args.code, config)
  const summary = `${report.nodeCount} shapes, ${report.edgeCount} connections${
    report.autoPlacedCount > 0 ? `, ${report.autoPlacedCount} placed automatically` : ''
  }.`

  if (!report.ok) {
    return text(
      [`The diagram code has errors.`, formatProblems(report.problems), summary].join('\n'),
      true,
    )
  }
  if (report.problems.length > 0) {
    return text([`The diagram code is valid, with warnings.`, formatProblems(report.problems), summary].join('\n'))
  }
  return text(`The diagram code is valid. ${summary}`)
}

export function handlePreviewDiagram(args: { code: string; maxCols?: number }, config: Config): ToolResult {
  const report = validateCode(args.code, config)
  if (!report.ok) {
    return text(['The diagram code has errors, so there is nothing to draw.', formatProblems(report.problems)].join('\n'), true)
  }
  if (report.nodeCount === 0) {
    return text('The diagram has no shapes, so there is nothing to draw.', true)
  }
  const art = renderDiagramAscii(layoutDiagram(parseDiagram(args.code).diagram), { maxCols: args.maxCols })
  const summary = `${report.nodeCount} shapes, ${report.edgeCount} connections.`
  const warnings = report.problems.length > 0 ? `\n${formatProblems(report.problems)}` : ''
  return text(`\`\`\`\n${art}\n\`\`\`\n${summary}${warnings}`)
}

export function handleDiagramSyntax(): ToolResult {
  return text(SYNTAX_GUIDE)
}
