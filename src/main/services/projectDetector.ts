import { access, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ProjectDetection } from '../../shared/types'

const exists = (path: string) => access(path).then(() => true).catch(() => false)

export async function detectProject(path: string): Promise<ProjectDetection> {
  const packagePath = join(path, 'package.json')
  const packageJson = (await exists(packagePath))
    ? JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, any>
    : {}
  const dependencies = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) }
  const scripts = Object.keys(packageJson.scripts ?? {})
  const packageManager = await exists(join(path, 'pnpm-lock.yaml')) ? 'pnpm'
    : await exists(join(path, 'yarn.lock')) ? 'yarn'
    : await exists(join(path, 'bun.lockb')) || await exists(join(path, 'bun.lock')) ? 'bun' : 'npm'

  let framework = 'Node'
  let suggestedUrl = 'http://localhost:3000'
  if (dependencies.expo) framework = 'Expo · React Native'
  else if (dependencies.next) framework = 'Next.js · React'
  else if (dependencies.astro) framework = 'Astro'
  else if (dependencies['@sveltejs/kit'] || dependencies.svelte) framework = 'Svelte'
  else if (dependencies.vue) framework = 'Vue'
  else if (dependencies.vite && dependencies.react) { framework = 'React · Vite'; suggestedUrl = 'http://localhost:5173' }
  else if (dependencies.vite) { framework = 'Vite'; suggestedUrl = 'http://localhost:5173' }
  else if (dependencies.react) framework = 'React'
  const hasSupabase = await exists(join(path, 'supabase/config.toml')) || Boolean(dependencies['@supabase/supabase-js'])
  if (hasSupabase && !framework.includes('Supabase')) framework += ' · Supabase'
  if (await exists(join(path, 'tsconfig.json')) && !framework.includes('TypeScript')) framework += ' · TypeScript'

  const script = scripts.includes('dev') ? 'dev' : scripts.includes('start') ? 'start' : scripts[0]
  const suggestedCommand = dependencies.expo && !script ? 'npx expo start' : !script ? '' : packageManager === 'npm' ? `npm run ${script}` : `${packageManager} ${script}`
  return { name: packageJson.name || basename(path), framework, packageManager, scripts, suggestedCommand, suggestedUrl }
}
