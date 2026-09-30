import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)

const RUNTIME_PACKAGES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent-default-model',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-native-command',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/schemastery',
] as const

const SUPPORTED_RUNTIME_FAMILIES = [
  {
    cli: '0.1.2-rc.1',
    versions: {
      '@deepseek-ai/cordis': '4.0.2',
      '@deepseek-ai/dsh-agent-default-model': '0.1.2-rc.1',
      '@deepseek-ai/dsh-client-ui-conversation': '0.1.2-rc.1',
      '@deepseek-ai/dsh-llm': '0.1.2-rc.1',
      '@deepseek-ai/dsh-native-command': '0.1.2-rc.1',
      '@deepseek-ai/dsh-session': '0.1.2-rc.1',
      '@deepseek-ai/dsh-settings': '0.1.2-rc.1',
      '@deepseek-ai/dsh-system-prompt': '0.1.2-rc.1',
      '@deepseek-ai/dsh-tools': '0.1.2-rc.1',
      '@deepseek-ai/schemastery': '3.18.2',
    },
  },
  {
    cli: '0.1.5-rc.1',
    versions: {
      '@deepseek-ai/cordis': '4.0.2',
      '@deepseek-ai/dsh-agent-default-model': '0.1.5-rc.2',
      '@deepseek-ai/dsh-client-ui-conversation': '0.1.5-rc.2',
      '@deepseek-ai/dsh-llm': '0.1.5-rc.2',
      '@deepseek-ai/dsh-native-command': '0.1.5-rc.2',
      '@deepseek-ai/dsh-session': '0.1.5-rc.2',
      '@deepseek-ai/dsh-settings': '0.1.5-rc.2',
      '@deepseek-ai/dsh-system-prompt': '0.1.5-rc.2',
      '@deepseek-ai/dsh-tools': '0.1.5-rc.2',
      '@deepseek-ai/schemastery': '3.18.2',
    },
  },
  {
    cli: '0.1.6-alpha.1',
    versions: {
      '@deepseek-ai/cordis': '4.0.2',
      '@deepseek-ai/dsh-agent-default-model': '0.1.6-alpha.1',
      '@deepseek-ai/dsh-client-ui-conversation': '0.1.6-alpha.1',
      '@deepseek-ai/dsh-llm': '0.1.6-alpha.1',
      '@deepseek-ai/dsh-native-command': '0.1.6-alpha.1',
      '@deepseek-ai/dsh-session': '0.1.6-alpha.1',
      '@deepseek-ai/dsh-settings': '0.1.6-alpha.1',
      '@deepseek-ai/dsh-system-prompt': '0.1.6-alpha.1',
      '@deepseek-ai/dsh-tools': '0.1.6-alpha.1',
      '@deepseek-ai/schemastery': '3.18.2',
    },
  },
  {
    cli: '0.1.7-rc.1',
    versions: {
      '@deepseek-ai/cordis': '4.0.4',
      '@deepseek-ai/dsh-agent-default-model': '0.1.7-rc.1',
      '@deepseek-ai/dsh-client-ui-conversation': '0.1.7-rc.1',
      '@deepseek-ai/dsh-llm': '0.1.7-rc.1',
      '@deepseek-ai/dsh-native-command': '0.1.7-rc.1',
      '@deepseek-ai/dsh-session': '0.1.7-rc.1',
      '@deepseek-ai/dsh-settings': '0.1.7-rc.1',
      '@deepseek-ai/dsh-system-prompt': '0.1.7-rc.1',
      '@deepseek-ai/dsh-tools': '0.1.7-rc.1',
      '@deepseek-ai/schemastery': '3.18.4',
    },
  },
  {
    cli: '0.1.7-rc.2',
    versions: {
      '@deepseek-ai/cordis': '4.0.4',
      '@deepseek-ai/dsh-agent-default-model': '0.1.7-rc.2',
      '@deepseek-ai/dsh-client-ui-conversation': '0.1.7-rc.2',
      '@deepseek-ai/dsh-llm': '0.1.7-rc.2',
      '@deepseek-ai/dsh-native-command': '0.1.7-rc.2',
      '@deepseek-ai/dsh-session': '0.1.7-rc.2',
      '@deepseek-ai/dsh-settings': '0.1.7-rc.2',
      '@deepseek-ai/dsh-system-prompt': '0.1.7-rc.2',
      '@deepseek-ai/dsh-tools': '0.1.7-rc.2',
      '@deepseek-ai/schemastery': '3.18.4',
    },
  },
] as const

export interface DshRuntimeCompatibility {
  cliVersion: string
  packageVersions: Readonly<Record<string, string>>
}

export type DshRuntimePackageVersions = Readonly<Record<(typeof RUNTIME_PACKAGES)[number], string>>

export const STRATAGATE_MESSAGE_SOURCE_KIND = 'plugin:stratagate-memory' as const

/** Match >=0.2.0-0 <0.2.1-0 without adding a runtime semver dependency. */
function isDsh020Version(version: string): boolean {
  const match = /^0\.2\.0(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(version)
  if (!match) return false
  const prerelease = match[1]?.split('.') ?? []
  const build = match[2]?.split('.') ?? []
  return [...prerelease, ...build].every((part) => part.length > 0)
    && prerelease.every((part) => !/^\d+$/.test(part) || part === '0' || !part.startsWith('0'))
}

export function buildDshMessageSource(
  version: string,
  form?: 'instructions' | 'catalog' | 'snapshot' | 'notice' | 'relay' | 'recall',
): any {
  const source = /^0\.1\.7(?:-|$)/.test(version) || isDsh020Version(version)
    ? { kind: STRATAGATE_MESSAGE_SOURCE_KIND }
    : { kind: 'plugin', plugin: 'stratagate-memory' }
  return form ? { ...source, form } : source
}

function installedVersion(packageName: string): string {
  try {
    const manifestPath = nodeRequire.resolve(`${packageName}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
    if (typeof manifest.version === 'string' && manifest.version.length > 0) return manifest.version
  } catch {}
  return '<missing>'
}

export function buildDshReplaceSurfaceOp(version: string, start: number, end: number): any {
  return version === '0.1.2-rc.1'
    ? { op: 'replace', start, end }
    : { op: 'replace', startSeq: start, endSeq: end }
}

export function dshReplaceSurfaceOp(start: number, end: number): any {
  return buildDshReplaceSurfaceOp(installedVersion('@deepseek-ai/dsh-session'), start, end)
}

export function dshMessageSource(
  form?: 'instructions' | 'catalog' | 'snapshot' | 'notice' | 'relay' | 'recall',
): any {
  return buildDshMessageSource(installedVersion('@deepseek-ai/dsh-session'), form)
}

export function isStrataGateMessageSource(source: unknown): boolean {
  if (!source || typeof source !== 'object') return false
  const value = source as { kind?: unknown; plugin?: unknown }
  return value.kind === STRATAGATE_MESSAGE_SOURCE_KIND
    || (value.kind === 'plugin' && value.plugin === 'stratagate-memory')
}

function isCompatiblePatch(version: string, major: number, minor: number, minimumPatch: number): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  return !!match
    && Number(match[1]) === major
    && Number(match[2]) === minor
    && Number(match[3]) >= minimumPatch
}

/**
 * Fail before registering services when a profile-local peer tree shadows the
 * DSH installation. A mixed tree otherwise fails later as an empty conversation
 * surface with unrelated missing-service or method errors.
 */
export function classifyDshRuntime(packageVersions: DshRuntimePackageVersions): DshRuntimeCompatibility {
  const family = SUPPORTED_RUNTIME_FAMILIES.find(({ versions }) => (
    RUNTIME_PACKAGES.every((name) => packageVersions[name] === versions[name])
  ))
  if (family) return { cliVersion: family.cli, packageVersions }

  const dshVersion = packageVersions['@deepseek-ai/dsh-session']
  const sameDshFamily = RUNTIME_PACKAGES
    .filter((name) => name.startsWith('@deepseek-ai/dsh-'))
    .every((name) => packageVersions[name] === dshVersion)
  if ((/^0\.1\.7-rc\.[1-9]\d*$/.test(dshVersion) || dshVersion === '0.1.7' || isDsh020Version(dshVersion))
    && sameDshFamily
    && isCompatiblePatch(packageVersions['@deepseek-ai/cordis'], 4, 0, 4)
    && isCompatiblePatch(packageVersions['@deepseek-ai/schemastery'], 3, 18, 4)) {
    return { cliVersion: dshVersion, packageVersions }
  }

  const found = RUNTIME_PACKAGES.map((name) => `${name}@${packageVersions[name]}`).join(', ')
  throw new Error(
    'StrataGate cannot start because this DSH profile resolves an unsupported or mixed core runtime. '
    + `Resolved: ${found}. Supported hosts are @deepseek-ai/dsh@0.1.2-rc.1 `
    + '(internal DSH packages 0.1.2-rc.1) and @deepseek-ai/dsh@0.1.5-rc.1 '
    + '(its real dependency tree uses internal DSH packages 0.1.5-rc.2), and '
    + '@deepseek-ai/dsh@0.1.6-alpha.1 (internal DSH packages 0.1.6-alpha.1), and '
    + 'the coherent DSH 0.1.7 family from rc.1 through the 0.1.7 release, and '
    + 'the complete DSH 0.2.0 family (all alpha, beta, rc, and stable versions; >=0.2.0-0 <0.2.1-0) '
    + '(Cordis 4.0.x from 4.0.4, Schemastery 3.18.x from 3.18.4). '
    + 'Reinstall or update stratagate-dsh through `dsh plugin --profile <name> add <package>` so the host supplies its peers.',
  )
}

export function assertCompatibleDshRuntime(): DshRuntimeCompatibility {
  const packageVersions = Object.fromEntries(RUNTIME_PACKAGES.map((name) => [name, installedVersion(name)])) as DshRuntimePackageVersions
  return classifyDshRuntime(packageVersions)
}
