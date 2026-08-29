import { app, type BrowserWindow, dialog, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

const UPDATE_SERVER_URL =
	process.env.UPDATE_SERVER_URL?.trim() || 'http://localhost:8080/updates/'

function isHarnessUrl(url: string): boolean {
	return /^http:\/\/127\.0\.0\.1:\d+/.test(url)
}

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

	const notifyOrDialog = async (
		channel: string,
		payload: unknown,
		dialogOptions?: Electron.MessageBoxOptions,
	) => {
		const win = getWindow()
		if (win && !win.isDestroyed() && isHarnessUrl(win.webContents.getURL()) && dialogOptions) {
			await dialog.showMessageBox(win, dialogOptions)
			return
		}
		send(channel, payload)
	}

	autoUpdater.on('checking-for-update', () => {
		send('update:checking')
	})
	autoUpdater.on('update-available', (info) => {
		void notifyOrDialog(
			'update:available',
			{
				version: info.version,
				releaseName: info.releaseName,
				releaseNotes: info.releaseNotes,
			},
			{
				type: 'info',
				title: '发现新版本',
				message: `发现新版本 ${info.version}，可在启动页或菜单中下载安装。`,
			},
		)
	})
	autoUpdater.on('update-not-available', () => {
		send('update:not-available')
	})
	autoUpdater.on('error', (err) => {
		void notifyOrDialog(
			'update:error',
			{ message: err?.message ?? String(err) },
			{
				type: 'error',
				title: '更新失败',
				message: err?.message ?? String(err),
			},
		)
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
		const win = getWindow()
		if (win && !win.isDestroyed() && isHarnessUrl(win.webContents.getURL())) {
			void dialog
				.showMessageBox(win, {
					type: 'info',
					title: '更新已下载',
					message: `新版本 ${info.version} 已下载完成，是否立即重启安装？`,
					buttons: ['立即安装', '稍后'],
					defaultId: 0,
					cancelId: 1,
				})
				.then(({ response }) => {
					if (response === 0) autoUpdater.quitAndInstall(false, true)
				})
			return
		}
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
