import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import log from 'electron-log'
import { resolveOfficialLocale, resolveOfficialModel, type OfficialLocale, type OfficialModel } from './official-model'
import { resolveNodeRuntime } from './node-runtime'

const execFileAsync = promisify(execFile)

const FIXBUG_PORT = 3000
const FIXBUG_URL = `http://127.0.0.1:${FIXBUG_PORT}/`
const READY_TIMEOUT_MS = 120_000

let child: ChildProcess | undefined
let owned = false

export function isFixbugOwned(): boolean {
	return owned && child != null && child.exitCode == null
}

export async function stopFixbugServer(): Promise<void> {
	const proc = child
	owned = false
	child = undefined
	if (!proc || proc.exitCode != null || !proc.pid) return
	if (process.platform === 'win32') {
		spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
			stdio: 'ignore',
			windowsHide: true,
		})
		return
	}
	proc.kill('SIGTERM')
}

async function isFixbugUp(): Promise<boolean> {
	try {
		const response = await fetch(FIXBUG_URL, { signal: AbortSignal.timeout(2_000) })
		return response.status > 0 && response.status < 500
	} catch {
		return false
	}
}

async function fixbugMatchesDesktop(official: OfficialModel | null, locale: OfficialLocale | null): Promise<boolean> {
	try {
		const response = await fetch(`${FIXBUG_URL}api/monitor/chat`, { signal: AbortSignal.timeout(2_000) })
		if (!response.ok) return false
		const body = (await response.json()) as { llm?: boolean; model?: string; locale?: string }
		if (official && (body.llm !== true || body.model !== official.model)) return false
		if (locale && body.locale !== locale) return false
		return true
	} catch {
		return false
	}
}

async function recycleOwnFixbug(): Promise<boolean> {
	if (process.platform !== 'win32') return false
	let stdout = ''
	try {
		stdout = (await execFileAsync('netstat', ['-ano', '-p', 'tcp'])).stdout
	} catch {
		return false
	}
	const line = stdout.split(/\r?\n/).find((item) => item.includes(':3000') && item.includes('LISTENING'))
	const pid = line?.trim().split(/\s+/).pop() ?? ''
	if (!/^\d+$/.test(pid) || pid === '0') return false
	let command = ''
	try {
		command = (
			await execFileAsync('powershell.exe', [
				'-NoProfile',
				'-Command',
				`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
			])
		).stdout
	} catch {
		return false
	}
	if (!/fixbug/i.test(command) || !/next/i.test(command)) return false
	await stopFixbugServer()
	spawn('taskkill', ['/pid', pid, '/T', '/F'], { stdio: 'ignore', windowsHide: true })
	const started = Date.now()
	while (Date.now() - started < 8_000) {
		if (!(await isFixbugUp())) return true
		await sleep(300)
	}
	return false
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

export type FixbugLaunch = {
	dshHome: string
	profile: string
}

/** 开发时启动 apps/fixbug 的 Next。端口上已有服务则直接用。 */
export async function ensureFixbugServer(
	appPath: string,
	userData: string,
	packaged: boolean,
	launch?: FixbugLaunch,
): Promise<string> {
	const official = launch ? resolveOfficialModel(launch.dshHome, launch.profile) : null
	const locale = launch ? resolveOfficialLocale(launch.dshHome, launch.profile) : null
	if (official) {
		log.info(`[fixbug] 使用官方模型 ${official.provider}/${official.model}`)
	} else {
		log.info('[fixbug] 未读到官方模型密钥，运维对话先用本地规则')
	}
	if (locale) log.info(`[fixbug] 使用官方语言 ${locale}`)
	if (await isFixbugUp()) {
		if (await fixbugMatchesDesktop(official, locale)) return FIXBUG_URL
		const recycled = await recycleOwnFixbug()
		if (!recycled) {
			log.warn('[fixbug] 3000 端口上的页面不是本次启动的，无法替它接上官方模型和语言')
			return FIXBUG_URL
		}
	}
	const appDir = join(appPath, 'apps', 'fixbug')
	const nextBin = join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next')
	if (!existsSync(nextBin)) {
		throw new Error(`未找到 Next：${nextBin}。请在仓库根目录执行 pnpm install。`)
	}
	const runtime = await resolveNodeRuntime(packaged)
	const dataRoot = join(userData, 'fixbug-data')
	mkdirSync(dataRoot, { recursive: true })
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PORT: String(FIXBUG_PORT),
		HOSTNAME: '127.0.0.1',
		NODE_ENV: 'development',
		CLIENT_HARNESS_ONLY: 'true',
		DSH_ENABLED: 'false',
		FIXBUG_DATA_ROOT: dataRoot,
		...(official?.env ?? {}),
		...(locale ? { NEXT_PUBLIC_UI_LOCALE: locale } : {}),
	}
	if (runtime.runAsElectronNode) env.ELECTRON_RUN_AS_NODE = '1'
	else delete env.ELECTRON_RUN_AS_NODE

	child = spawn(runtime.executable, [nextBin, 'dev', '--port', String(FIXBUG_PORT), '--hostname', '127.0.0.1'], {
		cwd: appDir,
		env,
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true,
	})
	owned = true
	const current = child
	current.stdout?.on('data', (chunk: Buffer) => {
		const line = chunk.toString().trim()
		if (line) log.info(`[fixbug] ${line}`)
	})
	current.stderr?.on('data', (chunk: Buffer) => {
		const line = chunk.toString().trim()
		if (line) log.info(`[fixbug] ${line}`)
	})
	current.on('exit', (code, signal) => {
		log.info(`[fixbug] 退出 code=${String(code)} signal=${String(signal)}`)
		if (child === current) {
			child = undefined
			owned = false
		}
	})

	const started = Date.now()
	while (Date.now() - started < READY_TIMEOUT_MS) {
		if (await isFixbugUp()) return FIXBUG_URL
		if (current.exitCode != null) {
			throw new Error(`运维页面进程退出（code ${current.exitCode}）`)
		}
		await sleep(500)
	}
	throw new Error(`运维页面未能在 ${READY_TIMEOUT_MS / 1000} 秒内打开：${FIXBUG_URL}`)
}
