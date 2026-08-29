import { type ChildProcess, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, dirname, join, sep } from 'node:path'
import log from 'electron-log'
import { nodeBinDir, resolveNodeRuntime } from './node-runtime'

export const HARNESS_HOST = '127.0.0.1'
export const READY_TIMEOUT_MS = 90_000
export const STOP_GRACE_MS = 4_000
export const SETTLE_MS = 2_500
export const START_RETRIES = 3
export const HARNESS_LOG_FILENAME = 'dsh-web.log'

const POLL_INTERVAL_MS = 250
const HARNESS_LOG_MAX_BYTES = 2 * 1024 * 1024
const WEB_URL_RE = /dsh web:\s+(https?:\/\/127\.0\.0\.1:\d+[^\s,;)]*)/i

export type HarnessStartOptions = {
	appPath: string
	logDir: string
	packaged: boolean
	attach?: boolean
	dshHome?: string
	onUnexpectedExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

export function extractWebUrl(buffer: string): { url: string | null; rest: string } {
	const match = WEB_URL_RE.exec(buffer)
	if (!match) {
		return { url: null, rest: buffer.length > 240 ? buffer.slice(-240) : buffer }
	}
	return { url: match[1], rest: '' }
}

export function resolveDshEntry(appPath: string): string {
	const require = createRequire(join(appPath, 'package.json'))
	const manifest = require.resolve('@deepseek-ai/dsh/package.json')
	const unpacked = manifest.includes(`app.asar${sep}`)
		? manifest.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
		: manifest
	return join(dirname(unpacked), 'lib', 'bin.js')
}

export function readLogTail(logPath: string, maxBytes = 4_000): string {
	try {
		if (!logPath || !existsSync(logPath)) return ''
		const data = readFileSync(logPath)
		return data.subarray(Math.max(0, data.length - maxBytes)).toString('utf8')
	} catch {
		return ''
	}
}

export function resolveDshVersion(appPath: string): string {
	try {
		const require = createRequire(join(appPath, 'package.json'))
		const manifest = require.resolve('@deepseek-ai/dsh/package.json')
		const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown }
		return typeof pkg.version === 'string' ? pkg.version : 'unknown'
	} catch {
		return 'unknown'
	}
}

export async function isDshSurface(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
		if (response.status <= 0) return false
		const text = await response.text()
		return (
			text.includes('DeepSeek Harness') ||
			text.includes('__ModuleLoader__') ||
			text.includes('__DSH_BOOT__')
		)
	} catch {
		return false
	}
}

function attachCandidates(): string[] {
	const extra = (process.env.DSH_DESKTOP_PORT ?? '')
		.split(',')
		.map((item) => Number.parseInt(item.trim(), 10))
		.filter((port) => Number.isInteger(port) && port > 0 && port < 65536)
		.map((port) => `http://${HARNESS_HOST}:${port}`)
	return [...extra, `http://${HARNESS_HOST}:3080`]
}

function killProcessTree(pid: number, child: ChildProcess): void {
	if (process.platform === 'win32') {
		spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
			stdio: 'ignore',
			windowsHide: true,
		})
		return
	}
	child.kill('SIGTERM')
}

export class HarnessServer {
	url = ''
	logPath = ''
	/** 附着到已有 dsh web 时为 false，关窗口不会杀掉别人的进程 */
	owned = false
	private child: ChildProcess | undefined
	private logStream: ReturnType<typeof createWriteStream> | undefined
	private stopping = false
	private readonly options: HarnessStartOptions

	constructor(options: HarnessStartOptions) {
		this.options = options
	}

	get running(): boolean {
		if (!this.owned) return Boolean(this.url)
		return this.child !== undefined && this.child.exitCode === null
	}

	async startWithRetry(retries = START_RETRIES): Promise<string> {
		if (this.options.attach !== false) {
			const attached = await this.tryAttach()
			if (attached) return attached
		}

		let lastError: unknown
		for (let attempt = 1; attempt <= retries; attempt++) {
			try {
				log.info(`启动 Harness（第 ${attempt}/${retries} 次）`)
				return await this.startOwned()
			} catch (error) {
				lastError = error
				log.warn(`Harness 启动失败（第 ${attempt} 次）`, error)
				await this.stop()
				if (attempt < retries) await sleep(1000 * attempt)
			}
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError))
	}

	private async tryAttach(): Promise<string | null> {
		for (const url of attachCandidates()) {
			if (await isDshSurface(url)) {
				this.url = url
				this.owned = false
				this.logPath = join(this.options.logDir, HARNESS_LOG_FILENAME)
				log.info(`附着到已有 Harness：${url}`)
				return url
			}
		}
		return null
	}

	private async startOwned(): Promise<string> {
		if (this.child && this.child.exitCode === null) throw new Error('Harness 引擎已在运行')

		const entry = resolveDshEntry(this.options.appPath)
		if (!existsSync(entry)) {
			throw new Error(`找不到 @deepseek-ai/dsh 入口：${entry}`)
		}

		const runtime = await resolveNodeRuntime(this.options.packaged)
		this.url = ''
		this.owned = true
		this.logPath = join(this.options.logDir, HARNESS_LOG_FILENAME)

		mkdirSync(this.options.logDir, { recursive: true })
		if (existsSync(this.logPath)) {
			try {
				if (statSync(this.logPath).size > HARNESS_LOG_MAX_BYTES) {
					createWriteStream(this.logPath, { flags: 'w' }).end()
				}
			} catch {
				// 截断失败就继续追加
			}
		}
		this.logStream = createWriteStream(this.logPath, { flags: 'a' })

		const args = ['--expose-internals', entry, 'web', '--no-open', '--host', HARNESS_HOST, '--port', '0']

		const env: NodeJS.ProcessEnv = { ...process.env }
		delete env.ELECTRON_RUN_AS_NODE
		if (this.options.dshHome) env.DSH_HOME = this.options.dshHome
		if (runtime.runAsElectronNode) {
			env.ELECTRON_RUN_AS_NODE = '1'
			env.ELECTRON_NO_ATTACH_CONSOLE = '1'
		} else {
			env.PATH = `${nodeBinDir(runtime)}${delimiter}${env.PATH ?? ''}`
		}

		log.info('spawn dsh web', {
			node: runtime.executable,
			version: runtime.version,
			source: runtime.source,
			runAsElectronNode: runtime.runAsElectronNode,
			entry,
			dshHome: env.DSH_HOME ?? join(homedir(), '.dsh'),
		})

		this.stopping = false
		this.child = spawn(runtime.executable, args, {
			cwd: homedir(),
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		})

		let output = ''
		const consume = (chunk: Buffer) => {
			const text = chunk.toString()
			this.logStream?.write(text)
			output += text
			const extracted = extractWebUrl(output)
			output = extracted.rest
			if (extracted.url) this.url = extracted.url
		}
		this.child.stdout?.on('data', (chunk: Buffer) => {
			consume(chunk)
			log.info(`[dsh] ${chunk.toString().trimEnd()}`)
		})
		this.child.stderr?.on('data', (chunk: Buffer) => {
			consume(chunk)
			log.warn(`[dsh] ${chunk.toString().trimEnd()}`)
		})

		this.child.on('error', (error) => {
			this.logStream?.write(`spawn error: ${String(error)}\n`)
			if (!this.stopping) this.options.onUnexpectedExit?.(null, null)
		})
		this.child.once('exit', (code, signal) => {
			this.logStream?.end()
			this.logStream = undefined
			if (!this.stopping) this.options.onUnexpectedExit?.(code, signal)
		})

		try {
			await this.waitReady()
			await sleep(SETTLE_MS)
			if (!this.running) {
				throw new Error(`Harness 在就绪后立即退出，日志：${this.logPath}`)
			}
			if (!(await isDshSurface(this.url))) {
				throw new Error(`Harness 端口已开但页面不像官方 UI：${this.url}`)
			}
			return this.url
		} catch (error) {
			await this.stop()
			throw error
		}
	}

	private async waitReady(timeoutMs = READY_TIMEOUT_MS): Promise<void> {
		const deadline = Date.now() + timeoutMs
		for (;;) {
			if (this.owned && !this.running) {
				throw new Error(`Harness 在就绪前退出，日志：${this.logPath}`)
			}
			if (this.url) {
				try {
					const response = await fetch(this.url, { signal: AbortSignal.timeout(2_000) })
					if (response.status > 0) return
				} catch {
					// 打印了 URL 但还没真正 listen
				}
			}
			if (Date.now() >= deadline) {
				throw new Error(`Harness 在 ${timeoutMs}ms 内未就绪，日志：${this.logPath}`)
			}
			await sleep(POLL_INTERVAL_MS)
		}
	}

	async stop(graceMs = STOP_GRACE_MS): Promise<void> {
		if (!this.owned) {
			this.url = ''
			return
		}
		if (this.child === undefined) return
		this.stopping = true
		const child = this.child
		this.child = undefined
		this.owned = false
		if (child.exitCode !== null) return

		const exited = new Promise<void>((resolve) => {
			child.once('exit', () => resolve())
		})
		if (child.pid) {
			killProcessTree(child.pid, child)
		} else {
			try {
				child.kill('SIGTERM')
			} catch {
				// 已退出
			}
		}

		const graceful = await Promise.race([
			exited.then(() => true),
			sleep(graceMs).then(() => false),
		])
		if (!graceful && child.exitCode === null) {
			try {
				child.kill('SIGKILL')
			} catch {
				// 尽力而为
			}
			await exited
		}
	}
}
