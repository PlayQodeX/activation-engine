#!/usr/bin/env node
// activation-engine/activate.mjs — read the persisted index and activate the FULL
// operating stack (rules + guidelines + coordination + memory + skills) that
// applies to a target folder/repo/workspace. Requires a prior `node scan.mjs`.
//
// Usage:
//   node activate.mjs                    # activate for the current folder (cwd)
//   node activate.mjs d:\code\myapp      # activate for a specific folder
//   node activate.mjs --instance <name>  # activate a curated instance (bundle)
//   node activate.mjs --default          # activate this repo's default instance
//   node activate.mjs --json             # machine output
//   node activate.mjs --list             # show the saved index summary (+ staleness)
//
// Exit: 0 ok · 2 no index (run scan) · 3 target missing · 4 no such instance · 5 no default.

import path from 'node:path'
import {
  INDEX_JSON, INDEX_MD, STATE_DIR, CMD_PREFIX, HELP_TEXT, exists, read, isUnder, slugOf, rel,
  readInstance, listInstances, readState, writeState,
  resolveWorkspace, memoryFor, findSkill, classifyRef, writeHelpDocs,
} from './lib/common.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const asJson = flag('--json')
const listMode = flag('--list') || flag('--status')
let instanceName = opt('--instance')
const useDefault = flag('--default')
const rawTarget = args.filter((a) => !a.startsWith('--') && a !== instanceName)[0] ?? process.cwd()

// ---- help (no index required; single shared source) ------------------------
if (flag('--help') || flag('-h') || args[0] === 'help') {
  console.log(HELP_TEXT)
  if (flag('--write')) {
    const out = writeHelpDocs(opt('--out') ? path.resolve(opt('--out')) : STATE_DIR)
    console.log(`\nFormatted reference written:\n  ${rel(out.md)}\n  ${rel(out.html)}  (open in a browser)`)
  }
  process.exit(0)
}

if (!exists(INDEX_JSON)) {
  console.error('[activate] no index found. Run the scan first:')
  console.error(`           node "${path.join(path.dirname(new URL(import.meta.url).pathname), 'scan.mjs')}"  (or: /activate scan)`)
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
  for (const [k, v] of Object.entries(index.stats)) L.push(`  ${k.padEnd(20)} ${v}`)
  if (index.newSinceLastScan?.length) L.push(`\n  new since last scan: ${index.newSinceLastScan.join(', ')}`)
  L.push('')
  L.push(`Human mirror: ${rel(INDEX_MD)}`)
  if (ageDays >= 7) L.push(`\n⚠ index is ${staleness} — consider re-scanning (/activate scan).`)
  console.log(L.join('\n'))
  process.exit(0)
}

// ---- --default : resolve this repo's default instance -> instance mode ------
if (useDefault && !instanceName) {
  const { repoRoot } = resolveWorkspace(index, rawTarget)
  const st = readState()
  instanceName = st.defaults?.[slugOf(repoRoot)] || st.defaults?.['*']
  if (!instanceName) {
    console.error(`[activate] no default instance set for ${repoRoot}`)
    console.error('           set one: node instance.mjs default <name> [--for <path> | --global]')
    process.exit(5)
  }
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
  const skills = (inst.skills || []).map((s) => ({ name: s, hit: findSkill(index, s) }))
  const rules = (inst.rules || []).map((r) => classifyRef(index, r))
  const guidelines = (inst.guidelines || []).map((g) => classifyRef(index, g))
  const mem = memoryFor(index, scope)
  const coord = (index.coordFiles || []).filter((c) => isUnder(scope, path.dirname(c.path)))

  const missingSkills = skills.filter((s) => !s.hit).map((s) => s.name)
  const untrusted = skills.filter((s) => s.hit && !s.hit.trusted).map((s) => s.name)
  const fresh = skills.filter((s) => s.hit && s.hit.isNew).map((s) => s.name)

  // record last-used instance (per-machine state)
  const st = readState(); st.last = inst.slug; st.lastAt = new Date().toISOString(); writeState(st)

  const out = {
    instance: inst.name, slug: inst.slug, purpose: inst.purpose || '',
    scope, staleness, skills, rules, guidelines, memory: mem?.path || null, coordFiles: coord,
    warnings: { missingSkills, untrusted, new: fresh },
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
  for (const s of skills) {
    const tags = s.hit ? `[${s.hit.where}]${s.hit.trusted ? '' : ' ⚠untrusted'}${s.hit.isNew ? ' ✦new' : ''}` : '[MISSING]'
    I.push(`  - ${tags} ${s.name}${s.hit?.dir ? '  ' + rel(s.hit.dir) : ''}`)
  }
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
  // ambient toolbox — always available regardless of what the instance curates
  const ambientG = (index.global?.skills || []).map((s) => s.name)
  const ambientP = (index.global?.pluginSkills || []).map((s) => s.name)
  I.push('')
  I.push(`ALSO AVAILABLE (ambient — always on, not curated):`)
  I.push(`  global skills (${ambientG.length}): ${ambientG.join(', ') || '(none)'}`)
  I.push(`  plugin skills (${ambientP.length}, untrusted by default): ${ambientP.join(', ') || '(none)'}`)
  if (missingSkills.length) I.push(`\n⚠ missing skills (not on this PC's index): ${missingSkills.join(', ')}`)
  if (untrusted.length) I.push(`⚠ untrusted skills (third-party/plugin — vet before use): ${untrusted.join(', ')}`)
  if (fresh.length) I.push(`✦ new since last scan (review): ${fresh.join(', ')}`)
  I.push('\nNext: load the listed rules/guidelines broad→narrow, apply the curated skills, run the mandatory pre-flight gates.')
  console.log(I.join('\n'))
  process.exit(0)
}

// ---- activate for a target --------------------------------------------------
const target = path.resolve(rawTarget)
if (!exists(target)) { console.error(`[activate] target does not exist: ${target}`); process.exit(3) }

const { repoRoot, ruleStack, coordFiles, memory, workspaceSkills } = resolveWorkspace(index, target)

// default-instance hint for this repo
const st = readState()
const defSlug = st.defaults?.[slugOf(repoRoot)] || st.defaults?.['*'] || null

const result = {
  target, repoRoot, scannedAt: index.scannedAt, staleness,
  ruleStack, coordFiles, memory: memory?.path || null,
  defaultInstance: defSlug,
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
if (defSlug) L.push(`default   : ${defSlug}   (activate with /${CMD_PREFIX}${defSlug} or --default)`)
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
L.push(`PLUGIN SKILLS (${result.skills.plugin.length}, untrusted by default): ${result.skills.plugin.join(', ') || '(none)'}`)
if (result.skills.commands.length) L.push(`\nGLOBAL COMMANDS: ${result.skills.commands.join(', ')}`)
console.log(L.join('\n'))
