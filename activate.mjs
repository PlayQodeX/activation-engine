#!/usr/bin/env node
// activation-engine/activate.mjs — read the persisted index and activate the FULL
// operating stack (rules + guidelines + coordination + memory + skills) that
// applies to a target folder/repo/workspace. Requires a prior `node scan.mjs`.
//
// Usage:
//   node activate.mjs                    # activate for the current folder (cwd)
//   node activate.mjs d:\code\myapp      # activate for a specific folder
//   node activate.mjs --instance <name>  # activate a curated instance (bundle)
//   node activate.mjs --json             # machine output
//   node activate.mjs --list             # show the saved index summary (+ staleness)
//
// Exit: 0 ok · 2 no index yet (run scan) · 3 target path missing · 4 no such instance.

import fs from 'node:fs'
import path from 'node:path'
import {
  HOME, INDEX_JSON, INDEX_MD, CMD_PREFIX, exists, read, isUnder, slugOf, rel,
  readInstance, listInstances,
} from './lib/common.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const asJson = flag('--json')
const listMode = flag('--list') || flag('--status')
const instanceName = opt('--instance')
// in normal mode, first non-flag arg is the target; ignore the --instance value.
const rawTarget = args.filter((a) => !a.startsWith('--') && a !== instanceName)[0] ?? process.cwd()

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
  L.push('activation-engine — saved index')
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

// shared helper: nearest project memory for a folder (ancestor walk, case-insensitive)
const ancestorsOf = (p) => {
  const out = []
  let cur = path.resolve(p)
  for (;;) { out.push(cur); const par = path.dirname(cur); if (par === cur) break; cur = par }
  return out
}
function memoryFor(dir) {
  for (const a of ancestorsOf(dir)) {
    const s = slugOf(a)
    const hit = (index.global?.memory || []).find((m) => m.project.toLowerCase() === s)
    if (hit) return hit
  }
  const base = path.basename(dir).toLowerCase()
  return (index.global?.memory || [])
    .filter((m) => m.project.toLowerCase().includes(base))
    .sort((x, y) => y.project.length - x.project.length)[0] || null
}
// find an indexed skill (global | workspace | plugin) by name, case-insensitive
function findSkill(name) {
  const n = name.toLowerCase()
  const g = (index.global?.skills || []).find((s) => s.name.toLowerCase() === n)
  if (g) return { name: g.name, where: 'global', dir: g.dir }
  const w = (index.workspaceSkills || []).find((s) => s.name.toLowerCase() === n)
  if (w) return { name: w.name, where: 'workspace', dir: w.dir }
  const p = (index.global?.pluginSkills || []).find((s) => s.name.toLowerCase() === n)
  if (p) return { name: p.name, where: 'plugin', dir: p.dir }
  return null
}
// classify a guideline/rule entry: existing file, memory-file slug, or literal
function classifyRef(ref) {
  const abs = path.resolve(ref)
  if (exists(abs)) return { ref, kind: 'file', path: abs }
  for (const m of index.global?.memory || []) {
    const cand = path.join(path.dirname(m.path), ref.endsWith('.md') ? ref : ref + '.md')
    if (exists(cand)) return { ref, kind: 'memory', path: cand }
  }
  return { ref, kind: 'literal' }
}

// ---- --instance <name> : activate a curated bundle --------------------------
if (instanceName) {
  const inst = readInstance(instanceName)
  if (!inst) {
    console.error(`[activate] no such instance: ${instanceName}`)
    const all = listInstances()
    console.error(all.length ? `           available: ${all.map((i) => i.slug).join(', ')}` : '           (none yet — create one with instance.mjs create <name>)')
    process.exit(4)
  }
  const scope = opt('--path') ? path.resolve(opt('--path')) : (inst.roots?.[0] || process.cwd())
  const skills = (inst.skills || []).map((s) => ({ name: s, hit: findSkill(s) }))
  const rules = (inst.rules || []).map(classifyRef)
  const guidelines = (inst.guidelines || []).map(classifyRef)
  const mem = memoryFor(scope)
  const coord = (index.coordFiles || []).filter((c) => isUnder(scope, path.dirname(c.path)))

  const out = {
    instance: inst.name, slug: inst.slug, purpose: inst.purpose || '',
    scope, staleness, skills, rules, guidelines, memory: mem?.path || null, coordFiles: coord,
    missing: {
      skills: skills.filter((s) => !s.hit).map((s) => s.name),
      rules: rules.filter((r) => r.kind === 'literal').map((r) => r.ref),
    },
  }
  if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(0) }

  const I = []
  I.push(`ACTIVATE INSTANCE — ${inst.name}   (/${CMD_PREFIX}${inst.slug})`)
  I.push('='.repeat(60))
  if (inst.purpose) I.push(`purpose : ${inst.purpose}`)
  I.push(`scope   : ${scope}`)
  I.push(`index   : ${staleness}${ageDays >= 7 ? '  ⚠ stale — /activate scan' : ''}`)
  I.push('')
  I.push(`CURATED SKILLS (${skills.length}):`)
  for (const s of skills) I.push(`  - ${s.hit ? `[${s.hit.where}]` : '[MISSING]'} ${s.name}${s.hit?.dir ? '  ' + rel(s.hit.dir) : ''}`)
  if (!skills.length) I.push('  (none)')
  I.push('')
  I.push(`CURATED RULES (${rules.length}):`)
  for (const r of rules) I.push(`  - [${r.kind}] ${r.kind === 'literal' ? r.ref : rel(r.path)}`)
  if (!rules.length) I.push('  (none)')
  I.push('')
  I.push(`CURATED GUIDELINES (${guidelines.length}):`)
  for (const g of guidelines) I.push(`  - [${g.kind}] ${g.kind === 'literal' ? g.ref : rel(g.path)}`)
  if (!guidelines.length) I.push('  (none)')
  I.push('')
  I.push(`SCOPE MEMORY : ${mem ? rel(mem.path) : '(none matched)'}`)
  I.push(`COORDINATION : ${coord.length ? coord.map((c) => `[${c.kind}] ${rel(c.path)}`).join('  ') : '(none)'}`)
  if (out.missing.skills.length) I.push(`\n⚠ missing skills (not on this PC's index): ${out.missing.skills.join(', ')}`)
  I.push('\nNext: load the listed rules/guidelines broad→narrow, apply the curated skills, run the mandatory pre-flight gates.')
  console.log(I.join('\n'))
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

// project memory via shared resolver (ancestor walk, case-insensitive slug) so a
// git submodule inherits its superproject's memory.
const memory = memoryFor(target)

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
