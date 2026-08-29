import { BrowserWindow, WebContentsView, shell } from 'electron'
import { join } from 'node:path'

export const TITLEBAR_HEIGHT = 36

const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:\d+/

export class DesktopShell {
	window: BrowserWindow | null = null
	private view: WebContentsView | null = null
	private harnessUrl: string | null = null
	private overlay = false

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

	showHarness(url: string): void {
		const win = this.window
		if (!win || win.isDestroyed()) return
		this.harnessUrl = url
		this.overlay = false

		if (!this.view) {
			this.view = new WebContentsView({
				webPreferences: {
					contextIsolation: true,
					nodeIntegration: false,
					sandbox: true,
					webSecurity: true,
				},
			})
			this.view.setBackgroundColor('#10141a')
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

		win.contentView.addChildView(this.view)
		this.layout()
		void this.view.webContents.loadURL(url)
	}

	hideHarness(): void {
		this.detachView()
		this.harnessUrl = null
	}

	setOverlay(visible: boolean): void {
		this.overlay = visible
		this.layout()
	}

	private detachView(): void {
		const win = this.window
		if (win && !win.isDestroyed() && this.view) {
			win.contentView.removeChildView(this.view)
		}
	}

	private layout(): void {
		const win = this.window
		if (!win || win.isDestroyed() || !this.view || !this.harnessUrl) return

		if (this.overlay) {
			this.view.setVisible(false)
			return
		}

		win.contentView.addChildView(this.view)
		this.view.setVisible(true)
		const [width, height] = win.getContentSize()
		this.view.setBounds({
			x: 0,
			y: TITLEBAR_HEIGHT,
			width,
			height: Math.max(0, height - TITLEBAR_HEIGHT),
		})
	}
}
