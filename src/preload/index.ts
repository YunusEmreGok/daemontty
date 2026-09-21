import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
import type { Api } from '@shared/types'

function on<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const invoke = ipcRenderer.invoke.bind(ipcRenderer)
const send = ipcRenderer.send.bind(ipcRenderer)

const api: Api = {
  platform: process.platform,
  update: {
    version: () => invoke('update:version'),
    state: () => invoke('update:state'),
    check: () => send('update:check'),
    download: () => send('update:download'),
    install: () => send('update:install'),
    onState: (cb) => on('update:state', cb)
  },
  vault: {
    get: () => invoke('vault:get'),
    upsert: (collection, item) => invoke('vault:upsert', collection, item),
    remove: (collection, id) => invoke('vault:remove', collection, id),
    saveSettings: (s) => invoke('vault:settings', s),
    onChange: (cb) => on('vault:changed', cb)
  },
  keys: {
    generate: (name, type, bits, passphrase) => invoke('keys:generate', name, type, bits, passphrase),
    importText: (name, key, passphrase) => invoke('keys:importText', name, key, passphrase),
    pickFile: () => invoke('keys:pickFile'),
    rename: (id, name) => invoke('keys:rename', id, name),
    remove: (id) => invoke('keys:remove', id),
    exportPrivate: (id) => invoke('keys:exportPrivate', id)
  },
  ssh: {
    open: (id, hostId, cols, rows) => invoke('ssh:open', id, hostId, cols, rows),
    write: (id, data) => send('ssh:write', id, data),
    resize: (id, cols, rows) => send('ssh:resize', id, cols, rows),
    close: (id) => send('ssh:close', id),
    onData: (cb) => on('ssh:data', cb),
    onEvent: (cb) => on('ssh:event', cb),
    listDir: (id, dir) => invoke('ssh:listDir', id, dir),
    stats: (id) => invoke('ssh:stats', id)
  },
  hosts: {
    probe: (ids) => invoke('hosts:probe', ids)
  },
  knownHosts: {
    list: () => invoke('knownHosts:list'),
    remove: (hp) => invoke('knownHosts:remove', hp)
  },
  backup: {
    export: (password) => invoke('backup:export', password),
    pickFile: () => invoke('backup:pickFile'),
    inspect: (file, password) => invoke('backup:inspect', file, password),
    import: (file, password, mode) => invoke('backup:import', file, password, mode)
  },
  history: {
    get: (hostId) => invoke('history:get', hostId),
    add: (hostId, cmd) => send('history:add', hostId, cmd),
    clear: () => invoke('history:clear'),
    count: () => invoke('history:count')
  },
  sftp: {
    open: (id, hostId) => invoke('sftp:open', id, hostId),
    close: (id) => send('sftp:close', id),
    list: (id, p) => invoke('sftp:list', id, p),
    mkdir: (id, p) => invoke('sftp:mkdir', id, p),
    rename: (id, a, b) => invoke('sftp:rename', id, a, b),
    remove: (id, p, isDir) => invoke('sftp:remove', id, p, isDir),
    download: (id, paths, dir) => invoke('sftp:download', id, paths, dir),
    upload: (id, paths, dir) => invoke('sftp:upload', id, paths, dir),
    copy: (fromId, paths, toId, dir) => invoke('sftp:copy', fromId, paths, toId, dir),
    onProgress: (cb) => on('sftp:progress', cb)
  },
  local: {
    home: () => invoke('local:home'),
    list: (p) => invoke('local:list', p),
    mkdir: (p) => invoke('local:mkdir', p),
    rename: (a, b) => invoke('local:rename', a, b),
    remove: (p) => invoke('local:remove', p),
    copy: (paths, dir) => invoke('local:copy', paths, dir),
    reveal: (p) => send('local:reveal', p),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  forwards: {
    start: (id) => invoke('forward:start', id),
    stop: (id) => invoke('forward:stop', id),
    statuses: () => invoke('forward:statuses'),
    onStatus: (cb) => on('forward:status', cb)
  },
  prompt: {
    onRequest: (cb) => on('prompt:request', cb),
    respond: (id, values) => send('prompt:respond', id, values)
  },
  importSshConfig: () => invoke('sshconfig:import')
}

contextBridge.exposeInMainWorld('api', api)
