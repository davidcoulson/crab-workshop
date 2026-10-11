export type FuelWindow = {
  /** five_hour, seven_day, or a label from the app (`Weekly · Fable`). */
  kind: string
  percentUsed: number
  resetsAt?: string
}

export type FuelReading = {
  contextPercent?: number
  contextTokens?: number
  contextWindow?: number
  windows: FuelWindow[]
  costUsd?: number
  /** Extra (pay-as-you-go) usage from the app's usage card. */
  extra?: { spent: number; limit: number; currency: string; isEnabled: boolean }
  at: number
}

export type FleetRow = {
  id: string
  name: string
  percent?: number
  tokens?: number
  window?: number
  note?: string
}

declare module 'claude-code' {
  interface PluginState {
    'fuel-gauge': {
      reading: FuelReading
      fleet: { rows: FleetRow[]; at: number; isBusy: boolean; error?: string }
      now: number
    }
  }
}
