// Shared drawing helpers for the crab-workshop mods (copied into each mod's
// hooks/shared/ by scripts/sync-shared.sh; edit the copy in /shared).

import { CRAB_CSS } from './crab'

export const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
export const MONO = "ui-monospace,'SF Mono',Menlo,monospace"

export const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/** Cuts `s` to what fits `maxW` pixels at `size`, with an ellipsis. */
export const fit = (s: string, size: number, maxW: number): string => {
  const max = Math.max(4, Math.floor(maxW / (size * 0.56)))
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// Text and line colours for both themes; `.ok`, `.warn`, `.bad` are state colours.
export const THEME_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.ln{stroke:#e4e4e1}.ok{fill:#2f8a57}.warn{fill:#b07012}.bad{fill:#c2412d}
.trk{fill:#ececea}.bar{fill:#378ADD}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.ln{stroke:#333331}.ok{fill:#6fcf97}.warn{fill:#f0c46a}.bad{fill:#f28b75}.trk{fill:#2b2b29}.bar{fill:#6aaef0}}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
</style>`

/** An SVG document with the theme and crab styles, `extraCss` (a <style> block) after them. */
export const svg = (W: number, H: number, body: string, extraCss = ''): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${THEME_CSS}${CRAB_CSS}${extraCss}${body}</svg>`

/** Width in CSS pixels for a pane or band `bodyColumns` wide. */
export const widthFor = (bodyColumns: number | undefined, min = 240, max = 900): number =>
  Math.max(min, Math.min(max, (bodyColumns || 40) * 8 - 8))

/** A horizontal meter: track plus a bar `pct` full, coloured by thresholds. */
export const meter = (x: number, y: number, w: number, h: number, pct: number, warnAt = 80, badAt = 95): string => {
  const p = Math.max(0, Math.min(100, pct))
  const cls = p >= badAt ? 'bad' : p >= warnAt ? 'warn' : 'bar'
  return `<rect class="trk" x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/><rect class="${cls}" x="${x}" y="${y}" width="${Math.max(h, (w * p) / 100)}" height="${h}" rx="${h / 2}"/>`
}

/** "3m", "2h 5m", "4d" from milliseconds. */
export const ago = (ms: number): string => {
  const m = Math.round(ms / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return m % 60 && h < 10 ? `${h}h ${m % 60}m` : `${h}h`
  return `${Math.floor(h / 24)}d`
}
