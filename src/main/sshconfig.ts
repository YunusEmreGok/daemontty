import fs from 'fs'
import os from 'os'
import path from 'path'
import { Host } from '@shared/types'
import { addHosts, addKey, allHosts, newId, publicView } from './vault'
import { buildKey } from './keys'

interface Block {
  alias: string
  opts: Record<string, string>
}

function parseConfig(text: string): Block[] {
  const blocks: Block[] = []
  let cur: Block | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(\S+?)\s*[=\s]\s*(.+)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].replace(/^"(.*)"$/, '$1')
    if (key === 'host') {
      // Joker karakterli bloklar (Host *) gerçek sunucu değildir.
      const alias = value.split(/\s+/).find((a) => !/[*?!]/.test(a))
      cur = alias ? { alias, opts: {} } : null
      if (cur) blocks.push(cur)
    } else if (key === 'match') {
      cur = null
    } else if (cur && !(key in cur.opts)) {
      cur.opts[key] = value
    }
  }
  return blocks
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

/** ~/.ssh/config dosyasındaki host'ları kasaya ekler. */
export function importSshConfig(): { added: number; skipped: number } {
  const file = path.join(os.homedir(), '.ssh', 'config')
  if (!fs.existsSync(file)) throw new Error('~/.ssh/config dosyası bulunamadı')
  const blocks = parseConfig(fs.readFileSync(file, 'utf8'))
  const existing = allHosts()
  const existingKeys = new Map(publicView().keys.map((k) => [k.fingerprint, k.id]))
  const byAlias = new Map<string, Host>()
  const added: Host[] = []
  let skipped = 0

  for (const b of blocks) {
    const address = b.opts.hostname || b.alias
    const port = Number(b.opts.port) || 22
    const username = b.opts.user
    if (existing.some((h) => h.address === address && h.port === port && (h.username || '') === (username || ''))) {
      skipped++
      continue
    }
    const host: Host = { id: newId(), label: b.alias, address, port, username, tags: ['ssh-config'] }

    if (b.opts.identityfile) {
      try {
        const keyPath = expandHome(b.opts.identityfile)
        const key = buildKey(path.basename(keyPath), fs.readFileSync(keyPath, 'utf8'))
        const known = existingKeys.get(key.fingerprint)
        if (known) host.keyId = known
        else {
          addKey(key)
          existingKeys.set(key.fingerprint, key.id)
          host.keyId = key.id
        }
      } catch {
        // Şifreli ya da okunamayan anahtar: kullanıcı sonra Keychain'den ekleyebilir.
      }
    }
    byAlias.set(b.alias, host)
    added.push(host)
  }

  // ProxyJump takma adlarını host kimliklerine çevir.
  for (const b of blocks) {
    const host = byAlias.get(b.alias)
    const jump = b.opts.proxyjump?.split(',')[0].trim()
    if (!host || !jump || jump === 'none') continue
    const jumpAlias = jump.replace(/^.*@/, '').replace(/:\d+$/, '')
    const target = byAlias.get(jumpAlias) ?? existing.find((h) => h.label === jumpAlias || h.address === jumpAlias)
    if (target) host.jumpHostId = target.id
  }

  if (added.length) addHosts(added)
  return { added: added.length, skipped }
}
