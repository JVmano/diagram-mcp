/**
 * MCP server wiring.
 *
 * Nothing is written to stdout except the protocol itself, since stdout is the
 * transport. Diagnostics go to stderr.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readConfig, type Config } from './config'
import { handleDiagramSyntax, handleRenderDiagram, handleValidateDiagram } from './tools'

export const SERVER_NAME = 'diagram-mcp'
export const SERVER_VERSION = '1.0.0'

const codeSchema = z
  .string()
  .min(1, 'code must not be empty')
  .describe('Diagram source code. Call diagram_syntax for the language reference.')

export function createServer(config: Config = readConfig()): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: [
        'Renders diagram-as-code text into PNG files on the local disk.',
        'Write the code, call render_diagram, and use the returned path to attach the image wherever it is needed.',
        'Call diagram_syntax first if you have not written this language before, and validate_diagram if you want to check code without writing a file.',
        `Renders are written to ${config.outputDir} unless outputPath says otherwise.`,
      ].join(' '),
    },
  )

  server.registerTool(
    'render_diagram',
    {
      title: 'Render diagram to PNG',
      description:
        'Render diagram-as-code text to a PNG file and return the path. Runs locally with no browser and no network. Returns an error listing the offending line numbers if the code does not parse.',
      inputSchema: {
        code: codeSchema,
        name: z
          .string()
          .max(80)
          .optional()
          .describe('Base name for the file, without extension. Defaults to the diagram title.'),
        outputPath: z
          .string()
          .max(1024)
          .optional()
          .describe(
            'Exact path to write, ending in .png. Must sit inside the render directory or the working directory unless DIAGRAM_MCP_ALLOW_ANY_OUTPUT_PATH is set.',
          ),
        scale: z.number().min(0.5).max(6).optional().describe('Pixel density multiplier. Default 2.'),
        background: z
          .enum(['white', 'transparent'])
          .optional()
          .describe('Default white. Use transparent for docs with a dark theme.'),
        padding: z.number().min(0).max(400).optional().describe('Margin around the diagram in pixels. Default 40.'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Replace an existing file with the same name. Default false, which adds a numeric suffix.'),
      },
      annotations: {
        title: 'Render diagram to PNG',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => handleRenderDiagram(args, config),
  )

  server.registerTool(
    'validate_diagram',
    {
      title: 'Validate diagram code',
      description:
        'Parse diagram code and report errors and warnings with line numbers, without writing any file.',
      inputSchema: { code: codeSchema },
      annotations: {
        title: 'Validate diagram code',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => handleValidateDiagram(args, config),
  )

  server.registerTool(
    'diagram_syntax',
    {
      title: 'Diagram language reference',
      description: 'Return the full diagram-as-code language reference, with shapes, options and a worked example.',
      inputSchema: {},
      annotations: {
        title: 'Diagram language reference',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => handleDiagramSyntax(),
  )

  return server
}
