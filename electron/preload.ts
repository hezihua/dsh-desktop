import { contextBridge, ipcRenderer } from 'electron'

export type HarnessStatus =
	| { phase: 'starting'; message: string }
	| { phase: 'ready'; message: string; url?: string }
	| { phase: 'error'; message: string }

contextBridge.exposeInMainWorld('desktop', {
	getInfo: () => ipcRenderer.invoke('desktop:get-info'),
	restartHarness: () => ipcRenderer.invoke('desktop:restart-harness'),
	setOverlay: (visible: boolean) => ipcRenderer.invoke('desktop:set-overlay', visible),
	minimize: () => ipcRenderer.invoke('window:minimize'),
	maximize: () => ipcRenderer.invoke('window:maximize'),
	close: () => ipcRenderer.invoke('window:close'),
	isMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
	onMaximizedChange: (callback: (maximized: boolean) => void) => {
		const listener = (_event: unknown, maximized: boolean) => callback(maximized)
		ipcRenderer.on('window:maximized', listener)
		return () => {
			ipcRenderer.removeListener('window:maximized', listener)
		}
	},
	onHarnessStatus: (callback: (status: HarnessStatus) => void) => {
		const listener = (_event: unknown, status: HarnessStatus) => callback(status)
		ipcRenderer.on('harness:status', listener)
		return () => {
			ipcRenderer.removeListener('harness:status', listener)
		}
	},
})

contextBridge.exposeInMainWorld('updater', {
	check: () => ipcRenderer.invoke('update:check'),
	download: () => ipcRenderer.invoke('update:download'),
	install: () => ipcRenderer.invoke('update:install'),
	on: (channel: string, callback: (payload?: unknown) => void) => {
		const listener = (_event: unknown, payload?: unknown) => callback(payload)
		ipcRenderer.on(channel, listener)
		return () => {
			ipcRenderer.removeListener(channel, listener)
		}
	},
})
