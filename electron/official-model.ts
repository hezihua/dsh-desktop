import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type OfficialModel = {
	provider: string
	model: string
	/** 只放进运维进程，不要打进日志 */
	env: Record<string, string>
}

/** 官方 Settings → Models 写在 profile 补丁和 ~/.dsh/.credentials.yaml。 */
export function resolveOfficialModel(dshHome: string, profile: string): OfficialModel | null {
	const patchFile = join(dshHome, 'profiles', profile, 'cordis.patch.yml')
	const credentialFile = join(dshHome, '.credentials.yaml')
	if (!existsSync(patchFile) || !existsSync(credentialFile)) return null

	const patch = readFileSync(patchFile, 'utf8')
	const modelBlock = patch.match(
		/- id:\s*agent-default-model[\s\S]*?\n\s*provider:\s*([^\s#]+)[\s\S]*?\n\s*model:\s*([^\s#]+)/,
	)
	if (!modelBlock) return null
	const provider = modelBlock[1].trim()
	const model = modelBlock[2].trim()
	const apiKeyEnv = apiKeyEnvFor(patch, provider) || 'OPENROUTER_API_KEY'
	const apiKey = readCredentialRef(readFileSync(credentialFile, 'utf8'), apiKeyEnv)
	if (!apiKey) return null

	const env: Record<string, string> = {
		[apiKeyEnv]: apiKey,
		MONITOR_AI_MODEL: model,
	}
	if (provider === 'openrouter' && apiKeyEnv !== 'OPENROUTER_API_KEY') {
		env.OPENROUTER_API_KEY = apiKey
	}
	return { provider, model, env }
}

export type OfficialLocale = 'en' | 'zh'

/** 官方 Settings 里的界面语言。运维页只在已有中英文案里选择，不另写文案。 */
export function resolveOfficialLocale(dshHome: string, profile: string): OfficialLocale | null {
	const patchFile = join(dshHome, 'profiles', profile, 'cordis.patch.yml')
	if (!existsSync(patchFile)) return null
	const patch = readFileSync(patchFile, 'utf8')
	const match = patch.match(/- id:\s*locale[\s\S]*?\n\s*preference:\s*([^\s#]+)/)
	if (!match) return null
	const value = match[1].trim().toLowerCase()
	if (value === 'zh' || value.startsWith('zh-')) return 'zh'
	if (value === 'en' || value.startsWith('en-')) return 'en'
	return null
}

function readCredentialRef(text: string, name: string): string | null {
	let inRefs = false
	for (const line of text.split(/\r?\n/)) {
		if (/^refs:\s*$/.test(line)) {
			inRefs = true
			continue
		}
		if (inRefs && /^\S/.test(line)) break
		if (!inRefs) continue
		const match = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*?)\s*$/)
		if (!match || match[1] !== name) continue
		let value = match[2]
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1)
		}
		return value || null
	}
	return null
}

function apiKeyEnvFor(patch: string, provider: string): string | null {
	const lines = patch.split(/\r?\n/)
	for (let index = 0; index < lines.length; index += 1) {
		if (lines[index].trim() !== `${provider}:`) continue
		const next = lines[index + 1] ?? ''
		const match = next.match(/apiKeyEnv:\s*(\S+)/)
		if (match) return match[1]
	}
	return null
}
