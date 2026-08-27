/**
 * Runtime configuration, read from the environment.
 *
 * The server needs no secrets and no credentials, because it calls no external
 * service. Every value has a working default, so an empty environment is fine.
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'

function readNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback
  return raw.toLowerCase() === 'true' || raw === '1'
}

function readString(raw: string | undefined, fallback: string): string {
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim()
}

/** Loads a .env file next to the server if one exists. Absent is not an error. */
export function loadEnvFile(path: string): void {
  try {
    process.loadEnvFile?.(path)
  } catch {
    return
  }
}

export interface Config {
  outputDir: string
  defaultScale: number
  defaultBackground: 'white' | 'transparent'
  defaultPadding: number
  fontFamily: string
  maxCodeChars: number
  allowAnyOutputPath: boolean
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const background = readString(env.DIAGRAM_MCP_BACKGROUND, 'white').toLowerCase()
  return {
    outputDir: resolve(readString(env.DIAGRAM_MCP_OUTPUT_DIR, `${homedir()}/Documents/diagram-renders`)),
    defaultScale: readNumber(env.DIAGRAM_MCP_DEFAULT_SCALE, 2, 1, 6),
    defaultBackground: background === 'transparent' ? 'transparent' : 'white',
    defaultPadding: readNumber(env.DIAGRAM_MCP_PADDING, 40, 0, 400),
    fontFamily: readString(env.DIAGRAM_MCP_FONT_FAMILY, 'Helvetica'),
    maxCodeChars: readNumber(env.DIAGRAM_MCP_MAX_CODE_CHARS, 200_000, 1_000, 1_000_000),
    allowAnyOutputPath: readBoolean(env.DIAGRAM_MCP_ALLOW_ANY_OUTPUT_PATH, false),
  }
}
