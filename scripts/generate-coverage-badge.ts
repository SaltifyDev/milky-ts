import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface CoverageSummary {
  total?: {
    lines?: {
      pct?: number
    }
  }
}

interface BadgePayload {
  schemaVersion: 1
  label: string
  message: string
  color: string
}

const repoRoot = process.cwd()
const summaryPath = resolve(repoRoot, 'coverage/coverage-summary.json')
const outputPath = resolve(repoRoot, 'coverage/coverage-badge.json')

function getColor(coverage: number): string {
  if (coverage >= 95) {
    return 'brightgreen'
  }

  if (coverage >= 90) {
    return 'green'
  }

  if (coverage >= 80) {
    return 'yellow'
  }

  return 'red'
}

async function main(): Promise<void> {
  const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as CoverageSummary
  const coverage = summary.total?.lines?.pct

  if (typeof coverage !== 'number' || Number.isNaN(coverage)) {
    throw new TypeError(`Could not read total.lines.pct from ${summaryPath}`)
  }

  const rounded = Number(coverage.toFixed(2))
  const badge: BadgePayload = {
    schemaVersion: 1,
    label: 'coverage',
    message: `${rounded}%`,
    color: getColor(rounded),
  }

  await mkdir(resolve(repoRoot, 'coverage'), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(badge, null, 2)}\n`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
