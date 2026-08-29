import { app, Menu, ipcMain } from 'electron'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { HarnessServer, resolveDshVersion } from './harness'
import { checkForUpdatesLater, setupAutoUpdater } from './updater'
import { DesktopShell } from './window'

const CRASH_RESTARTS = 3

const shell = new DesktopShell()
let harness: HarnessServer | null = null
let quitting = false
let lastError = ''
let harnessPhase: 'starting' | 'ready' | 'error' = 'starting'
let harnessMessage = '正在启动 DeepSeek Harness…'
let crashRestarts = 0
let booting = false

function publishStatus(phase: 'starting' | 'ready' | 'error', message: string) {
	harnessPhase = phase
	harnessMessage = message
	const win = shell.window
	if (!win || win.isDestroyed()) return
	win.webContents.send('harness:status', { phase, message, url: harness?.url || undefined })
}

async function bootAndNavigate() {
	if (booting) return
	booting = true
	lastError = ''
	publishStatus('starting', '正在启动 DeepSeek Harness…')
	shell.hideHarness()

	try {
		if (harness) await harness.stop()
		harness = new HarnessServer({
			appPath: app.getAppPath(),
			logDir: join(app.getPath('userData'), 'logs'),
			onUnexpectedExit: (code, signal) => {
				if (quitting) return
				void recoverHarness(code, signal)
			},
		})
		const url = await harness.startWithRetry()
		crashRestarts = 0
		log.info(`Harness 已就绪：${url}${harness.owned ? '' : '（附着）'}`)
		publishStatus('ready', url)
		shell.showHarness(url)
	} finally {
		booting = false
	}
}

async function recoverHarness(code: number | null, signal: NodeJS.Signals | null) {
	if (quitting || booting) return
	shell.hideHarness()
	crashRestarts += 1
	if (crashRestarts > CRASH_RESTARTS) {
		const message = `Harness 多次退出（code ${String(code)}, signal ${String(signal)}）`
		lastError = message
		publishStatus('error', message)
		return
	}
	publishStatus('starting', `引擎退出，正在第 ${crashRestarts} 次拉起…`)
	try {
		await bootAndNavigate()
	} catch (error) {
		lastError = error instanceof Error ? error.message : String(error)
		publishStatus('error', lastError)
	}
}

async function restartHarness() {
	try {
		crashRestarts = 0
		lastError = ''
		publishStatus('starting', '正在重新启动 DeepSeek Harness…')
		if (harness?.owned) await harness.stop()
		await bootAndNavigate()
	} catch (error) {
		lastError = error instanceof Error ? error.message : String(error)
		publishStatus('error', lastError)
	}
}

function installMenu() {
	const isMac = process.platform === 'darwin'
	const template: Electron.MenuItemConstructorOptions[] = [
		...(isMac ? [{ role: 'appMenu' as const }] : []),
		{
			label: '应用',
			submenu: [
				{
					label: '检查更新',
					click: () => {
						const win = shell.window
						if (!app.isPackaged) {
							win?.webContents.send('update:error', {
								message: '开发模式下不支持自动更新检查（请打包后测试）。',
							})
							return
						}
						void autoUpdater.checkForUpdates()
					},
				},
				{
					label: '重启 Harness',
					click: () => {
						void restartHarness()
					},
				},
				{ type: 'separator' },
				isMac ? { role: 'close' } : { role: 'quit' },
			],
		},
		{ role: 'editMenu' },
		{ role: 'viewMenu' },
		{ role: 'windowMenu' },
	]
	Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc() {
	ipcMain.handle('desktop:get-info', () => ({
		appVersion: app.getVersion(),
		dshVersion: resolveDshVersion(app.getAppPath()),
		url: harness?.url || null,
		error: lastError,
		phase: harnessPhase,
		message: harnessMessage,
		logPath: harness?.logPath || join(app.getPath('userData'), 'logs', 'dsh-web.log'),
		dshHome: process.env.DSH_HOME ?? join(app.getPath('home'), '.dsh'),
	}))
	ipcMain.handle('desktop:restart-harness', async () => {
		await restartHarness()
		return { ok: true }
	})
	ipcMain.handle('desktop:set-overlay', (_event, visible: boolean) => {
		shell.setOverlay(Boolean(visible))
	})
	ipcMain.handle('window:minimize', () => {
		shell.window?.minimize()
	})
	ipcMain.handle('window:maximize', () => {
		const win = shell.window
		if (!win || win.isDestroyed()) return
		if (win.isMaximized()) win.unmaximize()
		else win.maximize()
	})
	ipcMain.handle('window:close', () => {
		shell.window?.close()
	})
	ipcMain.handle('window:is-maximized', () => {
		return shell.window?.isMaximized() ?? false
	})
}

if (!app.requestSingleInstanceLock()) {
	app.quit()
} else {
	app.on('second-instance', () => {
		const win = shell.window
		if (!win || win.isDestroyed()) return
		if (win.isMinimized()) win.restore()
		win.show()
		win.focus()
	})

	app.on('before-quit', () => {
		quitting = true
	})

	app.on('window-all-closed', () => {
		app.quit()
	})

	app.on('activate', () => {
		if (!shell.window && harness?.url) {
			shell.create()
			shell.showHarness(harness.url)
		}
	})

	app.on('will-quit', (event) => {
		if (harness?.owned && harness.running) {
			event.preventDefault()
			harness.stop().finally(() => {
				app.exit(0)
			})
		}
	})

	app.whenReady().then(async () => {
		setupAutoUpdater(() => shell.window)
		registerIpc()
		installMenu()
		shell.create()
		log.info(`dsh-desktop ${app.getVersion()} 启动，嵌入 @deepseek-ai/dsh ${resolveDshVersion(app.getAppPath())}`)

		try {
			await bootAndNavigate()
			checkForUpdatesLater()
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error)
			log.error('启动 Harness 失败', error)
			publishStatus('error', lastError)
		}
	})
}
