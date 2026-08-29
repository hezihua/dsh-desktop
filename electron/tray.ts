import { Menu, Tray, app, nativeImage } from 'electron'
import log from 'electron-log'

export type TrayCallbacks = {
	show: () => void
	restart: () => void
	quit: () => void
}

function trayIcon(): Electron.NativeImage {
	const size = 16
	const buffer = Buffer.alloc(size * size * 4)
	for (let i = 0; i < size * size; i++) {
		buffer[i * 4] = 79
		buffer[i * 4 + 1] = 140
		buffer[i * 4 + 2] = 255
		buffer[i * 4 + 3] = 255
	}
	return nativeImage.createFromBitmap(buffer, { width: size, height: size })
}

export function createAppTray(callbacks: TrayCallbacks): Tray | null {
	try {
		const tray = new Tray(trayIcon())
		tray.setToolTip('DeepSeek Harness')
		tray.setContextMenu(
			Menu.buildFromTemplate([
				{ label: '显示窗口', click: () => callbacks.show() },
				{ label: '重启 Harness', click: () => callbacks.restart() },
				{ type: 'separator' },
				{ label: '退出', click: () => callbacks.quit() },
			]),
		)
		tray.on('click', () => callbacks.show())
		app.on('before-quit', () => {
			tray.destroy()
		})
		return tray
	} catch (error) {
		log.warn('系统托盘不可用，关闭窗口将退出应用', error)
		return null
	}
}
