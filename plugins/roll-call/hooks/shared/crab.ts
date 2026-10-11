// The crew's crabs: pixel art, costumes and motion copied from savvy-progress
// (https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress,
// MIT License, Copyright (c) 2026 johnnyvizz; see THIRD_PARTY_NOTICES.md),
// which credits the pixel crab to DockCrab (Clawdy).
//
// Changed here: a pose per session status (closed eyes and tucked legs to rest,
// happy eyes, both claws up and a hop to celebrate), and costumes named for
// what they wear instead of savvy-flow's tiers.

/** A crab's pose, by what its owner is doing. */
export type CrewStatus = 'working' | 'idle' | 'done' | 'proposed' | 'dismissed'

// Pixel Clawd from DockCrab (Clawdy): a 24×18 crab on a 30×28 grid, one costume per tier.
// The body keeps the brand clay; the tier's color lives in the costume's accent.
const CLAY = '#D97757'
const INK = '#1F1E1D'

export const COSTUME_COLOR: Record<string, string> = {
  fable: '#7F77DD',
  heavy: '#D85A30',
  careful: '#BA7517',
  medium: '#378ADD',
  light: '#1D9E75',
  explore: '#55514C',
  other: '#888780',
}

/** What a `faces` rule or `/crew face` may name, to the costume it draws. */
export const COSTUME_NAMES: Record<string, string> = {
  astronaut: 'fable',
  detective: 'heavy',
  engineer: 'careful',
  chef: 'medium',
  racer: 'light',
  pirate: 'explore',
  plain: 'other',
  // savvy-flow's own tier names work too.
  fable: 'fable',
  heavy: 'heavy',
  careful: 'careful',
  medium: 'medium',
  light: 'light',
  explore: 'explore',
  other: 'other',
}

export const WEARS: Record<string, string> = {
  fable: 'astronaut',
  heavy: 'detective',
  careful: 'engineer',
  medium: 'chef',
  light: 'racer',
  explore: 'pirate',
  other: 'plain',
}

/** Sessions with no rule take these in turn, in the order they joined. */
export const ROTATION = ['fable', 'heavy', 'careful', 'medium', 'light', 'explore'] as const

export const costumeKey = (name: string): string | undefined => COSTUME_NAMES[name.trim().toLowerCase()]

// `cls` puts a pixel in a named group: `bd` (the default) is the body and its
// costume, `la`/`lb` the leg pairs, anything else a prop with its own motion.
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

type Pose = { eyes: 'open' | 'closed' | 'happy'; isCheering: boolean }

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

const eyes = (f: Fill, pose: Pose): void => {
  if (pose.eyes === 'closed') {
    f(9, 13, 2, 1, INK)
    f(19, 13, 2, 1, INK)
  } else if (pose.eyes === 'happy') {
    f(9, 13, 1, 1, INK); f(10, 12, 1, 1, INK)
    f(19, 12, 1, 1, INK); f(20, 13, 1, 1, INK)
  } else {
    f(9, 12, 2, 2, INK)
    f(19, 12, 2, 2, INK)
  }
}

// `armCls` lets a raised claw travel with the prop it holds. A cheering crab
// raises the back claw too, in `ar`, which waves.
const crabBody = (f: Fill, pose: Pose, armFront = 0, armCls?: string): void => {
  f(7, 10, 16, 12, CLAY)
  if (pose.isCheering) f(3, 10, 4, 4, CLAY, 'ar')
  else f(3, 14, 4, 4, CLAY)
  f(23, 14 + (pose.isCheering && !armCls ? -4 : armFront), 4, 4, CLAY, armCls ?? (pose.isCheering ? 'ar' : undefined))
  eyes(f, pose)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

// Pure CSS, run by the compositor: no redraws. Periods divide one second, so the
// once-a-second redraw of a running row restarts them in phase. Every crab walks;
// each costume adds its prop's own motion on top.
export const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.c-fable.run{animation:float 1s ease-in-out infinite}
.c-fable.run .la,.c-fable.run .lb,.c-fable.run .bd{animation:none}
.c-fable.run .ant{animation:blink 1s steps(1) infinite}
.c-fable.run .star{animation:blink .5s steps(1) infinite -.25s}
@keyframes float{50%{transform:translateY(-2px)}}@keyframes blink{50%{opacity:.15}}
.c-heavy.run .it{animation:scan 1s steps(1) infinite}
.c-heavy.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-careful.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
.c-medium.run .pan{transform-origin:0 50%;animation:tilt 1s ease-in-out infinite}
.c-medium.run .egg{animation:flip 1s ease-in-out infinite}
@keyframes tilt{20%,40%{transform:rotate(-12deg)}}@keyframes flip{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:translateY(0)}}
.c-light.run .la{animation-duration:.25s}.c-light.run .lb{animation-duration:.25s;animation-delay:-.125s}
.c-light.run .flag{transform-origin:0 50%;animation:wave .25s steps(1) infinite}
@keyframes wave{50%{transform:skewY(-12deg) scaleX(.85)}}
.c-explore.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
.rest g{transform-box:fill-box}
.rest .bd{transform:translateY(2px)}.rest .la,.rest .lb{transform-origin:50% 100%;transform:scaleY(.5)}
.rest{transform-box:fill-box;transform-origin:50% 100%;animation:breathe 4s ease-in-out infinite}
@keyframes breathe{50%{transform:scaleY(.96)}}
.cheer{animation:hop .6s ease-in-out infinite}.cheer g{transform-box:fill-box}
.cheer .ar{animation:clap .3s steps(1) infinite}
@keyframes hop{50%{transform:translateY(-3px)}}@keyframes clap{50%{transform:translateY(-1px)}}
.z{opacity:0;animation:zz 3s linear infinite}.z2{animation-delay:1s}.z3{animation-delay:2s}
@keyframes zz{0%{opacity:0;transform:translate(0,0)}25%{opacity:.9}100%{opacity:0;transform:translate(-5px,-12px)}}
.cf{transform-box:fill-box;transform-origin:center;animation:fall 1.8s linear infinite}
.cf1{animation-delay:-.4s}.cf2{animation-delay:-.9s}.cf3{animation-delay:-1.3s}
@keyframes fall{0%{transform:translateY(-4px) rotate(0);opacity:1}100%{transform:translateY(28px) rotate(300deg);opacity:0}}
.q{animation:blink 1.6s steps(1) infinite}
@media (prefers-reduced-motion: reduce){.run,.run g,.rest,.cheer,.cheer g,.z,.cf,.q{animation:none!important}.z{opacity:.7}}
</style>`

const COSTUMES: Record<string, (f: Fill, t: string, pose: Pose) => void> = {
  // Fable: astronaut in a glass dome; floats instead of walking, the antenna and the star blink.
  fable: (f, t, pose) => {
    crabBody(f, pose)
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2')
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)'); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff')
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t)
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star')
  },
  // Heavy: detective with a deerstalker; the magnifier sweeps and glints.
  heavy: (f, t, pose) => {
    crabBody(f, pose, -4, 'it')
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  // Careful: engineer in a hard hat; the wrench turns a bolt.
  careful: (f, t, pose) => {
    crabBody(f, pose)
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it')
  },
  // Medium: chef, the toque traced from DockCrab's Sprites.chefHat; tosses the omelette.
  medium: (f, t, pose) => {
    crabBody(f, pose, -4, 'pan')
    stamp(f, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: t, d: '#B45F43' })
    f(22, 8, 7, 2, '#4A4A48', 'pan'); f(26, 10, 1, 1, '#4A4A48', 'pan'); f(24, 7, 3, 1, '#F5B731', 'egg')
  },
  // Light: racer in a helmet; runs at double pace, the checkered flag flutters.
  light: (f, t, pose) => {
    crabBody(f, pose, -4)
    stamp(f, 6, 5, ['....rrrrrrrrrr....', '..rrrrrrwwrrrrrr..', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.kkkkkkkkkkkkkkkkr'], { r: t, w: '#F8F6F1', k: INK })
    f(25, 1, 1, 9, '#8E929A')
    stamp(f, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK }, 'flag')
  },
  // Explore: pirate scouting the code; the cutlass fences.
  explore: (f, _t, pose) => {
    crabBody(f, pose)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it')
  },
  other: (f, _t, pose) => crabBody(f, pose),
}

const MOTION: Record<CrewStatus, string> = {
  working: ' run',
  idle: ' rest',
  done: ' cheer',
  proposed: '',
  dismissed: '',
}

// What floats around the crab, in its own 30×28 grid: top left, the one corner no costume's prop takes.
const EXTRAS: Partial<Record<CrewStatus, string>> = {
  idle:
    `<text class="z" x="0" y="8" font-family="sans-serif" font-size="6" font-weight="700" fill="#9a9a96">z</text>` +
    `<text class="z z2" x="0" y="8" font-family="sans-serif" font-size="7" font-weight="700" fill="#9a9a96">z</text>` +
    `<text class="z z3" x="0" y="8" font-family="sans-serif" font-size="9" font-weight="700" fill="#9a9a96">Z</text>`,
  done: ['#D85A30', '#378ADD', '#F5C542', '#7F77DD'].map((c, i) => `<rect class="cf cf${i}" x="${2 + i * 8}" y="0" width="2" height="3" fill="${c}"/>`).join(''),
  proposed: `<text class="q" x="0" y="9" font-family="sans-serif" font-size="9" font-weight="700" fill="#BA7517">?</text>`,
}

export const CRAB_SCALE = 1.1

/**
 * One crab at (x, y) in `costume`, posed for `status`. Body and props nest
 * inside `bd` so a prop rides the bob and adds its own motion; legs stay
 * outside it and step on their own.
 */
export function crab(x: number, y: number, costume: string, status: CrewStatus, scale = CRAB_SCALE): string {
  const pose: Pose = {
    eyes: status === 'idle' ? 'closed' : status === 'done' ? 'happy' : 'open',
    isCheering: status === 'done',
  }
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  const draw = COSTUMES[costume] ?? COSTUMES.other
  draw?.(f, COSTUME_COLOR[costume] ?? '#888780', pose)
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`
  const dim = status === 'proposed' ? ' opacity="0.45"' : status === 'dismissed' ? ' opacity="0.3"' : ''
  return `<g transform="translate(${x},${y}) scale(${scale})" shape-rendering="crispEdges"><g${dim}><g class="c-${costume}${MOTION[status]}">${body}${group('la')}${group('lb')}</g></g>${EXTRAS[status] ?? ''}</g>`
}
