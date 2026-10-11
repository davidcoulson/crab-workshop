import { describe, expect, test } from 'claude-code/testing'

import { findSecrets, redact, redactDeep, riskyCommand, tag } from '../hooks/scan'

const kinds = (t: string) => findSecrets(t).map(h => h.kind)
const none = new Set<string>()

describe('detects', () => {
  test('the leaks seen in your sessions', () => {
    // Arr config.xml and env-style keys (the Prismarr leak), with made-up values.
    expect(kinds('<Config><ApiKey>0123456789abcdef0123456789abcdef</ApiKey></Config>')).toEqual(['arr-api-key'])
    expect(kinds('RADARR_API_KEY=0123456789abcdef0123456789abcdef')).toEqual(['assigned-secret'])
    expect(kinds('"apikey": "fedcba9876543210fedcba9876543210"')).toEqual(['assigned-secret'])
    expect(kinds('http://10.2.6.88:7878/api/v3/movie?apikey=0123456789abcdef0123456789abcdef&x=1')).toEqual(['assigned-secret'])
    // An HA long-lived token is a JWT.
    expect(kinds('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhYmMxMjM0NTYifQ.c2lnbmF0dXJlLXZhbHVlLWhlcmU')).toEqual(['jwt'])
    // ESPHome api encryption key and OTA password.
    expect(kinds('api:\n  encryption:\n    key: "aGVsbG8td29ybGQtdGhpcy1pcy1hLXRlc3Qta2V5LTEyMz0="\nota:\n  password: "hunter2hunter2"')).toEqual(['esphome-key', 'assigned-secret'])
    expect(kinds('mqtt://homeassistant:s3cretpass@10.2.3.6:1883')).toEqual(['url-password'])
    expect(kinds('token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB')).toEqual(['github-token'])
    expect(kinds('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----')).toEqual(['private-key'])
  })
  test('leaves ordinary output alone', () => {
    expect(kinds('commit 2d22a27f3b9c1e0d4a5b6c7d8e9f0a1b2c3d4e5f')).toEqual([])
    expect(kinds('9c36d29fa676db6bc934fdb5660d1727e91e2b024556f4ca452e9d2fc8c85584')).toEqual([])
    expect(kinds('"max_tokens": 200000, "password_file": "/run/secrets/db", token: ${HA_TOKEN}')).toEqual([])
    expect(kinds('password: !secret wifi_password')).toEqual([])
    expect(kinds('api_key: <your key here>  token = ********')).toEqual([])
    expect(kinds('Image: sha256:9a0433d5407702c36995ae2eebd5d227cd70eb5535ae8e9d9d86edb091fe16e5')).toEqual([])
    expect(kinds('the token: required')).toEqual([])
  })
})

describe('redacts', () => {
  test('in place, keeping the words around it', () => {
    const r = redact('RADARR_API_KEY=0123456789abcdef0123456789abcdef\nPORT=7878', tag, none)
    expect(r.text).toBe(`RADARR_API_KEY=‹masked assigned-secret ${tag('0123456789abcdef0123456789abcdef')}›\nPORT=7878`)
    expect(redact(r.text, tag, none).hits).toEqual([])
  })
  test('deep in a tool result, with where', () => {
    const out = redactDeep({ stdout: 'ok', stderr: '', content: [{ type: 'text', text: 'X-Plex-Token=abcdEFGH1234ijkl' }] }, tag, none)
    expect(out.hits.map(h => [h.kind, h.where])).toEqual([['assigned-secret', 'content.0.text']])
    expect(JSON.stringify(out.value)).not.toContain('abcdEFGH1234ijkl')
  })
  test('allowed tags pass', () => {
    const v = 'secret=notreallyasecret1'
    expect(redact(v, tag, new Set([tag('notreallyasecret1')])).text).toBe(v)
  })
  test('risky commands get a hint', () => {
    expect(riskyCommand('docker inspect radarr')).toContain('--format')
    expect(riskyCommand("docker inspect -f '{{.State.Health.Status}}' radarr")).toBe(null)
    expect(riskyCommand('cat /mnt/user/appdata/radarr/config.xml')).toContain('ApiKey')
    expect(riskyCommand('printenv | sort')).toContain('variable')
    expect(riskyCommand('ls -la')).toBe(null)
  })
})
