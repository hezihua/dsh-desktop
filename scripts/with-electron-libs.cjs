#!/usr/bin/env node
/**
 * WSL / 精简 Linux 上 Electron 常缺 libnss3 等系统库。
 * 能 sudo 时优先装发行版包；否则把对应 .deb 解到项目目录并设置 LD_LIBRARY_PATH。
 */
const { execFileSync, spawn } = require('node:child_process')
const { existsSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const libDir = join(root, '.electron-libs', 'usr', 'lib', 'x86_64-linux-gnu')
const extractRoot = join(root, '.electron-libs')
const packages = ['libnss3', 'libnspr4', 'libasound2t64']

function ensureLibs() {
	if (process.platform !== 'linux') return
	if (existsSync(join(libDir, 'libnss3.so'))) return

	mkdirSync(extractRoot, { recursive: true })
	const work = join(root, '.electron-libs', 'debs')
	mkdirSync(work, { recursive: true })
	execFileSync('apt-get', ['download', ...packages], { cwd: work, stdio: 'inherit' })
	const debs = require('node:fs')
		.readdirSync(work)
		.filter((name) => name.endsWith('.deb'))
	for (const deb of debs) {
		execFileSync('dpkg-deb', ['-x', join(work, deb), extractRoot], { stdio: 'inherit' })
	}
}

ensureLibs()

const env = { ...process.env }
// 壳进程必须走完整 Electron 运行时；这个变量只留给 spawn dsh 的回退路径
delete env.ELECTRON_RUN_AS_NODE
if (existsSync(libDir)) {
	env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH ? `${libDir}:${env.LD_LIBRARY_PATH}` : libDir
}

const [command, ...args] = process.argv.slice(2)
if (!command) {
	console.error('usage: node scripts/with-electron-libs.cjs <command> [args...]')
	process.exit(1)
}

const child = spawn(command, args, { env, stdio: 'inherit', shell: process.platform === 'win32' })
child.on('exit', (code, signal) => {
	if (signal) process.kill(process.pid, signal)
	process.exit(code ?? 1)
})
