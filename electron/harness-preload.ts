import { contextBridge, ipcRenderer } from 'electron'

type DialogSlot = {
	x: number
	y: number
	width: number
	height: number
	/** 官方面板（Plugins、Agents 等）占着主区域时，先让开 */
	official: boolean
	/** 官方弹层（设置等）打开时让开，关掉后再回到智能体 */
	modal: boolean
}

function centerColumn(): HTMLElement | null {
	const rightbar = document.querySelector('[data-rightbar-col]')
	const previous = rightbar?.previousElementSibling
	return previous instanceof HTMLElement ? previous : null
}

function readSlot(): DialogSlot | null {
	const center = centerColumn()
	if (!center) return null
	const rect = center.getBoundingClientRect()
	return {
		x: Math.round(rect.x),
		y: Math.round(rect.y),
		width: Math.round(rect.width),
		height: Math.round(rect.height),
		official: center.querySelector('[data-global-panel]') != null,
		modal: document.querySelector('[role="dialog"][aria-modal="true"]') != null,
	}
}

function watchDialogSlot(): void {
	let last = ''
	const publish = () => {
		const slot = readSlot()
		const key = JSON.stringify(slot)
		if (key === last) return
		last = key
		ipcRenderer.send('desktop:dialog-slot', slot)
	}
	const resize = new ResizeObserver(publish)
	const mutations = new MutationObserver(publish)
	let bound: HTMLElement | null = null
	const bind = () => {
		const center = centerColumn()
		if (!center) return
		if (center === bound) {
			publish()
			return
		}
		if (bound) resize.unobserve(bound)
		bound = center
		resize.observe(center)
		mutations.disconnect()
		mutations.observe(center, {
			attributes: true,
			subtree: true,
			attributeFilter: ['data-global-panel'],
		})
		publish()
	}
	bind()
	const modalWatch = new MutationObserver(publish)
	const armModalWatch = () => {
		if (!document.body) return
		modalWatch.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['role', 'aria-modal'],
		})
	}
	if (document.body) armModalWatch()
	else document.addEventListener('DOMContentLoaded', armModalWatch, { once: true })
	const timer = window.setInterval(bind, 400)
	window.addEventListener('resize', publish)
	window.addEventListener('beforeunload', () => {
		window.clearInterval(timer)
	})
}

watchDialogSlot()

document.addEventListener(
	'click',
	(event) => {
		const target = event.target
		if (!(target instanceof Element)) return
		const backToDialog = target.closest(
			'[class*="newSession"], [class*="sessionRow"], [class*="panelEntry"]',
		)
		if (!backToDialog) return
		ipcRenderer.send('desktop:conversation')
	},
	true,
)

export type AgentCatalog = {
	activeId: string
	agents: Array<{
		id: string
		label: string
		description: string
		available: boolean
		unavailableReason?: string
	}>
}

contextBridge.exposeInMainWorld('dshDesktopAgents', {
	catalog: () => ipcRenderer.invoke('desktop:agent-catalog') as Promise<AgentCatalog>,
	select: (agentId: string) =>
		ipcRenderer.invoke('desktop:select-agent', agentId) as Promise<{ ok: boolean; message?: string }>,
	show: (agentId: string) =>
		ipcRenderer.invoke('desktop:show-agent', agentId) as Promise<{ ok: boolean; message?: string }>,
})
