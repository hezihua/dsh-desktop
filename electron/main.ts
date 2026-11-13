import { app, Menu, ipcMain, shell as electronShell } from 'electron'
import type { DialogSlot } from './window'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import {
	defaultAgentId,
	ensureAgentsPanelPatch,
	loadAgentCatalog,
	readActiveAgentId,
	resolveAgentLaunch,
	resolveAgentsRoot,
	writeActiveAgentId,
	type AgentLaunch,
	type DesktopAgent,
} from './agents'
import { HarnessServer, readLogTail, resolveDshVersion } from './harness'
import { checkForUpdatesLater, setupAutoUpdater } from './updater'
import { createAppTray } from './tray'
import { ensureFixbugServer, isFixbugOwned, stopFixbugServer } from './fixbug-server'
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
let bootGeneration = 0
let activeAgentId = ''
let activeLaunch: AgentLaunch | null = null

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

function agentsRoot(): string {
	return resolveAgentsRoot(app.getAppPath(), app.isPackaged)
}

function agentStorePath(): string {
	return join(app.getPath('userData'), 'active-agent.json')
}

function agentCatalog(): DesktopAgent[] {
	try {
		return loadAgentCatalog(agentsRoot()).map((item) => item.summary)
	} catch (error) {
		log.error('读取智能体注册表失败', error)
		return []
	}
}

function rememberAgent(agentId: string): void {
	activeAgentId = agentId
	try {
		writeActiveAgentId(agentStorePath(), agentId)
	} catch (error) {
		log.warn('保存当前智能体失败', error)
	}
}

function currentLaunch(): AgentLaunch {
	const root = agentsRoot()
	const fallback = (() => {
		try {
			return defaultAgentId(root)
		} catch {
			return 'infini-bugfix'
		}
	})()
	if (!activeAgentId) activeAgentId = readActiveAgentId(agentStorePath(), fallback)
	const extras =
		bootMode === 'safe'
			? []
			: [ensureAgentsPanelPatch(root, join(app.getPath('userData'), 'agents-panel.patch.yml'))]
	const launch = resolveAgentLaunch(root, activeAgentId, bootMode === 'safe', process.env, extras)
	if (launch.agent.id !== activeAgentId) rememberAgent(launch.agent.id)
	return launch
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
		agent: activeLaunch?.agent,
	})
}

async function bootAndNavigate() {
	const generation = ++bootGeneration
	booting = true
	lastError = ''
	const launch = currentLaunch()
	activeLaunch = launch
	const startingMessage =
		bootMode === 'safe'
			? '正在以安全模式启动 DeepSeek Harness…'
			: `正在启动${launch.agent.label}…`
	publishStatus('starting', startingMessage)
	shell.setTitle(launch.agent.label)
	shell.hideHarness()

	try {
		if (harness) await harness.stop()
		if (generation !== bootGeneration) return
		harness = new HarnessServer({
			appPath: app.getAppPath(),
			logDir: join(app.getPath('userData'), 'logs'),
			packaged: app.isPackaged,
			attach: launch.attach && bootMode === 'normal',
			dshHome: activeDshHome(),
			profile: launch.profile,
			patches: launch.patches,
			logFileName: launch.logFileName,
			onUnexpectedExit: (code, signal) => {
				if (quitting || generation !== bootGeneration) return
				void recoverHarness(code, signal)
			},
		})
		const url = await harness.startWithRetry()
		if (generation !== bootGeneration) {
			if (harness.owned) await harness.stop()
			return
		}
		let appUrl = launch.agent.appUrl
		const localFixbug =
			bootMode !== 'safe' &&
			launch.agent.id === 'infini-bugfix' &&
			(!appUrl || appUrl.startsWith('http://127.0.0.1:3000'))
		if (localFixbug) {
			publishStatus('starting', '正在启动运维页面…')
			appUrl = await ensureFixbugServer(app.getAppPath(), app.getPath('userData'), app.isPackaged, {
				dshHome: activeDshHome(),
				profile: launch.profile,
			})
			activeLaunch = { ...launch, agent: { ...launch.agent, appUrl } }
		}
		if (generation !== bootGeneration) return
		crashRestarts = 0
		log.info(
			`Harness 已就绪：${launch.agent.id} ${url}${harness.owned ? '' : '（附着）'}${bootMode === 'safe' ? '（安全模式）' : ''}`,
		)
		publishStatus('ready', url)
		shell.showHarness(url, { uiShell: launch.agent.uiShell, appUrl: appUrl })
	} catch (error) {
		if (generation !== bootGeneration) return
		throw error
	} finally {
		if (generation === bootGeneration) booting = false
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

function readDialogSlot(slot: unknown): DialogSlot | null {
	if (!slot || typeof slot !== 'object') return null
	const raw = slot as Record<string, unknown>
	const x = raw.x
	const y = raw.y
	const width = raw.width
	const height = raw.height
	if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
		return null
	}
	return { x, y, width, height, official: raw.official === true, modal: raw.modal === true }
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

async function activateAgent(agentId: unknown): Promise<{ ok: boolean; message?: string }> {
	if (typeof agentId !== 'string' || !agentId.trim()) {
		return { ok: false, message: '缺少智能体 id' }
	}
	const next = agentCatalog().find((item) => item.id === agentId)
	if (!next) return { ok: false, message: `未知智能体：${agentId}` }
	if (!next.available) return { ok: false, message: next.unavailableReason || '智能体不可用' }
	if (next.id === activeAgentId && bootMode === 'normal' && harnessPhase === 'ready') {
		return { ok: true }
	}
	try {
		rememberAgent(next.id)
		bootMode = 'normal'
		crashRestarts = 0
		lastError = ''
		await bootAndNavigate()
		return { ok: true }
	} catch (error) {
		lastError = error instanceof Error ? error.message : String(error)
		publishStatus('error', lastError)
		return { ok: false, message: lastError }
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
		logPath: logPath(),
		logTail: harnessPhase === 'error' ? readLogTail(logPath()) : '',
		dshHome: activeDshHome(),
		safeMode: bootMode === 'safe',
		agents: agentCatalog(),
		agent: activeLaunch?.agent ?? null,
	}))
	ipcMain.handle('desktop:agent-catalog', () => ({
		activeId: activeAgentId,
		agents: agentCatalog().map((agent) => ({
			id: agent.id,
			label: agent.label,
			description: agent.description,
			available: agent.available,
			unavailableReason: agent.unavailableReason,
		})),
	}))
	ipcMain.handle('desktop:select-agent', async (_event, agentId: unknown) => {
		return activateAgent(agentId)
	})
	ipcMain.handle('desktop:show-agent', async (event, agentId: unknown) => {
		if (event.sender !== shell.harnessContents) return { ok: false, message: '只能从官方页面打开智能体' }
		const result = await activateAgent(agentId)
		if (result.ok) shell.setAgentSurface(true)
		return result
	})
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
	ipcMain.on('desktop:dialog-slot', (event, slot: unknown) => {
		if (event.sender !== shell.harnessContents) return
		shell.setDialogSlot(readDialogSlot(slot))
	})
	ipcMain.on('desktop:conversation', (event) => {
		if (event.sender !== shell.harnessContents) return
		shell.setAgentSurface(false)
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
			if (harness?.url && activeLaunch) {
				shell.showHarness(harness.url, {
					uiShell: activeLaunch.agent.uiShell,
					appUrl: activeLaunch.agent.appUrl,
				})
			}
			return
		}
		shell.show()
	})

	app.on('will-quit', (event) => {
		const jobs: Promise<void>[] = []
		if (harness?.owned && harness.running) jobs.push(harness.stop())
		if (isFixbugOwned()) jobs.push(stopFixbugServer())
		if (jobs.length === 0) return
		event.preventDefault()
		Promise.all(jobs).finally(() => {
			app.exit(0)
		})
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
