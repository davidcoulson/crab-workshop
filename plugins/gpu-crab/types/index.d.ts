export type GpuModel = {
  name: string
  /** Bytes in memory, all of it. */
  size: number
  /** Bytes of it on the GPU. */
  sizeVram: number
  contextLength?: number
  parameterSize?: string
  quantization?: string
}

export type GpuRun = {
  /** The local-llm tool (local_summarize, local_ask, semantic_search). */
  tool: string
  /** A short description of what it reads. */
  subject: string
  startedAt: number
  endedAt?: number
  /** From the result: characters read and parts summarised. */
  chars?: number
  parts?: number
  isError?: boolean
}

export type GpuReading = {
  models: GpuModel[]
  at: number
  error?: string
}

export type LanTally = {
  /** Local date, YYYY-MM-DD. */
  day: string
  calls: number
  chars: number
}

declare module 'claude-code' {
  interface PluginState {
    'gpu-crab': {
      run: GpuRun | null
      reading: GpuReading
      tally: LanTally
      now: number
    }
  }
}
