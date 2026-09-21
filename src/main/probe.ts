import { ipcMain } from 'electron'
import net from 'net'
import { HostProbe } from '@shared/types'
import { allHosts, listKnownHosts, removeKnownHost } from './vault'

/** SSH portuna TCP bağlantısı açılabiliyor mu? (kimlik doğrulama yapılmaz) */
function probeOne(address: string, port: number, timeout = 3000): Promise<{ online: boolean; ms?: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const sock = net.connect({ host: address, port })
    const done = (online: boolean): void => {
      sock.destroy()
      resolve(online ? { online, ms: Date.now() - t0 } : { online })
    }
    sock.setTimeout(timeout, () => done(false))
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })
}

async function probe(ids: string[]): Promise<HostProbe[]> {
  const hosts = allHosts().filter((h) => ids.includes(h.id))
  return Promise.all(
    hosts.map(async (h) => {
      // Jump host arkasındaki sunuculara doğrudan erişilemeyebilir; yanlış "kapalı" göstermeyelim.
      if (h.jumpHostId) return { id: h.id, online: null }
      return { id: h.id, ...(await probeOne(h.address, h.port || 22)) }
    })
  )
}

export function registerProbeIpc(): void {
  ipcMain.handle('hosts:probe', (_e, ids: string[]) => probe(ids))
  ipcMain.handle('knownHosts:list', () => listKnownHosts())
  ipcMain.handle('knownHosts:remove', (_e, hostPort: string) => removeKnownHost(hostPort))
}
