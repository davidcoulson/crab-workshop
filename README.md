# crab-workshop

Eleven Claude Code mods (function-hook plugins) built around one workflow: many parallel side
sessions, upstream PRs behind CodeRabbit, Codecov and Codex reviews, an Unraid server with about 90
containers, Home Assistant, and a local LLM on an RTX 3070. They are siblings of
[session-crew](../session-crew) and borrow its savvy-progress crabs.

The mod API is early access. These mods were built and tested against Claude Code 2.1.295 (the
desktop app's CLI); the declaration file that version ships is the authority.

| Mod | What you get | Commands |
| --- | --- | --- |
| **where-am-i** | Status line: `🍎 Mac · ha-unraid-management-agent · main · fork of tinkerologie`. A note for Claude when, on the Mac, it SSHes to the Unraid host or the container, or runs the tests of a repo that is developed in the container. | `/where` |
| **roll-call** | A pane where each side session's crab holds a sign: one line on where it stands, and a "needs you" lane (questions, approvals, boxes to tick). Lines come from Haiku, the local LLM, or the last message. | `/rollcall [open\|linked] [text]`, tool `report` |
| **fuel-gauge** | `⛽ ctx 14% · 5h 26% (34m) · wk 36%` in the status line; toasts at 80% and 95% of a plan window and at 85% context; a pane with extra usage and every running side session's context. A band appears only while something runs hot. | `/fuel [text]` |
| **gpu-crab** | While a `local-llm` tool runs: a crab on a treadmill above the prompt with the model, VRAM, GPU/CPU split (amber when it spills to CPU) and elapsed time; afterwards, a tally of what local models read today instead of the cloud. | `/gpu` |
| **vitals-strip** | Unraid and HA health above the prompt (array and pools, CPU and memory, unhealthy or missing containers, unread alerts, parity, HA repairs). Quiet by default: only what isn't green. | `/vitals [show\|quiet]` |
| **reef** | An aquarium pane: each container is a fish coloured by stack, unhealthy ones float belly-up, the GPU is a heater, HA is a lighthouse, side sessions are crabs on the sand. Hover a fish for its name. | `/reef [text]` |
| **keymaster** | Masks API keys, tokens, passwords and private keys in tool output before Claude, the transcript or the screen sees them (`‹masked arr-api-key 1a2b3c4d›`), with a toast and a count. Withholds output it can't scan. | `/keymaster`, `/keymaster allow <tag>` |
| **trailer-guard** | Refuses a `git commit`, `gh pr create/edit` or `git push` that would carry `Co-Authored-By: Claude` or the Claude Code footer into a repo whose remotes include tinkerologie, esphome or home-assistant (configurable). | `/trailers` |
| **gatekeeper** | A pane of your open PRs by lane: needs you (boxes only you tick, green drafts), needs work (red checks, Codecov, CodeRabbit threads, conflicts), waiting. A band when something needs you. | `/gates [text]`, tool `gates` |
| **codex-corner** | A boxing ring above the prompt for Codex adversarial reviews: each run is a round with findings by severity, until the verdict is approve and the bot goes down. Kept per repo and branch. | `/codex-card` |
| **house-rules** | Notes, asks and refusals on tool calls: appdata paths (`/mnt/user/appdata` vs the nvme8tb pool), `CLAUDE.local.md` in git, force-push to upstream, HA restarts. Add your own. | `/rules`, `/rules add …`, `/rules off <id>` |

## Data sources

Everything is read-only.

| Mod | Reads |
| --- | --- |
| roll-call, fuel-gauge, reef | The desktop app's session server (`ccd_session_mgmt`: `list_sessions`, `list_events`, `get_usage`) |
| vitals-strip | The HA-MCP connector: one `ha_eval_template` over the Unraid Management Agent integration's entities, and `ha_get_overview`. Allow both tools in permissions so auto mode doesn't review each read |
| reef | `unraid-mcp` (`system array/metrics`, `docker list`, `notification overview`, `array parity_status`) and the HA-MCP connector (`ha_get_overview`) |
| gpu-crab, reef | Ollama `GET /api/ps` at `10.2.6.50:11434` |
| gatekeeper | `gh api graphql`, one search query every 5 minutes and shortly after a push |
| where-am-i, trailer-guard, codex-corner | `git` in the session's checkout |

Server names, URLs and thresholds are options (`userConfig`) on each mod.

## Trying them

For one terminal session:

```bash
claude --plugin-dir ~/dev/crab-workshop/plugins/where-am-i --plugin-dir ~/dev/crab-workshop/plugins/fuel-gauge
```

For desktop-app sessions, add the folders to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`
(colon-separated, next to session-crew's), then start a new session:

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "/Users/david/dev/session-crew:/Users/david/dev/crab-workshop/plugins/where-am-i:/Users/david/dev/crab-workshop/plugins/keymaster"
}
```

Or install from this folder as a marketplace, so `/reload-plugins` picks up edits:

```bash
claude plugin marketplace add ~/dev/crab-workshop
```

Then, in a terminal session, `/plugin install keymaster@crab-workshop` (and so on). Sessions on the
UnRAID SSH connection run Claude Code inside the claude-code container, so the mods need the same
setup there.

## Developing

```bash
sh scripts/check.sh            # every mod: type-check, claude plugin validate, claude plugin test
sh scripts/check.sh gatekeeper # one mod
```

`shared/` holds the crab art (copied from savvy-progress through session-crew; see
THIRD_PARTY_NOTICES.md) and the drawing helpers. `scripts/sync-shared.sh` copies them into each mod's
`hooks/shared/`, because a mod can only import its own files. Edit `shared/`, never the copies.

## Known limits

- The desktop Code tab's drawing of `AbovePrompt` bands and `Svg` was checked with the test kit only,
  not by eye in the app.
- The Unraid Management Agent's own API (`:8043`) refused connections from the Mac, so vitals-strip and
  reef read through unraid-mcp instead.
- keymaster masks what looks like a secret. A real value that slips past its patterns is not caught,
  and a fake one in a test fixture is masked until you `/keymaster allow` its tag.
- gatekeeper reads the first 50 PRs of its search (newest first).
