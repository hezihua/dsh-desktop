import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { HarnessServer, resolveDshVersion } from './harness'
import { TITLEBAR_CSS, TITLEBAR_JS } from './titlebar-inject'
import { checkForUpdatesLater, setupAutoUpdater } from './updater'

type HarnessPhase = 'starting' | 'ready' | 'error'

let mainWindow: BrowserWindow | null = null
let harness: HarnessServer | null = null
let quitting = false
let lastError = ''
let harnessPhase: HarnessPhase = 'starting'
let harnessMessage = '正在启动 DeepSeek Harness…'

const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:\d+/

function sendToRenderer(channel: string, payload?: unknown) {
	if (!mainWindow || mainWindow.isDestroyed()) return
	mainWindow.webContents.send(channel, payload)
}

function publishStatus(phase: HarnessPhase, message: string) {
	harnessPhase = phase
	harnessMessage = message
	sendToRenderer('harness:status', { phase, message, url: harness?.url || undefined })
}

function loadSplash() {
	if (!mainWindow || mainWindow.isDestroyed()) return
	if (process.env.VITE_DEV_SERVER_URL) {
		void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
		return
	}
	void mainWindow.loadFile(join(__dirname, '../dist/index.html'))
}

function createWindow() {
	const win = new BrowserWindow({
		width: 1280,
		height: 840,
		minWidth: 960,
		minHeight: 640,
		show: false,
		frame: false,
		autoHideMenuBar: true,
		backgroundColor: '#10141a',
		title: 'DeepSeek Harness',
		webPreferences: {
			preload: join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
		},
	})
	mainWindow = win

	const sendMaximized = () => {
		if (win.isDestroyed()) return
		win.webContents.send('window:maximized', win.isMaximized())
	}
	win.on('maximize', sendMaximized)
	win.on('unmaximize', sendMaximized)

	win.webContents.on('did-finish-load', () => {
		const url = win.webContents.getURL()
		if (!LOOPBACK_ORIGIN.test(url)) return
		void win.webContents.insertCSS(TITLEBAR_CSS)
		void win.webContents.executeJavaScript(TITLEBAR_JS)
	})

	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:/.test(url)) void shell.openExternal(url)
		return { action: 'deny' }
	})

	win.webContents.on('will-navigate', (event, url) => {
		if (url.startsWith('file:') || LOOPBACK_ORIGIN.test(url)) return
		if (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) return
		event.preventDefault()
		if (/^https?:/.test(url)) void shell.openExternal(url)
	})

	win.once('ready-to-show', () => {
		win.show()
	})
	loadSplash()
	return win
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
						if (!app.isPackaged) {
							sendToRenderer('update:error', { message: '开发模式下不支持自动更新检查（请打包后测试）。' })
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

async function bootAndNavigate() {
	lastError = ''
	publishStatus('starting', '正在启动 DeepSeek Harness…')

	harness = new HarnessServer({
		appPath: app.getAppPath(),
		logDir: join(app.getPath('userData'), 'logs'),
		onUnexpectedExit: (code, signal) => {
			if (quitting) return
			const message = `Harness 意外退出（code ${String(code)}, signal ${String(signal)}）`
			lastError = message
			publishStatus('error', message)
			if (mainWindow && !mainWindow.isDestroyed() && LOOPBACK_ORIGIN.test(mainWindow.webContents.getURL())) {
				loadSplash()
			}
		},
	})

	const url = await harness.start()
	log.info(`Harness 已就绪：${url}`)
	publishStatus('ready', url)
	if (mainWindow && !mainWindow.isDestroyed()) {
		await mainWindow.loadURL(url)
	}
}

async function restartHarness() {
	try {
		lastError = ''
		if (mainWindow && !mainWindow.isDestroyed()) loadSplash()
		if (harness?.running) await harness.stop()
		await bootAndNavigate()
	} catch (error) {
		lastError = error instanceof Error ? error.message : String(error)
		publishStatus('error', lastError)
	}
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
	ipcMain.handle('desktop:quit', () => {
		app.quit()
		return { ok: true }
	})
	ipcMain.handle('window:minimize', () => {
		mainWindow?.minimize()
	})
	ipcMain.handle('window:maximize', () => {
		if (!mainWindow || mainWindow.isDestroyed()) return
		if (mainWindow.isMaximized()) mainWindow.unmaximize()
		else mainWindow.maximize()
	})
	ipcMain.handle('window:close', () => {
		mainWindow?.close()
	})
	ipcMain.handle('window:is-maximized', () => {
		return mainWindow?.isMaximized() ?? false
	})
}

if (!app.requestSingleInstanceLock()) {
	app.quit()
} else {
	app.on('second-instance', () => {
		if (!mainWindow || mainWindow.isDestroyed()) return
		if (mainWindow.isMinimized()) mainWindow.restore()
		mainWindow.show()
		mainWindow.focus()
	})

	app.on('before-quit', () => {
		quitting = true
	})

	app.on('window-all-closed', () => {
		app.quit()
	})

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0 && harness?.url) {
			createWindow()
			void mainWindow?.loadURL(harness.url)
		}
	})

	app.on('will-quit', (event) => {
		if (harness?.running) {
			event.preventDefault()
			harness.stop().finally(() => {
				app.exit(0)
			})
		}
	})

	app.whenReady().then(async () => {
		setupAutoUpdater(() => mainWindow)
		registerIpc()
		installMenu()
		createWindow()
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
