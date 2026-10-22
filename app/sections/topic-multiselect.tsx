'use client'

import * as React from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { DOMAINS } from '@/lib/taxonomy'
import type { SkillDomain, SkillTopic } from '@/app/sections/skill-map-section'

// Domain-grouped topic checklist with a filter box, shared by the assessment picker and the code-practice topic picker.
// The parent owns the selection (a Set of "<domain>/<topic>" keys) and decides what toggling means (domain-only mode, a cap ...).
export const assessed = (topic?: SkillTopic) => topic?.state === 'active'
export const bandStyle = (level: string) => level === 'Advanced' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : level === 'Intermediate' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-muted text-muted-foreground'

/** Skill-map info per "<domain>/<topic>" key (empty for sample data, which has no real ratings). */
export function skillInfo(skillDomains: SkillDomain[], sampleData: boolean) {
  const map = new Map<string, SkillTopic>()
  if (!sampleData) for (const domain of skillDomains) for (const topic of domain.topics) map.set(`${domain.id}/${topic.id}`, topic)
  return map
}

type Props = {
  skillDomains: SkillDomain[]
  sampleData: boolean
  selected: Set<string>
  onToggleTopic: (key: string) => void
  onToggleDomain: (domainId: string, keys: string[]) => void
  open: Set<string>
  onOpenChange: (next: Set<string>) => void
  query: string
  onQueryChange: (value: string) => void
  toolbar?: React.ReactNode // preset buttons next to the filter box
  idPrefix: string // keeps element ids unique when two lists are mounted over time
  maxSelected?: number // unchecked topics are disabled once this many are selected
  maxHint?: string
}

export default function TopicMultiSelect({ skillDomains, sampleData, selected, onToggleTopic, onToggleDomain, open, onOpenChange, query, onQueryChange, toolbar, idPrefix, maxSelected, maxHint }: Props) {
  const info = React.useMemo(() => skillInfo(skillDomains, sampleData), [skillDomains, sampleData])
  const needle = query.trim().toLowerCase()
  const atCap = maxSelected !== undefined && selected.size >= maxSelected
  const matches = (domainLabel: string, topic: { label: string; subtopics: string[] }) => `${topic.label} ${topic.subtopics.join(' ')}`.toLowerCase().includes(needle) || domainLabel.toLowerCase().includes(needle)
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Filter topics" aria-label="Filter topics" className="min-h-10 rounded-xl pl-9" />
        </div>
        {toolbar && <div className="flex flex-wrap gap-2">{toolbar}</div>}
      </div>
      {maxHint && <p className="text-xs leading-5 text-muted-foreground" aria-live="polite">{maxHint}</p>}

      {DOMAINS.map((domain) => {
        const rows = domain.topics.map((topic) => ({ topic, key: `${domain.id}/${topic.id}`, skill: info.get(`${domain.id}/${topic.id}`) }))
        const shown = needle ? rows.filter((row) => matches(domain.label, row.topic)) : rows
        if (shown.length === 0) return null
        const keys = rows.map((row) => row.key)
        const picked = keys.filter((key) => selected.has(key)).length
        const expanded = needle ? true : open.has(domain.id)
        const regionId = `${idPrefix}-${domain.id}`
        const domainSkill = skillDomains.find((entry) => entry.id === domain.id)
        return (
          <section key={domain.id} className="rounded-3xl border border-border/70 bg-muted/35 shadow-sm">
            <div className="flex items-center gap-3 px-4 py-3">
              <input type="checkbox" aria-label={`Select all ${domain.label} topics`} checked={picked === keys.length} disabled={maxSelected !== undefined && picked === 0 && atCap} ref={(element) => { if (element) element.indeterminate = picked > 0 && picked < keys.length }} onChange={() => onToggleDomain(domain.id, keys)} className="h-4 w-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50" />
              <button type="button" aria-expanded={expanded} aria-controls={regionId} onClick={() => { const next = new Set(open); if (next.has(domain.id)) next.delete(domain.id); else next.add(domain.id); onOpenChange(next) }} className="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0"><span className="block text-base font-semibold">{domain.label}</span><span className="block text-xs text-muted-foreground"><span>{picked} of {domain.topics.length} selected</span>{!sampleData && domainSkill && domainSkill.level !== 'Not started' && <span> · {domainSkill.level}</span>}</span></span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {expanded && (
              <ul id={regionId} className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
                {shown.map(({ topic, key, skill }) => {
                  const on = selected.has(key)
                  const blocked = !on && atCap
                  const inputId = `${idPrefix}-pick-${key.replace('/', '-')}`
                  return (
                    <li key={key}>
                      <label htmlFor={inputId} className={`flex min-h-12 items-center gap-3 rounded-2xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring ${blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${on ? 'border-primary bg-background shadow-sm' : 'border-border/70 bg-card hover:border-primary/50'}`}>
                        <input id={inputId} type="checkbox" checked={on} disabled={blocked} onChange={() => onToggleTopic(key)} className="h-4 w-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed" />
                        <span className="min-w-0 flex-1 text-sm font-medium leading-5">{topic.label}</span>
                        {assessed(skill) ? <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] tabular-nums ${bandStyle(skill!.level)}`}>{skill!.level} {Math.round(skill!.score)}%</span> : <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{skill?.level === 'Learned' ? 'Learned' : 'New'}</span>}
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
      {needle && DOMAINS.every((domain) => !domain.topics.some((topic) => matches(domain.label, topic))) && <p className="rounded-2xl bg-muted/60 p-5 text-sm text-muted-foreground">No topic matches this filter.</p>}
    </div>
  )
}
