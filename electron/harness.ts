import { type ChildProcess, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import log from 'electron-log'
import { resolveNodeRuntime } from './node-runtime'

export const HARNESS_HOST = '127.0.0.1'
export const HARNESS_PORTS = [32123, 32124, 32125]
export const READY_TIMEOUT_MS = 90_000
export const STOP_GRACE_MS = 4_000
export const SETTLE_MS = 2_500
export const HARNESS_LOG_FILENAME = 'dsh-web.log'

const POLL_INTERVAL_MS = 250
const HARNESS_LOG_MAX_BYTES = 2 * 1024 * 1024

export type HarnessStartOptions = {
	appPath: string
	logDir: string
	onUnexpectedExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

export function resolveDshEntry(appPath: string): string {
	const require = createRequire(join(appPath, 'package.json'))
	const manifest = require.resolve('@deepseek-ai/dsh/package.json')
	const unpacked = manifest.includes(`app.asar${sep}`)
		? manifest.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
		: manifest
	return join(dirname(unpacked), 'lib', 'bin.js')
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

export function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = createServer()
		probe.once('error', () => {
			resolve(false)
		})
		probe.once('listening', () => {
			probe.close(() => {
				resolve(true)
			})
		})
		probe.listen(port, HARNESS_HOST)
	})
}

export async function pickPort(preferred: number[] = HARNESS_PORTS): Promise<number> {
	for (const port of preferred) {
		if (await isPortFree(port)) return port
	}
	throw new Error(`没有可用端口：${preferred.join(', ')}`)
}

function preferredPorts(): number[] {
	const extra = (process.env.DSH_DESKTOP_PORT ?? '')
		.split(',')
		.map((item) => Number.parseInt(item.trim(), 10))
		.filter((port) => Number.isInteger(port) && port > 0 && port < 65536)
	return [...extra, ...HARNESS_PORTS]
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
	private child: ChildProcess | undefined
	private logStream: ReturnType<typeof createWriteStream> | undefined
	private stopping = false
	private readonly options: HarnessStartOptions

	constructor(options: HarnessStartOptions) {
		this.options = options
	}

	get running(): boolean {
		return this.child !== undefined && this.child.exitCode === null
	}

	async start(): Promise<string> {
		if (this.running) throw new Error('Harness 引擎已在运行')

		const entry = resolveDshEntry(this.options.appPath)
		if (!existsSync(entry)) {
			throw new Error(`找不到 @deepseek-ai/dsh 入口：${entry}`)
		}

		const runtime = await resolveNodeRuntime()
		const port = await pickPort(preferredPorts())
		this.url = `http://${HARNESS_HOST}:${port}`
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

		const args = [
			'--expose-internals',
			entry,
			'web',
			'--no-open',
			'--host',
			HARNESS_HOST,
			'--port',
			String(port),
		]

		const env: NodeJS.ProcessEnv = { ...process.env }
		delete env.ELECTRON_RUN_AS_NODE
		if (runtime.runAsElectronNode) {
			env.ELECTRON_RUN_AS_NODE = '1'
			env.ELECTRON_NO_ATTACH_CONSOLE = '1'
		}

		log.info('启动 Harness', {
			node: runtime.executable,
			version: runtime.version,
			runAsElectronNode: runtime.runAsElectronNode,
			entry,
			url: this.url,
		})

		this.stopping = false
		this.child = spawn(runtime.executable, args, {
			cwd: homedir(),
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		})

		this.child.stdout?.pipe(this.logStream, { end: false })
		this.child.stderr?.pipe(this.logStream, { end: false })
		this.child.stdout?.on('data', (chunk: Buffer) => {
			log.info(`[dsh] ${chunk.toString().trimEnd()}`)
		})
		this.child.stderr?.on('data', (chunk: Buffer) => {
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
			return this.url
		} catch (error) {
			await this.stop()
			throw error
		}
	}

	private async waitReady(timeoutMs = READY_TIMEOUT_MS): Promise<void> {
		const deadline = Date.now() + timeoutMs
		for (;;) {
			if (!this.running) {
				throw new Error(`Harness 在就绪前退出，日志：${this.logPath}`)
			}
			try {
				const response = await fetch(this.url, { signal: AbortSignal.timeout(2_000) })
				if (response.status > 0) return
			} catch {
				// 还没监听
			}
			if (Date.now() >= deadline) {
				throw new Error(`Harness 在 ${timeoutMs}ms 内未响应 ${this.url}，日志：${this.logPath}`)
			}
			await sleep(POLL_INTERVAL_MS)
		}
	}

	async stop(graceMs = STOP_GRACE_MS): Promise<void> {
		if (this.child === undefined) return
		this.stopping = true
		const child = this.child
		this.child = undefined
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

	async restart(): Promise<string> {
		await this.stop()
		return this.start()
	}
}
