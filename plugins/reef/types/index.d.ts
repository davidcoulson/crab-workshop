export type Fish = {
  name: string
  stack: string
  /** swimming, belly-up (unhealthy), resting (stopped on purpose), missing (should run, doesn't). */
  mood: 'swim' | 'bellyup' | 'rest' | 'missing'
  image?: string
  status?: string
}

export type Tank = {
  fish: Fish[]
  /** Loaded Ollama models, for the heater. */
  models: string[]
  /** HA: null when not read. */
  ha: { repairs: number; notes: number; isRunning: boolean } | null
  /** Side sessions at work, one crab each. */
  crabs: string[]
  at: number
  errors: string[]
}

declare module 'claude-code' {
  interface PluginState {
    reef: { tank: Tank }
  }
}
