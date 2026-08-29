#!/usr/bin/env node
/**
 * 下载官方 Node 二进制到 resources/node/，打包进 extraResources。
 * 安装包用这份 Node 跑 dsh web，不依赖使用者本机环境。
 */
const { execFileSync } = require('node:child_process')
const { copyFileSync, createWriteStream, chmodSync, existsSync, mkdirSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const https = require('node:https')
const http = require('node:http')

const NODE_VERSION = process.env.DSH_BUNDLE_NODE_VERSION || '22.22.0'
const root = join(__dirname, '..')
const destDir = join(root, 'resources', 'node')

function parseArgs(argv) {
	const out = { platform: process.platform, arch: process.arch }
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--platform') out.platform = argv[++i]
		else if (arg === '--arch') out.arch = argv[++i]
	}
	return out
}

function distName(platform, arch) {
	if (platform === 'win32') {
		if (arch !== 'x64' && arch !== 'arm64') throw new Error(`不支持的 Windows arch：${arch}`)
		return { folder: `node-v${NODE_VERSION}-win-${arch}`, archive: `node-v${NODE_VERSION}-win-${arch}.zip`, binary: 'node.exe' }
	}
	if (platform === 'darwin') {
		const cpu = arch === 'arm64' ? 'arm64' : 'x64'
		return { folder: `node-v${NODE_VERSION}-darwin-${cpu}`, archive: `node-v${NODE_VERSION}-darwin-${cpu}.tar.gz`, binary: 'bin/node' }
	}
	if (platform === 'linux') {
		const cpu = arch === 'arm64' ? 'arm64' : 'x64'
		return { folder: `node-v${NODE_VERSION}-linux-${cpu}`, archive: `node-v${NODE_VERSION}-linux-${cpu}.tar.xz`, binary: 'bin/node' }
	}
	throw new Error(`不支持的平台：${platform}`)
}

function download(url, file) {
	return new Promise((resolve, reject) => {
		const client = url.startsWith('https:') ? https : http
		const req = client.get(url, { headers: { 'User-Agent': 'dsh-desktop-prepare-node' } }, (res) => {
			if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				res.resume()
				download(res.headers.location, file).then(resolve, reject)
				return
			}
			if (res.statusCode !== 200) {
				res.resume()
				reject(new Error(`下载失败 ${url}（HTTP ${String(res.statusCode)}）`))
				return
			}
			const out = createWriteStream(file)
			res.pipe(out)
			out.on('finish', () => out.close((error) => (error ? reject(error) : resolve())))
			out.on('error', reject)
		})
		req.on('error', reject)
	})
}

async function main() {
	const { platform, arch } = parseArgs(process.argv.slice(2))
	const spec = distName(platform, arch)
	const destName = platform === 'win32' ? 'node.exe' : 'node'
	const destFile = join(destDir, destName)
	if (existsSync(destFile)) {
		console.log(`已存在 ${destFile}，跳过下载`)
		return
	}

	const mirror = (process.env.NODEJS_ORG_MIRROR || 'https://nodejs.org/dist').replace(/\/$/, '')
	const url = `${mirror}/v${NODE_VERSION}/${spec.archive}`
	const work = join(tmpdir(), `dsh-node-${process.pid}`)
	mkdirSync(work, { recursive: true })
	mkdirSync(destDir, { recursive: true })
	const archivePath = join(work, spec.archive)

	console.log(`下载 Node ${NODE_VERSION}（${platform}-${arch}）`)
	console.log(url)
	await download(url, archivePath)

	if (spec.archive.endsWith('.zip')) {
		execFileSync('tar', ['-xf', archivePath, '-C', work], { stdio: 'inherit' })
	} else {
		execFileSync('tar', ['-xf', archivePath, '-C', work], { stdio: 'inherit' })
	}

	const extracted = join(work, spec.folder, spec.binary)
	if (!existsSync(extracted)) {
		throw new Error(`解压后找不到 Node：${extracted}`)
	}
	copyFileSync(extracted, destFile)
	if (platform !== 'win32') chmodSync(destFile, 0o755)
	rmSync(work, { recursive: true, force: true })
	console.log(`已写入 ${destFile}`)
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error)
	process.exit(1)
})
