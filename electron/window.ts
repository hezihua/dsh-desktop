import { BrowserWindow, WebContentsView, shell } from 'electron'
import { join } from 'node:path'
import type { AgentUiShell } from './agents'
import { TITLEBAR_HEIGHT } from '../shared/shell-layout'

export { TITLEBAR_HEIGHT }

const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:\d+/

export type ContentLayout = {
	uiShell: AgentUiShell
	appUrl: string | null
}

export type DialogSlot = {
	x: number
	y: number
	width: number
	height: number
	official: boolean
	modal: boolean
}

export class DesktopShell {
	window: BrowserWindow | null = null
	private view: WebContentsView | null = null
	private appView: WebContentsView | null = null
	private harnessUrl: string | null = null
	private appUrl: string | null = null
	private uiShell: AgentUiShell = 'harness'
	private overlay = false
	private dialogSlot: DialogSlot | null = null
	/** 只有点了智能体才盖住对话框；New Session 会关掉它 */
	private agentSurface = false

	hideOnClose = false

	create(): BrowserWindow {
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
		this.window = win

		const sendMaximized = () => {
			if (win.isDestroyed()) return
			win.webContents.send('window:maximized', win.isMaximized())
		}
		win.on('maximize', sendMaximized)
		win.on('unmaximize', sendMaximized)
		win.on('resize', () => this.layout())

		win.webContents.setWindowOpenHandler(({ url }) => {
			if (/^https?:/.test(url)) void shell.openExternal(url)
			return { action: 'deny' }
		})
		win.webContents.on('will-navigate', (event, url) => {
			if (url.startsWith('file:')) return
			if (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) return
			event.preventDefault()
			if (/^https?:/.test(url)) void shell.openExternal(url)
		})

		win.on('close', (event) => {
			if (!this.hideOnClose) return
			event.preventDefault()
			win.hide()
		})
		win.once('ready-to-show', () => {
			win.show()
		})
		this.loadChrome()
		return win
	}

	show(): void {
		const win = this.window
		if (!win || win.isDestroyed()) return
		if (win.isMinimized()) win.restore()
		win.show()
		win.focus()
	}

	loadChrome(): void {
		const win = this.window
		if (!win || win.isDestroyed()) return
		if (process.env.VITE_DEV_SERVER_URL) {
			void win.loadURL(process.env.VITE_DEV_SERVER_URL)
			return
		}
		void win.loadFile(join(__dirname, '../dist/index.html'))
	}

	showHarness(url: string, layout: ContentLayout = { uiShell: 'harness', appUrl: null }): void {
		const win = this.window
		if (!win || win.isDestroyed()) return
		this.harnessUrl = url
		this.uiShell = layout.uiShell
		this.appUrl = layout.uiShell === 'split' ? layout.appUrl : null
		this.overlay = false
		this.dialogSlot = null
		this.ensureHarnessView()
		this.ensureAppView()
		this.layout()
		void this.view?.webContents.loadURL(url)
		if (this.appUrl && this.appView) void this.appView.webContents.loadURL(this.appUrl)
	}

	hideHarness(): void {
		this.detachView(this.view)
		this.detachView(this.appView)
		this.harnessUrl = null
		this.appUrl = null
	}

	setOverlay(visible: boolean): void {
		this.overlay = visible
		this.layout()
	}

	get harnessContents(): Electron.WebContents | null {
		return this.view?.webContents ?? null
	}

	setDialogSlot(slot: DialogSlot | null): void {
		this.dialogSlot = slot
		this.layout()
	}

	setAgentSurface(visible: boolean): void {
		if (this.agentSurface === visible) return
		this.agentSurface = visible
		this.layout()
	}

	setTitle(title: string): void {
		const win = this.window
		if (!win || win.isDestroyed()) return
		win.setTitle(title)
	}

	private ensureHarnessView(): void {
		if (this.view) return
		this.view = this.createView(join(__dirname, 'harness-preload.js'))
		this.view.webContents.setWindowOpenHandler(({ url: next }) => {
			if (/^https?:/.test(next) && !LOOPBACK_ORIGIN.test(next)) {
				void shell.openExternal(next)
				return { action: 'deny' }
			}
			return { action: 'allow' }
		})
		this.view.webContents.on('will-navigate', (event, next) => {
			if (LOOPBACK_ORIGIN.test(next)) return
			event.preventDefault()
			if (/^https?:/.test(next)) void shell.openExternal(next)
		})
	}

	private ensureAppView(): void {
		if (this.appView) return
		this.appView = this.createView()
		this.appView.webContents.setWindowOpenHandler(({ url: next }) => {
			if (this.isAppNavigation(next)) return { action: 'allow' }
			if (/^https?:/.test(next)) void shell.openExternal(next)
			return { action: 'deny' }
		})
		this.appView.webContents.on('will-navigate', (event, next) => {
			if (this.isAppNavigation(next)) return
			event.preventDefault()
			if (/^https?:/.test(next)) void shell.openExternal(next)
		})
	}

	private createView(preload?: string): WebContentsView {
		const view = new WebContentsView({
			webPreferences: {
				...(preload ? { preload } : {}),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				webSecurity: true,
			},
		})
		view.setBackgroundColor('#10141a')
		return view
	}

	private isAppNavigation(next: string): boolean {
		if (!this.appUrl) return false
		try {
			return new URL(next).origin === new URL(this.appUrl).origin
		} catch {
			return false
		}
	}

	private detachView(view: WebContentsView | null): void {
		const win = this.window
		if (win && !win.isDestroyed() && view) {
			win.contentView.removeChildView(view)
		}
	}

	private place(view: WebContentsView, bounds: Electron.Rectangle): void {
		const win = this.window
		if (!win || win.isDestroyed()) return
		win.contentView.addChildView(view)
		view.setVisible(true)
		view.setBounds(bounds)
	}

	private layout(): void {
		const win = this.window
		if (!win || win.isDestroyed() || !this.view || !this.harnessUrl) return

		if (this.overlay) {
			this.view.setVisible(false)
			this.appView?.setVisible(false)
			return
		}

		const [width, height] = win.getContentSize()
		const bodyHeight = Math.max(0, height - TITLEBAR_HEIGHT)
		const bodyWidth = Math.max(0, width)
		this.place(this.view, { x: 0, y: TITLEBAR_HEIGHT, width: bodyWidth, height: bodyHeight })

		const slot = this.dialogSlot
		const showAgent =
			this.agentSurface &&
			this.uiShell === 'split' &&
			this.appUrl &&
			this.appView &&
			slot &&
			!slot.modal &&
			slot.width >= 80 &&
			slot.height >= 80
		if (!showAgent || !this.appView || !slot) {
			this.appView?.setVisible(false)
			return
		}
		this.place(this.appView, {
			x: slot.x,
			y: TITLEBAR_HEIGHT + slot.y,
			width: slot.width,
			height: slot.height,
		})
	}
}
