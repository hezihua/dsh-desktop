import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
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

/**
 * 优先用本机 Node（Electron 28 内置 Node 18，跑不了 dsh）。
 * 仅当 Electron 自带 Node 已满足官方版本时，才回退到 ELECTRON_RUN_AS_NODE。
 */
export async function resolveNodeRuntime(): Promise<NodeRuntime> {
	const override = process.env.DSH_NODE_PATH?.trim()
	if (override) {
		if (!existsSync(override)) {
			throw new Error(`DSH_NODE_PATH 指向的 Node 不存在：${override}`)
		}
		const version = await readNodeVersion(override)
		if (!version || !isSupportedNodeVersion(version)) {
			throw new Error(`DSH_NODE_PATH 的 Node 版本过低（${version ?? '未知'}），需要 22.19+ 或 24+`)
		}
		return { executable: override, version, runAsElectronNode: false }
	}

	const systemNode = await resolveWhich('node')
	if (systemNode) {
		const version = await readNodeVersion(systemNode)
		if (version && isSupportedNodeVersion(version)) {
			return { executable: systemNode, version, runAsElectronNode: false }
		}
	}

	for (const candidate of extraNodeCandidates()) {
		if (!existsSync(candidate)) continue
		const version = await readNodeVersion(candidate)
		if (version && isSupportedNodeVersion(version)) {
			return { executable: candidate, version, runAsElectronNode: false }
		}
	}

	const bundled = process.versions.node
	if (isSupportedNodeVersion(bundled)) {
		const version = await readNodeVersion(process.execPath, {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
		})
		return {
			executable: process.execPath,
			version: version ?? bundled,
			runAsElectronNode: true,
		}
	}

	throw new Error(
		`DeepSeek Harness 需要 Node.js 22.19+ 或 24+。当前 Electron 内置 Node 为 ${bundled}，也未找到合格的系统 Node。请安装 Node 后重试，或设置 DSH_NODE_PATH。`,
	)
}
