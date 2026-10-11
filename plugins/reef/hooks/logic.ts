// Pure logic for reef: containers into fish, and the scene as SVG.

import type { Fish, Tank } from '../types'

export const STACKS: [string, RegExp, string][] = [
  ['arr', /(radarr|sonarr|prowlarr|lidarr|readarr|bazarr|seerr|overseerr|jellyseerr|prismarr|recyclarr|qbit|sabnzbd|nzbget|gluetun|flaresolverr|unpackerr)/i, '#e8833a'],
  ['media', /(plex|jellyfin|emby|tautulli|kometa|audiobookshelf|navidrome|immich|photoprism)/i, '#9b6bd6'],
  ['home', /(home-?assistant|esphome|mqtt|mosquitto|zigbee|z2m|zwave|node-?red|frigate|music-?assistant|matter|govee|theater-panel|kiosk)/i, '#21a38f'],
  ['net', /(technitium|adguard|pihole|nginx|npm|proxy|tailscale|cloudflared|unifi|wireguard|traefik|caddy|ddns|dns)/i, '#3b82d6'],
  ['data', /(postgres|mariadb|mysql|redis|influx|mongo|zerobyte|restic|duplicati|backup|minio|syncthing)/i, '#c9a227'],
  ['ai', /(ollama|open-?webui|claude|codex|llm|whisper|piper|wyoming)/i, '#d95fa0'],
]

export function stackOf(name: string, image = ''): { stack: string; color: string } {
  const hay = `${name} ${image}`
  const hit = STACKS.find(([, re]) => re.test(hay))
  return hit ? { stack: hit[0], color: hit[2] } : { stack: 'other', color: '#8a96a3' }
}

type Container = { names?: string[]; image?: string; state?: string; status?: string; autoStart?: boolean }

export function fishFrom(containers: Container[]): Fish[] {
  return containers
    .filter(c => c && typeof c === 'object')
    .map(c => {
      const name = (c.names?.[0] ?? '?').replace(/^\//, '')
      const running = c.state === 'RUNNING'
      const mood: Fish['mood'] = running ? (/\(unhealthy\)/i.test(c.status ?? '') ? 'bellyup' : 'swim') : c.autoStart ? 'missing' : 'rest'
      return { name, stack: stackOf(name, c.image).stack, mood, ...(c.image ? { image: c.image } : {}), ...(c.status ? { status: c.status } : {}) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** A small, stable hash: the same fish keeps its place and pace. */
export function hash(s: string): number {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  return h
}

export function summary(t: Tank): string {
  const n = (m: Fish['mood']) => t.fish.filter(f => f.mood === m)
  const parts = [`${n('swim').length} fish swimming`]
  if (n('bellyup').length) parts.push(`belly-up: ${n('bellyup').map(f => f.name).join(', ')}`)
  if (n('missing').length) parts.push(`missing: ${n('missing').map(f => f.name).join(', ')}`)
  if (n('rest').length) parts.push(`${n('rest').length} resting`)
  parts.push(t.models.length ? `heater on (${t.models.join(', ')})` : 'heater off')
  if (t.ha) parts.push(t.ha.isRunning ? (t.ha.repairs ? `lighthouse blinking: ${t.ha.repairs} HA repairs` : 'lighthouse steady') : 'lighthouse dark: HA not running')
  if (t.crabs.length) parts.push(`${t.crabs.length} crab${t.crabs.length === 1 ? '' : 's'} at work`)
  return parts.join(' · ')
}

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/** One fish at (x, y) facing right, `len` long; the body and fins in its stack colour. */
export function fishShape(f: Fish, len: number): string {
  const color = stackOf(f.name, f.image).color
  const h = len * 0.42
  const body = f.mood === 'bellyup' || f.mood === 'missing' ? '#9aa3ab' : color
  return (
    `<ellipse cx="${len * 0.55}" cy="0" rx="${len * 0.45}" ry="${h / 2}" fill="${body}"/>` +
    `<path d="M${len * 0.14} 0 L0 ${-h * 0.45} L0 ${h * 0.45}Z" fill="${body}" opacity="0.85"/>` +
    `<path d="M${len * 0.5} ${-h / 2.2} q${len * 0.12} ${-h * 0.35} ${len * 0.22} 0Z" fill="${body}" opacity="0.7"/>` +
    (f.mood === 'bellyup' || f.mood === 'missing'
      ? `<path d="M${len * 0.78} ${-h * 0.14} l${len * 0.07} ${h * 0.14} m0 ${-h * 0.14} l${-len * 0.07} ${h * 0.14}" stroke="#2b2b2b" stroke-width="1"/>`
      : `<circle cx="${len * 0.8}" cy="${-h * 0.08}" r="${Math.max(1.2, len * 0.045)}" fill="#1b1b1b"/>`)
  )
}

/** The tank: water, sand, plants, heater, lighthouse, fish, then crabs drawn by `crabAt`. */
export function scene(W: number, H: number, t: Tank, swimmers: number, crabAt: (x: number, y: number, i: number) => string): string {
  const sandY = H - 34
  const css: string[] = [
    '.water{fill:url(#w)}.sand{fill:#e7d7b0}.sand2{fill:#d9c596}.weed{fill:none;stroke:#3f9a6b;stroke-width:3;stroke-linecap:round;animation:sway 4s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 100%}',
    '@keyframes sway{50%{transform:rotate(6deg)}}.bub{fill:#ffffff;opacity:.5;animation:rise 6s linear infinite}@keyframes rise{to{transform:translateY(-220px);opacity:0}}',
    '.heat{animation:glow 2.4s ease-in-out infinite}@keyframes glow{50%{opacity:.45}}.beam{animation:beam 3s steps(1) infinite}@keyframes beam{50%{opacity:0}}',
    '.bob{animation:bob 3s ease-in-out infinite;transform-box:fill-box}@keyframes bob{50%{transform:translateY(-3px)}}',
    '.tl{fill:#e9f4fb;font-size:9px}',
    '@media (prefers-color-scheme: dark){.sand{fill:#5a5038}.sand2{fill:#4a4230}}',
  ]
  const out: string[] = [
    `<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc3e8"/><stop offset="1" stop-color="#1f6a9a"/></linearGradient></defs>`,
    `<rect class="water" x="0" y="0" width="${W}" height="${H}" rx="8"/>`,
  ]
  // Weeds and bubbles: fixed by width, so a redraw doesn't shuffle them.
  for (let i = 0; i < Math.max(3, Math.floor(W / 120)); i++) {
    const x = 30 + ((i * 137) % Math.max(60, W - 60))
    out.push(`<path class="weed" style="animation-delay:-${i * 0.7}s" d="M${x} ${sandY + 6} q-8 -20 0 -40 q8 -20 0 -40"/>`)
    out.push(`<circle class="bub" style="animation-delay:-${(i * 1.3) % 6}s" cx="${x + 14}" cy="${sandY}" r="2.5"/>`)
  }
  out.push(`<path class="sand" d="M0 ${sandY} q${W / 4} -8 ${W / 2} 0 t${W / 2} 0 V${H} H0Z"/><rect class="sand2" x="0" y="${H - 10}" width="${W}" height="10"/>`)
  // Heater, bottom left: glows while a model is loaded on the GPU.
  const on = t.models.length > 0
  out.push(
    `<g><title>${esc(on ? `GPU heater: ${t.models.join(', ')}` : 'GPU heater: no model loaded')}</title><rect x="10" y="${sandY - 64}" width="12" height="62" rx="5" fill="#5b636b"/>` +
      `<rect ${on ? 'class="heat" ' : ''}x="12" y="${sandY - 58}" width="8" height="50" rx="3" fill="${on ? '#ff8a3d' : '#3b4248'}"/></g>`,
  )
  // Lighthouse, bottom right: HA.
  if (t.ha) {
    const lx = W - 34
    const lamp = !t.ha.isRunning ? '#3b3b3b' : t.ha.repairs ? '#ff5a4a' : '#ffe08a'
    out.push(
      `<g><title>${esc(t.ha.isRunning ? `Home Assistant: ${t.ha.repairs} repairs, ${t.ha.notes} notifications` : 'Home Assistant is not running')}</title>` +
        `<path d="M${lx - 8} ${sandY + 2} L${lx - 5} ${sandY - 60} H${lx + 5} L${lx + 8} ${sandY + 2}Z" fill="#f4f1ea"/>` +
        `<rect x="${lx - 5}" y="${sandY - 44}" width="10" height="7" fill="#d2463a"/><rect x="${lx - 5}" y="${sandY - 22}" width="10" height="7" fill="#d2463a"/>` +
        `<rect x="${lx - 6}" y="${sandY - 72}" width="12" height="12" fill="${lamp}"/>` +
        (t.ha.isRunning && t.ha.repairs ? `<path class="beam" d="M${lx - 6} ${sandY - 66} L${lx - 70} ${sandY - 84} L${lx - 70} ${sandY - 48}Z" fill="${lamp}" opacity="0.35"/>` : '') +
        `<path d="M${lx - 8} ${sandY - 72} L${lx} ${sandY - 80} L${lx + 8} ${sandY - 72}Z" fill="#2f3a44"/></g>`,
    )
  }
  // Fish: swimmers get a lane each; the rest hover in place.
  const live = t.fish.filter(f => f.mood !== 'rest')
  const top = 16
  const lanes = Math.max(1, sandY - 40 - top)
  live.forEach((f, i) => {
    const h = hash(f.name)
    const len = 16 + (h % 9)
    const y = f.mood === 'bellyup' || f.mood === 'missing' ? top + (h % 18) : top + 22 + (h % lanes)
    const x0 = 36 + ((h >>> 8) % Math.max(40, W - 120))
    const isSwimmer = f.mood === 'swim' && i < swimmers
    const d = Math.min(W - 70 - x0, 60 + ((h >>> 4) % 140))
    const dur = 7 + ((h >>> 12) % 9)
    const flip = f.mood === 'bellyup' || f.mood === 'missing' ? ` scale(1,-1)` : ''
    const label = `${f.name}${f.image ? ` · ${f.image}` : ''}${f.status ? ` · ${f.status}` : ''}`
    if (isSwimmer && d > 20) {
      css.push(`@keyframes f${i}{0%{transform:translate(${x0}px,${y}px) scaleX(1)}48%{transform:translate(${x0 + d}px,${y}px) scaleX(1)}50%{transform:translate(${x0 + d + len}px,${y}px) scaleX(-1)}98%{transform:translate(${x0 + len}px,${y}px) scaleX(-1)}100%{transform:translate(${x0}px,${y}px) scaleX(1)}}`)
      out.push(`<g style="animation:f${i} ${dur}s ease-in-out infinite;animation-delay:-${h % dur}s"><title>${esc(label)}</title>${fishShape(f, len)}</g>`)
    } else {
      out.push(`<g transform="translate(${x0},${y})${flip}"><g class="bob" style="animation-delay:-${h % 3}s"><title>${esc(label)}</title>${fishShape(f, len)}</g></g>`)
    }
  })
  // Crabs on the sand, one per side session at work.
  t.crabs.slice(0, Math.max(0, Math.floor((W - 120) / 44))).forEach((_, i) => out.push(crabAt(44 + i * 44, sandY - 20, i)))
  return `<style>${css.join('\n')}</style>${out.join('')}`
}
