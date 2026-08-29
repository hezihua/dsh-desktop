import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Harness 官方 engines：^22.19.0 || >=24.0.0 */
export function isSupportedNodeVersion(version: string): boolean {
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
	if (!match) return false
	const major = Number(match[1])
	const minor = Number(match[2])
	if (major >= 24) return true
	return major === 22 && minor >= 19
}

export type NodeRuntime = {
	executable: string
	version: string
	source: 'override' | 'bundled' | 'system' | 'electron'
	/** 用 Electron 二进制充当 Node（ELECTRON_RUN_AS_NODE=1） */
	runAsElectronNode: boolean
}

async function readNodeVersion(executable: string, env?: NodeJS.ProcessEnv): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(executable, ['-p', 'process.versions.node'], {
			env,
			timeout: 8_000,
			windowsHide: true,
		})
		const version = stdout.trim()
		return version || null
	} catch {
		return null
	}
}

async function resolveWhich(command: string): Promise<string | null> {
	const finder = process.platform === 'win32' ? 'where' : 'which'
	try {
		const { stdout } = await execFileAsync(finder, [command], {
			timeout: 8_000,
			windowsHide: true,
		})
		const first = stdout
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) => line && !line.toLowerCase().endsWith('.cmd') && !line.toLowerCase().endsWith('.bat'))
		return first && existsSync(first) ? first : null
	} catch {
		return null
	}
}

function extraNodeCandidates(): string[] {
	if (process.platform === 'win32') {
		return [
			'C:\\Program Files\\nodejs\\node.exe',
			'C:\\Program Files (x86)\\nodejs\\node.exe',
		]
	}
	return ['/usr/local/bin/node', '/usr/bin/node']
}

export function resolveBundledNodePath(): string | null {
	const name = process.platform === 'win32' ? 'node.exe' : 'node'
	const candidates = [
		process.resourcesPath ? join(process.resourcesPath, 'node', name) : '',
		join(process.cwd(), 'resources', 'node', name),
	]
	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) return candidate
	}
	return null
}

/**
 * 安装包优先用 extraResources 里的 Node。
 * 开发态优先系统 Node。找不到合格 Node 时回退 ELECTRON_RUN_AS_NODE。
 */
export async function resolveNodeRuntime(packaged: boolean): Promise<NodeRuntime> {
	const override = process.env.DSH_NODE_PATH?.trim()
	if (override) {
		if (!existsSync(override)) {
			throw new Error(`DSH_NODE_PATH 指向的 Node 不存在：${override}`)
		}
		const version = await readNodeVersion(override)
		if (!version || !isSupportedNodeVersion(version)) {
			throw new Error(`DSH_NODE_PATH 的 Node 版本过低（${version ?? '未知'}），需要 22.19+ 或 24+`)
		}
		return { executable: override, version, source: 'override', runAsElectronNode: false }
	}

	const tryPath = async (
		executable: string,
		source: NodeRuntime['source'],
	): Promise<NodeRuntime | null> => {
		const version = await readNodeVersion(executable)
		if (!version || !isSupportedNodeVersion(version)) return null
		return { executable, version, source, runAsElectronNode: false }
	}

	const bundled = resolveBundledNodePath()
	if (packaged && bundled) {
		const runtime = await tryPath(bundled, 'bundled')
		if (runtime) return runtime
	}

	const systemNode = await resolveWhich('node')
	if (systemNode) {
		const runtime = await tryPath(systemNode, 'system')
		if (runtime) return runtime
	}

	for (const candidate of extraNodeCandidates()) {
		if (!existsSync(candidate)) continue
		const runtime = await tryPath(candidate, 'system')
		if (runtime) return runtime
	}

	if (!packaged && bundled) {
		const runtime = await tryPath(bundled, 'bundled')
		if (runtime) return runtime
	}

	const electronNode = process.versions.node
	if (isSupportedNodeVersion(electronNode)) {
		const version = await readNodeVersion(process.execPath, {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
		})
		return {
			executable: process.execPath,
			version: version ?? electronNode,
			source: 'electron',
			runAsElectronNode: true,
		}
	}

	throw new Error(
		`DeepSeek Harness 需要 Node.js 22.19+ 或 24+。未找到安装包内的 Node，Electron 内置为 ${electronNode}，也没有合格的系统 Node。`,
	)
}

export function nodeBinDir(runtime: NodeRuntime): string {
	return dirname(runtime.executable)
}
