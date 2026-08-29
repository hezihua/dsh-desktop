import { app, Menu, ipcMain, shell as electronShell } from 'electron'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { HarnessServer, readLogTail, resolveDshVersion } from './harness'
import { checkForUpdatesLater, setupAutoUpdater } from './updater'
import { createAppTray } from './tray'
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
let bootMode: 'normal' | 'safe' = 'normal'

function defaultDshHome(): string {
	return process.env.DSH_HOME ?? join(app.getPath('home'), '.dsh')
}

function activeDshHome(): string {
	if (bootMode === 'safe') return join(app.getPath('userData'), 'harness-safe')
	return defaultDshHome()
}

function logPath(): string {
	return harness?.logPath || join(app.getPath('userData'), 'logs', 'dsh-web.log')
}

function publishStatus(phase: 'starting' | 'ready' | 'error', message: string) {
	harnessPhase = phase
	harnessMessage = message
	const win = shell.window
	if (!win || win.isDestroyed()) return
	win.webContents.send('harness:status', {
		phase,
		message,
		url: harness?.url || undefined,
		logPath: logPath(),
		logTail: phase === 'error' ? readLogTail(logPath()) : '',
		safeMode: bootMode === 'safe',
	})
}

async function bootAndNavigate() {
	if (booting) return
	booting = true
	lastError = ''
	publishStatus(
		'starting',
		bootMode === 'safe' ? '正在以安全模式启动 DeepSeek Harness…' : '正在启动 DeepSeek Harness…',
	)
	shell.hideHarness()

	try {
		if (harness) await harness.stop()
		harness = new HarnessServer({
			appPath: app.getAppPath(),
			logDir: join(app.getPath('userData'), 'logs'),
			packaged: app.isPackaged,
			attach: bootMode === 'normal',
			dshHome: activeDshHome(),
			onUnexpectedExit: (code, signal) => {
				if (quitting) return
				void recoverHarness(code, signal)
			},
		})
		const url = await harness.startWithRetry()
		crashRestarts = 0
		log.info(`Harness 已就绪：${url}${harness.owned ? '' : '（附着）'}${bootMode === 'safe' ? '（安全模式）' : ''}`)
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

async function restartHarness(mode: 'normal' | 'safe' = 'normal') {
	try {
		bootMode = mode
		crashRestarts = 0
		lastError = ''
		publishStatus(
			'starting',
			mode === 'safe' ? '正在以安全模式启动 DeepSeek Harness…' : '正在重新启动 DeepSeek Harness…',
		)
		if (harness?.owned) await harness.stop()
		await bootAndNavigate()
	} catch (error) {
		lastError = error instanceof Error ? error.message : String(error)
		publishStatus('error', lastError)
	}
}

function requestQuit() {
	quitting = true
	shell.hideOnClose = false
	app.quit()
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
						void restartHarness('normal')
					},
				},
				{
					label: '安全模式启动',
					click: () => {
						void restartHarness('safe')
					},
				},
				{
					label: '打开日志',
					click: () => {
						void electronShell.openPath(logPath())
					},
				},
				{ type: 'separator' },
				{
					label: '退出',
					click: () => requestQuit(),
				},
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
		logPath: logPath(),
		logTail: harnessPhase === 'error' ? readLogTail(logPath()) : '',
		dshHome: activeDshHome(),
		safeMode: bootMode === 'safe',
	}))
	ipcMain.handle('desktop:restart-harness', async () => {
		await restartHarness('normal')
		return { ok: true }
	})
	ipcMain.handle('desktop:restart-safe', async () => {
		await restartHarness('safe')
		return { ok: true }
	})
	ipcMain.handle('desktop:open-log', async () => {
		const path = logPath()
		const result = await electronShell.openPath(path)
		return { ok: result === '', path }
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
		shell.show()
	})

	app.on('before-quit', () => {
		quitting = true
		shell.hideOnClose = false
	})

	app.on('window-all-closed', () => {
		if (shell.hideOnClose) return
		app.quit()
	})

	app.on('activate', () => {
		if (!shell.window) {
			shell.create()
			if (harness?.url) shell.showHarness(harness.url)
			return
		}
		shell.show()
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
		const tray = createAppTray({
			show: () => shell.show(),
			restart: () => {
				void restartHarness(bootMode)
			},
			quit: () => requestQuit(),
		})
		shell.hideOnClose = tray !== null
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
