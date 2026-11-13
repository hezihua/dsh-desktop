import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

export type AgentUiShell = 'harness' | 'split'

export type DesktopAgent = {
	id: string
	label: string
	description: string
	uiShell: AgentUiShell
	available: boolean
	unavailableReason?: string
	appUrl: string | null
	appUrlEnv?: string
}

export type AgentLaunch = {
	agent: DesktopAgent
	profile: string
	patches: string[]
	/** 无补丁的官方 web 才附着已有进程，避免把公司智能体挂到别人的会话上 */
	attach: boolean
	logFileName: string
}

type AgentRecord = {
	id: string
	label: string
	description?: string
	profile: string
	uiShell?: AgentUiShell
	patches?: string[]
	appUrlEnv?: string
}

type RegistryFile = {
	defaultAgentId: string
	agents: AgentRecord[]
}

type ResolvedAgent = {
	summary: DesktopAgent
	profile: string
	patchPaths: string[]
}

const RESERVED_PROFILE = 'desktop'

export function resolveAgentsRoot(appPath: string, packaged: boolean): string {
	return packaged ? join(process.resourcesPath, 'agents') : join(appPath, 'agents')
}

export function loadAgentCatalog(root: string, env: NodeJS.ProcessEnv = process.env): ResolvedAgent[] {
	const registry = readRegistry(root)
	return registry.agents.map((record) => resolveRecord(root, record, env))
}

export function readActiveAgentId(storePath: string, fallback: string): string {
	try {
		const raw = JSON.parse(readFileSync(storePath, 'utf8')) as { agentId?: unknown }
		if (typeof raw.agentId === 'string' && raw.agentId.trim()) return raw.agentId.trim()
	} catch {
		// 首次启动或文件损坏时用注册表默认项
	}
	return fallback
}

export function writeActiveAgentId(storePath: string, agentId: string): void {
	mkdirSync(resolve(storePath, '..'), { recursive: true })
	writeFileSync(storePath, JSON.stringify({ agentId }, null, 2), 'utf8')
}

export function defaultAgentId(root: string): string {
	return readRegistry(root).defaultAgentId
}

/** 把官方侧边栏 Agents 面板写进一份补丁，路径指向随安装位置变化的本地插件。 */
export function ensureAgentsPanelPatch(root: string, destFile: string): string {
	const entry = resolve(root, 'panel', 'lib', 'index.js')
	if (!existsSync(entry)) throw new Error(`找不到 Agents 面板插件：${entry}`)
	const name = entry.replace(/\\/g, '/')
	const body = [
		'# 官方侧边栏 Plugins 下面的 Agents 面板。由桌面壳写入。',
		'- insert:',
		'    - id: desktop-agents-panel',
		`      name: ${JSON.stringify(name)}`,
		'',
	].join('\n')
	mkdirSync(dirname(destFile), { recursive: true })
	writeFileSync(destFile, body, 'utf8')
	return destFile
}

export function resolveAgentLaunch(
	root: string,
	agentId: string,
	safeMode: boolean,
	env: NodeJS.ProcessEnv = process.env,
	extraPatches: string[] = [],
): AgentLaunch {
	const catalog = loadAgentCatalog(root, env)
	const resolved = catalog.find((item) => item.summary.id === agentId) ?? catalog[0]
	if (!resolved) throw new Error(`智能体注册表是空的：${root}`)
	if (!resolved.summary.available) {
		throw new Error(resolved.summary.unavailableReason || `智能体不可用：${resolved.summary.label}`)
	}
	if (safeMode) {
		return {
			agent: { ...resolved.summary, uiShell: 'harness', appUrl: null },
			profile: 'web',
			patches: [],
			attach: false,
			logFileName: 'dsh-web-safe.log',
		}
	}
	const patches = [...resolved.patchPaths, ...extraPatches]
	return {
		agent: resolved.summary,
		profile: resolved.profile,
		patches,
		attach: resolved.profile === 'web' && patches.length === 0,
		logFileName: `dsh-${resolved.summary.id}.log`,
	}
}

function readRegistry(root: string): RegistryFile {
	const file = join(root, 'registry.json')
	if (!existsSync(file)) throw new Error(`找不到智能体注册表：${file}`)
	const raw = JSON.parse(readFileSync(file, 'utf8')) as RegistryFile
	if (!raw.defaultAgentId || !Array.isArray(raw.agents) || raw.agents.length === 0) {
		throw new Error('registry.json 需要 defaultAgentId 和 agents[]')
	}
	if (!raw.agents.some((item) => item.id === raw.defaultAgentId)) {
		throw new Error(`默认智能体不在列表中：${raw.defaultAgentId}`)
	}
	return raw
}

function resolveRecord(root: string, record: AgentRecord, env: NodeJS.ProcessEnv): ResolvedAgent {
	const uiShell: AgentUiShell = record.uiShell === 'split' ? 'split' : 'harness'
	const profile = record.profile?.trim() || 'web'
	const patches = Array.isArray(record.patches) ? record.patches : []
	let available = true
	let unavailableReason: string | undefined
	const patchPaths: string[] = []

	if (!record.id?.trim() || !record.label?.trim()) {
		available = false
		unavailableReason = '智能体缺少 id 或名称'
	} else if (profile.toLowerCase() === RESERVED_PROFILE) {
		available = false
		unavailableReason = 'profile「desktop」由壳保留，不能当作 dsh profile 启动'
	} else {
		for (const patch of patches) {
			if (typeof patch !== 'string' || !patch.trim()) {
				available = false
				unavailableReason = '补丁路径无效'
				break
			}
			const abs = resolve(root, patch)
			const rel = relative(root, abs)
			if (rel.startsWith('..') || isAbsolute(rel)) {
				available = false
				unavailableReason = `补丁必须放在注册表目录内：${patch}`
				break
			}
			if (!existsSync(abs)) {
				available = false
				unavailableReason = `找不到补丁：${patch}`
				break
			}
			patchPaths.push(abs)
		}
	}

	return {
		summary: {
			id: record.id,
			label: record.label,
			description: record.description?.trim() || '',
			uiShell,
			available,
			unavailableReason,
			appUrl: readAppUrl(env, record.appUrlEnv),
			appUrlEnv: record.appUrlEnv?.trim() || undefined,
		},
		profile,
		patchPaths: available ? patchPaths : [],
	}
}

function readAppUrl(env: NodeJS.ProcessEnv, name: string | undefined): string | null {
	if (!name?.trim()) return null
	const value = env[name]?.trim()
	if (!value) return null
	try {
		const url = new URL(value)
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
		return url.toString()
	} catch {
		return null
	}
}
