import { app, type BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

const UPDATE_SERVER_URL =
	process.env.UPDATE_SERVER_URL?.trim() || 'http://localhost:8080/updates/'

export function setupAutoUpdater(getWindow: () => BrowserWindow | null): void {
	log.transports.file.level = 'info'
	autoUpdater.logger = log
	autoUpdater.setFeedURL({
		provider: 'generic',
		url: UPDATE_SERVER_URL,
	})
	autoUpdater.autoDownload = false

	const send = (channel: string, payload?: unknown) => {
		const win = getWindow()
		if (!win || win.isDestroyed()) return
		win.webContents.send(channel, payload)
	}

	autoUpdater.on('checking-for-update', () => {
		send('update:checking')
	})
	autoUpdater.on('update-available', (info) => {
		send('update:available', {
			version: info.version,
			releaseName: info.releaseName,
			releaseNotes: info.releaseNotes,
		})
	})
	autoUpdater.on('update-not-available', () => {
		send('update:not-available')
	})
	autoUpdater.on('error', (err) => {
		send('update:error', { message: err?.message ?? String(err) })
	})
	autoUpdater.on('download-progress', (progress) => {
		send('update:download-progress', {
			percent: progress.percent,
			transferred: progress.transferred,
			total: progress.total,
			bytesPerSecond: progress.bytesPerSecond,
		})
	})
	autoUpdater.on('update-downloaded', (info) => {
		send('update:downloaded', { version: info.version })
	})

	ipcMain.handle('update:check', async () => {
		if (!app.isPackaged) {
			return { ok: false, reason: 'DEV_MODE' }
		}
		const result = await autoUpdater.checkForUpdates()
		return { ok: true, updateInfo: result?.updateInfo ?? null }
	})

	ipcMain.handle('update:download', async () => {
		if (!app.isPackaged) {
			return { ok: false, reason: 'DEV_MODE' }
		}
		await autoUpdater.downloadUpdate()
		return { ok: true }
	})

	ipcMain.handle('update:install', async () => {
		if (!app.isPackaged) {
			return { ok: false, reason: 'DEV_MODE' }
		}
		autoUpdater.quitAndInstall(false, true)
		return { ok: true }
	})
}

export function checkForUpdatesLater(): void {
	if (!app.isPackaged) return
	setTimeout(() => {
		autoUpdater.checkForUpdates().catch((err) => {
			log.error('checkForUpdates failed', err)
		})
	}, 1500)
}
