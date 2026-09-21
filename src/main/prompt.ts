import { BrowserWindow, ipcMain } from 'electron'
import { PromptField, PromptRequest } from '@shared/types'
import { newId } from './vault'

const pending = new Map<string, (values: string[] | null) => void>()

ipcMain.on('prompt:respond', (_e, id: string, values: string[] | null) => {
  const resolve = pending.get(id)
  if (resolve) {
    pending.delete(id)
    resolve(values)
  }
})

/** Arayüzde bir form açar; kullanıcı iptal ederse null döner. */
export function askUser(title: string, fields: PromptField[], message?: string): Promise<string[] | null> {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return Promise.resolve(null)
  const req: PromptRequest = { id: newId(), title, message, fields }
  return new Promise((resolve) => {
    pending.set(req.id, resolve)
    win.webContents.send('prompt:request', req)
  })
}
