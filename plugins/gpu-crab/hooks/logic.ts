// Pure logic for gpu-crab.

import type { GpuModel, GpuRun, LanTally } from '../types'

/** Ollama's /api/ps answer into models. */
export function parsePs(text: string): GpuModel[] | null {
  try {
    const v = JSON.parse(text) as { models?: { name?: string; model?: string; size?: number; size_vram?: number; context_length?: number; details?: { parameter_size?: string; quantization_level?: string } }[] }
    if (!v || !Array.isArray(v.models)) return null
    return v.models.map(m => ({
      name: m.name ?? m.model ?? '?',
      size: Number(m.size ?? 0),
      sizeVram: Number(m.size_vram ?? 0),
      ...(m.context_length ? { contextLength: m.context_length } : {}),
      ...(m.details?.parameter_size ? { parameterSize: m.details.parameter_size } : {}),
      ...(m.details?.quantization_level ? { quantization: m.details.quantization_level } : {}),
    }))
  } catch {
    return null
  }
}

export const gpuShare = (m: GpuModel): number => (m.size > 0 ? Math.round((m.sizeVram / m.size) * 1000) / 10 : 0)
export const gb = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1)
export const isSpilling = (m: GpuModel): boolean => m.size > 0 && m.sizeVram < m.size

/** What a local-llm call reads, from its arguments. */
export function subjectOf(tool: string, args: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' && p ? p.split('/').filter(Boolean).pop() ?? p : '')
  const short = tool.replace(/^mcp__[^_]+(?:_[^_]+)*__/, '')
  if (short === 'local_summarize') return `${base(args.path)}${args.mode && args.mode !== 'auto' ? ` (${args.mode})` : ''}`
  if (short === 'semantic_search') return `"${String(args.query ?? '').slice(0, 40)}" in ${base(args.root)}`
  if (short === 'local_ask') return args.path ? base(args.path) : String(args.prompt ?? '').slice(0, 40)
  return short
}

export const toolShort = (tool: string): string => tool.split('__').pop() ?? tool

/** The trailer local_summarize writes: "(syslog.txt: 412,345 characters in 17 parts, model qwen3:8b)". */
export function parseTrailer(text: string): { chars?: number; parts?: number } {
  const m = text.match(/:\s*([\d,]+) characters(?: in (\d+) parts?)?/)
  if (!m || !m[1]) return {}
  return { chars: Number(m[1].replace(/,/g, '')), ...(m[2] ? { parts: Number(m[2]) } : {}) }
}

export const today = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addToTally(t: LanTally, day: string, chars: number): LanTally {
  return t.day === day ? { day, calls: t.calls + 1, chars: t.chars + chars } : { day, calls: 1, chars }
}

/** "1.2 MB ≈ 310k tokens". Tokens are estimated at four characters each. */
export function tallyText(t: LanTally): string {
  if (!t.calls) return 'Nothing read by local models today.'
  const mb = t.chars >= 1e6 ? `${(t.chars / 1e6).toFixed(1)} MB` : `${Math.round(t.chars / 1000)} KB`
  const tok = Math.round(t.chars / 4)
  return `local models read ${mb} today in ${t.calls} call${t.calls === 1 ? '' : 's'} ≈ ${tok >= 1000 ? `${Math.round(tok / 1000)}k` : tok} tokens kept on the LAN`
}

export const clock = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** One line for the band or the terminal. */
export function line(run: GpuRun, models: GpuModel[], vramGb: number, now: number): string {
  const m = models[0]
  const parts = [toolShort(run.tool) + (run.subject ? ` · ${run.subject}` : '')]
  if (m) parts.push(`${m.name} · ${gb(m.sizeVram)}/${vramGb} GB VRAM · ${gpuShare(m)}% GPU${isSpilling(m) ? ' (spilling to CPU)' : ''}`)
  else parts.push('no model loaded yet')
  parts.push(run.endedAt ? `done in ${clock(run.endedAt - run.startedAt)}${run.parts ? `, ${run.parts} parts` : ''}` : clock(now - run.startedAt))
  return parts.join(' · ')
}
