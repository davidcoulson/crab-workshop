export type Finding = {
  kind: string
  tool: string
  /** Where in the output: the field path (stdout, content.0.text). */
  where: string
  length: number
  /** An 8-hex-digit FNV-1a tag of the value (never the value): what /keymaster allow takes. */
  tag: string
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    keymaster: {
      findings: Finding[]
    }
  }
}
