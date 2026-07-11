#!/usr/bin/env node
// skill-activation/activate.mjs — read the persisted index and activate the FULL
// operating stack (rules + guidelines + coordination + memory + skills) that
// applies to a target folder/repo/workspace. Requires a prior `node scan.mjs`.
//
// Usage:
//   node activate.mjs                 # activate for the current folder (cwd)
//   node activate.mjs d:\code\myapp   # activate for a specific folder
//   node activate.mjs --json          # machine output
//   node activate.mjs --list          # show the saved index summary (+ staleness)
//
// Exit: 0 ok · 2 no index yet (run scan) · 3 target path missing.

import fs from 'node:fs'
import path from 'node:path'
import {
  HOME, INDEX_JSON, INDEX_MD, exists, read, isUnder, slugOf, rel,
} from './lib/common.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const asJson = flag('--json')
const listMode = flag('--list') || flag('--status')
const rawTarget = args.find((a) => !a.startsWith('--')) ?? process.cwd()

if (!exists(INDEX_JSON)) {
  console.error('[activate] no index found. Run the scan first:')
  console.error(`           node "${path.join(path.dirname(new URL(import.meta.url).pathname), 'scan.mjs')}"`)
  console.error('           (or: /activate scan)')
  process.exit(2)
}

const index = JSON.parse(read(INDEX_JSON))
const ageMs = Date.now() - Date.parse(index.scannedAt)
const ageDays = ageMs / 86400000
const staleness = ageDays >= 1 ? `${ageDays.toFixed(1)}d old` : `${(ageMs / 3600000).toFixed(1)}h old`

// ---- --list / --status ------------------------------------------------------
if (listMode) {
  if (asJson) { console.log(JSON.stringify({ ...index, staleness }, null, 2)); process.exit(0) }
  const L = []
  L.push('skill-activation — saved index')
  L.push('='.repeat(50))
  L.push(`scanned : ${index.scannedAt}  (${staleness})`)
  L.push(`host    : ${index.host} (${index.platform})`)
  L.push(`roots   : ${index.roots.map(rel).join(', ')}  (depth ${index.depth})`)
  L.push('')
  for (const [k, v] of Object.entries(index.stats)) L.push(`  ${k.padEnd(16)} ${v}`)
  L.push('')
  L.push(`Human mirror: ${rel(INDEX_MD)}`)
  if (ageDays >= 7) L.push(`\n⚠ index is ${staleness} — consider re-scanning (/activate scan).`)
  console.log(L.join('\n'))
  process.exit(0)
}

// ---- activate for a target --------------------------------------------------
const target = path.resolve(rawTarget)
if (!exists(target)) { console.error(`[activate] target does not exist: ${target}`); process.exit(3) }

// repo root = longest indexed git root that contains the target
const repoRoot = (index.gitRoots || [])
  .filter((r) => isUnder(target, r))
  .sort((a, b) => b.length - a.length)[0] || target

// rule stack: global first, then indexed rule files whose dir contains the target,
// ordered broad -> narrow so the most specific layer wins on conflict.
const ancestorRuleFiles = (index.ruleFiles || [])
  .filter((r) => isUnder(target, path.dirname(r.path)))
  .sort((a, b) => path.dirname(a.path).length - path.dirname(b.path).length)

const ruleStack = []
if (index.global?.claudeMd) ruleStack.push({ scope: 'global', kind: 'CLAUDE.md', path: index.global.claudeMd })
if (index.global?.rtkMd) ruleStack.push({ scope: 'global', kind: 'RTK.md', path: index.global.rtkMd })
for (const r of ancestorRuleFiles) {
  ruleStack.push({ scope: path.dirname(r.path) === target ? 'target' : (path.dirname(r.path) === repoRoot ? 'repo' : 'app'), kind: r.kind, path: r.path })
}

// coordination files under the target's tree
const coordFiles = (index.coordFiles || []).filter((c) => isUnder(target, path.dirname(c.path)))

// project memory: match target then each ancestor (narrow -> broad) so a git
// submodule inherits its superproject's memory (memory lives at the repo root
// where Claude was launched, not necessarily the innermost git root).
const ancestorsOf = (p) => {
  const out = []
  let cur = path.resolve(p)
  for (;;) { out.push(cur); const par = path.dirname(cur); if (par === cur) break; cur = par }
  return out
}
let memory = null
for (const dir of ancestorsOf(target)) {
  const s = slugOf(dir) // already lowercased; project dir casing varies on disk
  const hit = (index.global?.memory || []).find((m) => m.project.toLowerCase() === s)
  if (hit) { memory = hit; break }
}
if (!memory) {
  const base = path.basename(repoRoot).toLowerCase()
  memory = (index.global?.memory || [])
    .filter((m) => m.project.toLowerCase().includes(base))
    .sort((a, b) => b.project.length - a.project.length)[0]
}

// workspace skills reachable from target: skill whose owning project dir either
// contains the target or lives under the repo root.
const projectDirOf = (skillDir) => skillDir.split(/[\\/]\.claude[\\/]skills[\\/]/)[0]
const workspaceSkills = (index.workspaceSkills || []).filter((s) => {
  const pd = projectDirOf(s.dir)
  return isUnder(target, pd) || isUnder(pd, repoRoot)
})

const result = {
  target, repoRoot, scannedAt: index.scannedAt, staleness,
  ruleStack, coordFiles, memory: memory?.path || null,
  skills: {
    workspace: workspaceSkills,
    global: index.global?.skills || [],
    plugin: (index.global?.pluginSkills || []).map((s) => s.name),
    commands: index.global?.commands || [],
  },
}

if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(0) }

// ---- human report -----------------------------------------------------------
const L = []
L.push('ACTIVATE — workspace bootstrap (from saved index)')
L.push('='.repeat(60))
L.push(`target    : ${target}`)
L.push(`repo root : ${repoRoot}`)
L.push(`index age : ${staleness}${ageDays >= 7 ? '  ⚠ stale — /activate scan' : ''}`)
L.push('')
L.push('RULE / GUIDELINE STACK  (read broad -> narrow; specific wins):')
for (const r of ruleStack) L.push(`  [${r.scope.padEnd(6)}] ${r.kind.padEnd(10)} ${rel(r.path)}`)
L.push(`  [memory] ${'MEMORY.md'.padEnd(10)} ${memory ? rel(memory.path) : '(none matched)'}`)
L.push('')
L.push('COORDINATION / STATE FILES:')
for (const c of coordFiles) L.push(`  - [${c.kind}] ${rel(c.path)}`)
if (!coordFiles.length) L.push('  (none)')
L.push('')
L.push(`WORKSPACE SKILLS reachable here (${workspaceSkills.length}):`)
for (const s of workspaceSkills) L.push(`  - ${s.name}  (${rel(s.dir)})`)
if (!workspaceSkills.length) L.push('  (none)')
L.push('')
L.push(`GLOBAL SKILLS (${result.skills.global.length}): ${result.skills.global.map((s) => s.name).join(', ')}`)
L.push('')
L.push(`PLUGIN SKILLS (${result.skills.plugin.length}): ${result.skills.plugin.join(', ') || '(none)'}`)
if (result.skills.commands.length) L.push(`\nGLOBAL COMMANDS: ${result.skills.commands.join(', ')}`)
console.log(L.join('\n'))
