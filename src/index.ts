/** Entry point: serves the MCP server over stdio. */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile, readConfig } from './config'
import { createServer, SERVER_NAME, SERVER_VERSION } from './server'

const here = dirname(fileURLToPath(import.meta.url))
loadEnvFile(resolve(here, '..', '.env'))

const config = readConfig()

async function main(): Promise<void> {
  const server = createServer(config)
  await server.connect(new StdioServerTransport())
  process.stderr.write(`${SERVER_NAME} ${SERVER_VERSION} ready, renders go to ${config.outputDir}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${SERVER_NAME} failed to start: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
