// Pure detection for keymaster. Each detector names the part of a match that
// is the secret (group `secret`), so the words around it survive.

export type Hit = { kind: string; start: number; end: number; value: string }

type Detector = { kind: string; re: RegExp }

const ASSIGN_KEYS = [
  'api[_-]?key', 'apikey', 'api[_-]?token', 'access[_-]?token', 'refresh[_-]?token', 'auth[_-]?token', 'token', 'secret', 'client[_-]?secret',
  'password', 'passwd', 'pwd', 'passphrase', 'x-plex-token', 'x-api-key', 'access[_-]?key', 'secret[_-]?key', 'private[_-]?key',
  'encryption[_-]?key', 'webhook[_-]?id', 'bearer', 'mqtt[_-]?pass(?:word)?', 'ha[_-]?token', 'license[_-]?key',
].join('|')

export const DETECTORS: Detector[] = [
  { kind: 'private-key', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----(?<secret>[\s\S]+?)-----END (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { kind: 'jwt', re: /(?<secret>eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g },
  { kind: 'github-token', re: /(?<secret>(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}))/g },
  { kind: 'anthropic-key', re: /(?<secret>sk-ant-[A-Za-z0-9_-]{20,})/g },
  { kind: 'openai-key', re: /(?<![A-Za-z0-9])(?<secret>sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,})/g },
  { kind: 'aws-key', re: /(?<secret>(?:AKIA|ASIA)[0-9A-Z]{16})/g },
  { kind: 'slack-token', re: /(?<secret>xox[abprs]-[A-Za-z0-9-]{10,})/g },
  { kind: 'google-key', re: /(?<secret>AIza[0-9A-Za-z_-]{35})/g },
  { kind: 'arr-api-key', re: /<ApiKey>(?<secret>[^<\s]{16,})<\/ApiKey>/g },
  { kind: 'esphome-key', re: /\bkey:\s*["']?(?<secret>[A-Za-z0-9+/]{40,}={0,2})["']?/g },
  { kind: 'bearer', re: /\b(?:Bearer|Token)\s+(?<secret>[A-Za-z0-9._~+/=-]{16,})/g },
  { kind: 'url-password', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:(?<secret>[^\s@/]{3,})@/gi },
  {
    kind: 'assigned-secret',
    // name = value, name: value, "name": "value", name=value in a query string; the value is the secret.
    re: new RegExp(`(?<![A-Za-z0-9])["']?(?:${ASSIGN_KEYS})["']?\\s*[:=]\\s*["']?(?<secret>[^\\s"',;&<>{}()\\[\\]]{8,})`, 'gi'),
  },
]

const PLACEHOLDER = /^(?:\$\{?[A-Z_][A-Z0-9_]*\}?|<[^>]*>|\*+|x{3,}|•+|‹masked[^›]*›|redacted|\[redacted\]|null|none|true|false|undefined|changeme|example|your[_-].*|\{\{.*\}\})$/i

/** Whether a candidate value is a real-looking secret rather than a placeholder, path, number or masked text. */
export function isSecretLike(kind: string, v: string): boolean {
  if (PLACEHOLDER.test(v)) return false
  if (v.includes('‹masked')) return false
  if (kind === 'assigned-secret' || kind === 'bearer') {
    if (/^[./~]/.test(v) || /^[a-z]+:\/\//i.test(v)) return false // a path or URL
    if (/^\d+$/.test(v)) return false // a count or port
    if (/^[a-z]+([_-][a-z]+)*$/.test(v) && v.length < 20) return false // a word like `required`, `file_path`
    if (/^!secret\b/.test(v)) return false
  }
  return true
}

export function findSecrets(text: string): Hit[] {
  const hits: Hit[] = []
  for (const d of DETECTORS) {
    d.re.lastIndex = 0
    for (const m of text.matchAll(d.re)) {
      const value = m.groups?.secret
      if (!value || m.index === undefined) continue
      const start = m.index + m[0].indexOf(value)
      if (!isSecretLike(d.kind, value)) continue
      hits.push({ kind: d.kind, start, end: start + value.length, value })
    }
  }
  // Earlier and longer first; drop hits inside one already kept.
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: Hit[] = []
  for (const h of hits) if (!kept.some(k => h.start < k.end && h.end > k.start)) kept.push(h)
  return kept
}

export const mask = (kind: string, tag: string): string => `‹masked ${kind} ${tag}›`

/** Masks every hit not allowed; `tagOf` names each value (a hash prefix). */
export function redact(text: string, tagOf: (v: string) => string, allowed: ReadonlySet<string>): { text: string; hits: (Hit & { tag: string })[] } {
  const hits = findSecrets(text)
    .map(h => ({ ...h, tag: tagOf(h.value) }))
    .filter(h => !allowed.has(h.tag))
  if (!hits.length) return { text, hits }
  let out = ''
  let at = 0
  for (const h of hits) {
    out += text.slice(at, h.start) + mask(h.kind, h.tag)
    at = h.end
  }
  return { text: out + text.slice(at), hits }
}

/** Walks a value, redacting every string; returns the new value and what it found, with where. */
export function redactDeep(value: unknown, tagOf: (v: string) => string, allowed: ReadonlySet<string>, path = ''): { value: unknown; hits: (Hit & { tag: string; where: string })[] } {
  if (typeof value === 'string') {
    const r = redact(value, tagOf, allowed)
    return { value: r.text, hits: r.hits.map(h => ({ ...h, where: path || 'output' })) }
  }
  if (Array.isArray(value)) {
    const hits: (Hit & { tag: string; where: string })[] = []
    const out = value.map((v, i) => {
      const r = redactDeep(v, tagOf, allowed, path ? `${path}.${i}` : String(i))
      hits.push(...r.hits)
      return r.value
    })
    return { value: hits.length ? out : value, hits }
  }
  if (value && typeof value === 'object') {
    const hits: (Hit & { tag: string; where: string })[] = []
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const r = redactDeep(v, tagOf, allowed, path ? `${path}.${k}` : k)
      hits.push(...r.hits)
      out[k] = r.value
    }
    return { value: hits.length ? out : value, hits }
  }
  return { value, hits: [] }
}

/** Every string in a value, joined: what gets scanned and hashed. */
export function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach(v => strings(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach(v => strings(v, out))
  return out
}

/** A note for commands that tend to print secrets, or null. */
export function riskyCommand(command: string): string | null {
  if (/\bdocker\s+(container\s+)?inspect\b/.test(command) && !/--format|-f\s/.test(command)) return 'docker inspect prints every environment variable, keys included; use --format with only the fields you need.'
  if (/(^|[\s;&|])(printenv|env)(\s*($|[|;&]))/.test(command)) return 'printenv/env prints every variable, tokens included; print only the variable names (env | cut -d= -f1) or test the one you need.'
  if (/\b(cat|less|head|tail|bat|grep)\b[^|;&]*\.env(\.[a-z]+)?\b/.test(command)) return '.env files hold secrets; read only the names (cut -d= -f1) unless a value is truly needed.'
  if (/config\.xml\b/.test(command) && /(radarr|sonarr|prowlarr|lidarr|readarr|bazarr)/i.test(command)) return "An Arr config.xml holds the instance's ApiKey; grep for the fields you need with the key left out."
  return null
}

export const glob = (pattern: string, s: string): boolean =>
  new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$').test(s)

/** FNV-1a as 8 hex digits: a stable tag for a value, never the value. */
export function tag(value: string): string {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619) >>> 0
  return h.toString(16).padStart(8, '0')
}
