'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Bot, CheckCircle2, CircleUserRound, FileClock, Info, Loader2, Play, Settings, ShieldCheck, UserRound } from 'lucide-react'
import type { useAuth } from 'lyzr-architect-pg/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import type { HomeAttempt } from '@/app/sections/home-section'
import type { JsonRecord } from '@/lib/app-types'
import { AssessmentHistoryList, AssessmentReview, type HistoryActions } from '@/app/sections/assessment-history'
import { publishAiProvider } from '@/hooks/use-ai-provider'
import { numberValue, recordValue, stringValue } from '@/lib/normalize'

export function HistoryPanel({ attempts, sampleData, authFetch, review, onReview, actions, onBackToResult, onBack, onPractice }: { attempts: HomeAttempt[]; sampleData: boolean; authFetch: ReturnType<typeof useAuth>['authFetch']; review: { id: string; from: 'history' | 'result' } | null; onReview: (review: { id: string; from: 'history' | 'result' } | null) => void; actions: HistoryActions; onBackToResult: () => void; onBack: () => void; onPractice: () => void }) {
  if (review) return <AssessmentReview authFetch={authFetch} sessionId={review.id} actions={actions} backLabel={review.from === 'result' ? 'Back to results' : 'Back to history'} onBack={() => review.from === 'result' ? onBackToResult() : onReview(null)} />
  return <div className="mx-auto w-full max-w-5xl space-y-7 pb-10"><div className="flex flex-col gap-4 border-b border-border/70 pb-7 sm:flex-row sm:items-end sm:justify-between"><div><button onClick={onBack} className="mb-3 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowRight className="h-4 w-4 rotate-180" />Back to home</button><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Evidence trail</div><h1 className="mt-3 font-serif text-4xl tracking-tight">Your practice and assessment history.</h1><p className="mt-3 max-w-2xl text-pretty leading-7 text-muted-foreground">Review the assessments you took (your answers next to the correct ones), retake a topic, and see which practice loop is next.</p></div><Button onClick={onPractice} className="min-h-11 gap-2 rounded-xl"><Play className="h-4 w-4" />Open practice</Button></div>{sampleData && <div className="rounded-2xl border border-primary/20 bg-primary/[0.045] px-4 py-3 text-sm text-muted-foreground"><span className="font-semibold text-foreground">Example history.</span> Turn off Sample Data to see only saved attempts.</div>}<AssessmentHistoryList authFetch={authFetch} actions={actions} onReview={(id) => onReview({ id, from: 'history' })} /><Card className="rounded-3xl border-border/70 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><FileClock className="h-5 w-5 text-primary" />Recent attempts</CardTitle></CardHeader><CardContent>{attempts.length > 0 ? <div className="divide-y divide-border/70">{attempts.map((attempt) => <div key={attempt.id} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${attempt.status === 'Passed' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}><CheckCircle2 className="h-4 w-4" /></span><div><div className="font-medium">{attempt.title}</div><div className="mt-1 text-xs text-muted-foreground">{attempt.meta}{!attempt.isReal && ' · example'}</div></div></div><div className="flex items-center gap-6 pl-12 text-sm sm:pl-0"><span className={attempt.status === 'Passed' ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-amber-700 dark:text-amber-400'}>{attempt.status}</span><span className="font-mono text-xs text-muted-foreground">{attempt.duration}</span></div></div>)}</div> : <div className="rounded-2xl bg-muted/60 p-6 text-sm text-muted-foreground">No saved attempts yet. Start the diagnostic or open a practice workspace to create your first evidence.</div>}</CardContent></Card></div>
}

type Provider = 'claude' | 'copilot'
type Availability = { installed: boolean; version: string | null; auth?: 'token' | 'logged_in' | 'none' }
type Effective = { id: string | null; source: 'profile' | 'env' | 'default'; label: string }
type ModelOption = { id: string; label: string }
type ModelList = { options: ModelOption[]; source: 'live' | 'builtin' | 'aliases'; updated_at: string }
type AiState = { provider: Provider; models: Record<Provider, ModelList | null>; failover: boolean; model: Record<Provider, string | null>; effective: Record<Provider, Effective>; availability: Record<Provider, Availability> }
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/
const CLAUDE_DEFAULT = 'claude-sonnet-5-5'
const PROVIDERS: Array<{ id: Provider; label: string }> = [{ id: 'claude', label: 'Claude CLI' }, { id: 'copilot', label: 'Copilot CLI' }]

// One model for the selected provider (stored per provider, because ids differ between the CLIs): a list, or "Other…" for an id that is not listed.
const OTHER = '__other__'
function ago(iso: string) { const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return seconds < 20 ? 'just now' : seconds < 3600 ? `${Math.round(seconds / 60) || 1} min ago` : `${Math.round(seconds / 3600)} h ago` }
function ModelField({ state, disabled, onSave, onRefresh }: { state: AiState; disabled: boolean; onSave: (model: string | null) => void; onRefresh: () => void }) {
  const provider = state.provider
  const stored = state.model[provider]
  const list = state.models[provider]
  const options = list?.options ?? []
  const initial = stored === null ? '' : options.some((option) => option.id === stored) ? stored : OTHER
  const [choice, setChoice] = useState(initial)
  const [custom, setCustom] = useState(initial === OTHER ? stored ?? '' : '')
  useEffect(() => { setChoice(initial); setCustom(initial === OTHER ? stored ?? '' : '') }, [provider, stored, initial])
  const value = choice === OTHER ? custom : choice
  const valid = choice !== OTHER || MODEL_ID.test(custom)
  const dirty = (value === '' ? null : value) !== stored
  return <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-2"><label htmlFor="ai-model" className="text-xs font-medium">Model</label>{provider === 'copilot' && <button type="button" disabled={disabled} onClick={onRefresh} className="text-[11px] text-primary underline-offset-2 hover:underline disabled:opacity-60">Refresh list</button>}</div>
    <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); if (valid && dirty) onSave(value === '' ? null : value) }}>
      <div className="flex items-center gap-2">
        <select id="ai-model" value={choice} disabled={disabled} onChange={(event) => setChoice(event.target.value)} className="min-h-10 flex-1 rounded-lg border border-input bg-background px-3 text-xs">
          <option value="">{provider === 'claude' ? `Default (${CLAUDE_DEFAULT})` : 'Default (CLI default)'}</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label ? `${option.id} · ${option.label}` : option.id}</option>)}
          <option value={OTHER}>Other…</option>
        </select>
        <Button type="submit" size="sm" variant="outline" className="min-h-10 rounded-lg" disabled={disabled || !valid || !dirty}>Save</Button>
      </div>
      {choice === OTHER && <Input aria-label="Model id" value={custom} disabled={disabled} onChange={(event) => setCustom(event.target.value.trim())} placeholder="model id" maxLength={80} spellCheck={false} className="h-10 rounded-lg font-mono text-xs" />}
    </form>
    <p className="text-[11px] text-muted-foreground">{!list || list.source === 'builtin' ? 'Using built-in list.' : list.source === 'live' ? `Live from ${provider === 'copilot' ? 'Copilot CLI' : 'Anthropic'} · updated ${ago(list.updated_at)}` : 'Aliases resolve to the newest model automatically.'}</p>
    {!valid && <p className="text-[11px] text-destructive">Use letters, digits and . _ : / - only (no spaces, not starting with a dash).</p>}
  </div>
}

function statusText(provider: Provider, availability: Availability | undefined) {
  if (!availability) return 'Checking…'
  if (!availability.installed) return 'Not found'
  if (provider === 'copilot' && availability.auth === 'none') return 'Installed · Not authenticated'
  return 'Installed'
}

// Chooses which CLI answers tutor requests. Saved in the learner profile; the server reads it on every AI call.
function AiProviderCard({ authFetch }: { authFetch: ReturnType<typeof useAuth>['authFetch'] }) {
  const [state, setState] = useState<AiState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)

  const call = useCallback(async (method: string, body?: object, query = '') => {
    const response = await authFetch(`/api/settings/ai${query}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.success !== true) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Request failed.')
    return payload.data
  }, [authFetch])

  useEffect(() => { call('GET').then((data) => { setState(data); publishAiProvider(data.provider, data.effective?.[data.provider]?.id) }).catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not load AI settings.')) }, [call])

  const save = async (update: { provider?: Provider; failover?: boolean; models?: Partial<Record<Provider, string | null>> }) => {
    setSaving(true); setError(null); setTest(null)
    try { const data = await call('PUT', update); setState(data); publishAiProvider(data.provider, data.effective?.[data.provider]?.id) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save.') } finally { setSaving(false) }
  }
  const runTest = async () => {
    if (!state) return
    setTesting(true); setTest(null)
    try {
      const data = await call('POST', { provider: state.provider })
      setTest({ ok: data.ok === true, text: data.ok === true ? `Connected via ${data.label} (${data.model}) in ${(data.latency_ms / 1000).toFixed(1)}s.` : `${data.label} (${data.model}) answered, but not as expected.` })
    } catch (caught) { setTest({ ok: false, text: caught instanceof Error ? caught.message : 'Connection test failed.' }) } finally { setTesting(false) }
  }

  return <div className="space-y-3 rounded-2xl border border-border/70 p-4">
    <div className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-primary" />AI provider</div>
    <div role="radiogroup" aria-label="AI provider" className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
      {PROVIDERS.map((item) => <button key={item.id} type="button" role="radio" aria-checked={state?.provider === item.id} disabled={!state || saving} onClick={() => state?.provider !== item.id && void save({ provider: item.id })} className={`min-h-10 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${state?.provider === item.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{item.label}<span className="block text-[11px] font-normal text-muted-foreground">{statusText(item.id, state?.availability[item.id])}</span></button>)}
    </div>
    {state?.provider === 'copilot' && <p className="text-xs leading-5 text-muted-foreground">Copilot output is JSON requested through the prompt (no schema enforcement), so it may be slower and less reliable than Claude CLI. A malformed answer is retried once.</p>}
    {state && <ModelField state={state} disabled={saving} onSave={(model) => void save({ models: { [state.provider]: model } })} onRefresh={() => void call('GET', undefined, '?refresh=1').then(setState).catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not refresh.'))} />}
    <p className="text-xs leading-5 text-muted-foreground">Applies to new generations; Regenerate rebuilds cached lessons.</p>
    <label className="flex items-start gap-3 text-xs leading-5 text-muted-foreground"><Checkbox checked={state?.failover === true} disabled={!state || saving} onCheckedChange={(checked) => void save({ failover: checked === true })} className="mt-0.5" /><span>If the selected provider hits a quota/auth error, retry once with the other provider.</span></label>
    <div className="flex flex-wrap items-center gap-3"><Button type="button" size="sm" variant="outline" className="min-h-10 gap-2 rounded-xl" disabled={!state || testing || saving} onClick={() => void runTest()}>{testing && <Loader2 className="h-4 w-4 animate-spin" />}Test connection</Button>{state && <span className="text-xs text-muted-foreground">{`Model: ${state.effective[state.provider].id ?? 'auto'} (${state.effective[state.provider].source})`}</span>}</div>
    {test && <p role="status" className={`text-xs leading-5 ${test.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>{test.text}</p>}
    {error && <p role="alert" className="text-xs leading-5 text-destructive">{error}</p>}
  </div>
}

export function ProfilePanel({ displayName, email, profile, sampleData, authFetch, onBack, onToggleSampleData }: { displayName: string; email: string; profile: JsonRecord | null; sampleData: boolean; authFetch: ReturnType<typeof useAuth>['authFetch']; onBack: () => void; onToggleSampleData: (checked: boolean) => void }) {
  const preferences = recordValue(profile?.preferences)
  const onboarding = recordValue(profile?.onboarding_state)
  return <div className="mx-auto w-full max-w-4xl space-y-7 pb-10"><div className="border-b border-border/70 pb-7"><button onClick={onBack} className="mb-3 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowRight className="h-4 w-4 rotate-180" />Back to home</button><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Learning desk settings</div><h1 className="mt-3 font-serif text-4xl tracking-tight">Your profile.</h1><p className="mt-3 max-w-2xl leading-7 text-muted-foreground">Keep your preferences close to the practice loop. Account access is handled by EmbedPath authentication.</p></div><div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr]"><Card className="rounded-3xl border-border/70 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><CircleUserRound className="h-5 w-5 text-primary" />Account</CardTitle></CardHeader><CardContent className="space-y-4"><div className="flex items-center gap-4"><span className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary"><UserRound className="h-6 w-6" /></span><div><div className="text-lg font-semibold">{displayName}</div><div className="text-sm text-muted-foreground">{email}</div></div></div><Separator /><div className="grid gap-3 text-sm"><div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Track</span><span className="font-medium">Embedded systems</span></div><div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Onboarding</span><Badge variant="outline" className="rounded-full">{stringValue(onboarding.status, 'needs diagnostic')}</Badge></div><div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Study length</span><span className="font-medium">{numberValue(preferences.study_minutes, 25)} min</span></div></div></CardContent></Card><Card className="rounded-3xl border-border/70 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5 text-primary" />Workspace preferences</CardTitle></CardHeader><CardContent className="space-y-5"><label className="flex items-start justify-between gap-4 rounded-2xl border border-border/70 p-4"><span><span className="block text-sm font-semibold">Sample Data</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Keep representative exercises visible while you explore.</span></span><Switch checked={sampleData} onCheckedChange={onToggleSampleData} /></label><AiProviderCard authFetch={authFetch} /><div className="rounded-2xl bg-muted/60 p-4 text-sm leading-6 text-muted-foreground"><div className="flex items-center gap-2 font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-primary" />Data boundaries</div><p className="mt-2">Saved progress stays scoped to this account. Theme is the only browser preference; learning records use PostgreSQL.</p></div><div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm leading-6 text-muted-foreground"><div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300"><Info className="h-4 w-4" />AI CLI runtime</div><p className="mt-2">Tutor requests run directly through the selected CLI (Claude or Copilot) using the host's existing login. No Lyzr API or OAuth Connect flow is used.</p></div></CardContent></Card></div></div>
}
