export type ChipLevel = 'ok' | 'info' | 'warn' | 'bad'

export type Chip = {
  key: string
  level: ChipLevel
  /** Short text for the band: `array ok · 47 pools`. */
  text: string
  /** The longer line /vitals prints. */
  detail?: string
}

export type Vitals = {
  chips: Chip[]
  at: number
  /** Sources that failed on the last read, with why. */
  errors: string[]
  isAlwaysShown: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'vitals-strip': {
      vitals: Vitals
    }
  }
}
