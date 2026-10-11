export type RuleAction = 'note' | 'ask' | 'deny'

export type HouseRule = {
  id: string
  /** Tool-name globs the rule looks at (Bash, Write, mcp__*__ha_restart). */
  tools: string[]
  /** Regexes (source, flags i) on the call's input as JSON; every one must match. */
  match: string[]
  /** A regex that, matching, lets the call through. */
  unless?: string
  action: RuleAction
  message: string
  isBuiltIn?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'house-rules': {
      hits: Record<string, number>
    }
  }
}
