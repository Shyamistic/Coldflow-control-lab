import { useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, ArrowDownToLine, ArrowUpRight, Box, Check, ChevronRight, CircleStop, ClipboardList, Eye, FlaskConical, Gauge, GitBranch, Info, Leaf, Pause, Play, RotateCcw, ShieldCheck, Thermometer, Video, X, Zap } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import Chamber from './Chamber'
import { SCENARIOS, configurationFamilyForScenario, exportCsv, runCanonicalExperiment, scenarioForFamily } from './simulator/public-experiment'
import type { ConfigurationFamily } from './simulator/configuration'
import { LIMITS, shield, validSafety, driverAccept } from './safety'
import type { Context, Method, Scenario } from './domain'
import type { PublicExperiment } from './simulator/public-experiment'
import './dashboard.css'

const methods: { id: Method; name: string }[] = [{ id: 'identified', name: 'Identified control' }, { id: 'fixed-normal', name: 'Fixed normal' }, { id: 'fixed-high', name: 'Fixed high' }, { id: 'expert-rule', name: 'Expert rule' }, { id: 'path-clear', name: 'Synthetic path-clear' }]
const scenarioOptions = Object.keys(SCENARIOS) as Scenario[]
const familyOptions: ConfigurationFamily[] = ['normal', 'correctable', 'obstructed', 'capacity', 'fault-matrix']
const familyLabels: Record<ConfigurationFamily, string> = { normal: 'Normal', correctable: 'Correctable synthetic', obstructed: 'Obstructed', capacity: 'Capacity', 'fault-matrix': 'Fault matrix' }
const colors = ['#de7456', '#b99b3e', '#418b91', '#517f5c', '#8173a0', '#557bb2']
const tabs = [{ id: 'chamber', label: 'Chamber', icon: Box }, { id: 'validation', label: 'Experiments', icon: FlaskConical }, { id: 'science', label: 'Model & boundaries', icon: GitBranch }, { id: 'audit', label: 'Event record', icon: ClipboardList }] as const
const download = (data: Blob, name: string) => { const link = document.createElement('a'); link.href = URL.createObjectURL(data); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000) }
const clock = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
const finalSample = (experiment: PublicExperiment) => experiment.samples.at(-1)!
const outcomeFor = (scenario: Scenario, _sample: PublicExperiment['samples'][number]) => {
  if (scenario === 'normal') return { label: 'NO_EXCURSION', detail: 'NO ACTION / already in target' }
  if (scenario === 'correctable' || scenario === 'partial') return { label: 'CORRECTABLE', detail: 'SYNTHETIC CORRECTION / bounded advisory' }
  if (scenario === 'blocked') return { label: 'ABSTAIN', detail: 'RESTACK_REQUIRED / inspect path' }
  if (scenario === 'capacity') return { label: 'CAPACITY_OR_EQUIPMENT_FAULT', detail: 'INSPECTION / source inadequate' }
  if (scenario === 'sensor') return { label: 'SENSOR_OR_EVENT_ARTIFACT', detail: 'SAFE FALLBACK / stale input' }
  return { label: 'ABSTAIN', detail: 'FAULT / no-action safe fallback' }
}

export default function Dashboard() {
  const [tab, setTab] = useState<string>('chamber')
  const [scenario, setScenario] = useState<Scenario>('partial')
  const [family, setFamily] = useState<ConfigurationFamily>('obstructed')
  const [method, setMethod] = useState<Method>('identified')
  const [experiment, setExperiment] = useState<PublicExperiment>(() => runCanonicalExperiment('partial', 'identified'))
  const [frame, setFrame] = useState(0)
  const [running, setRunning] = useState(false)
  const [leaseUntil, setLeaseUntil] = useState(0)
  const [context, setContext] = useState<Context>('NORMAL')
  const [cutout, setCutout] = useState(false)
  const [recording, setRecording] = useState(false)
  const [message, setMessage] = useState('')
  const [comparisons, setComparisons] = useState<PublicExperiment[]>([])
  const [comparisonStatus, setComparisonStatus] = useState<'empty' | 'loading' | 'complete' | 'error'>('empty')
  const [comparisonError, setComparisonError] = useState('')
  const [explanation, setExplanation] = useState('')
  const [explanationError, setExplanationError] = useState('')
  const [explaining, setExplaining] = useState(false)
  const [experimentError, setExperimentError] = useState('')
  const [cameraReset, setCameraReset] = useState(0)
  const scene = useRef<HTMLDivElement>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [wallTime, setWallTime] = useState(() => Date.now())
  const activeLease = wallTime < leaseUntil
  const sample = experiment.samples[frame]
  const guarded = shield(validSafety({ nowMs: wallTime, measuredAtMs: wallTime, context, operatorApproved: activeLease, leaseUntilMs: leaseUntil, interlockClosed: !cutout, actuatorHealthy: scenario !== 'actuator', requested: sample.fans, previous: sample.fans, temperatures: [...sample.temperatures, sample.supply, sample.returnAir] }))
  const fans = driverAccept(guarded, wallTime, 0)
  const shown = { ...sample, fans, state: guarded.permitted ? sample.state : 'SAFE_FALLBACK' as const, reason: guarded.permitted ? sample.reason : guarded.reason }
  const playbackState = running ? 'PLAYING' : frame >= experiment.samples.length - 1 ? 'COMPLETE' : frame > 0 ? 'PAUSED' : 'READY'
  const hotZone = shown.temperatures.indexOf(Math.max(...shown.temperatures))
  useEffect(() => { const timer = setInterval(() => setWallTime(Date.now()), 100); return () => clearInterval(timer) }, [])
  useEffect(() => { if (!running || !guarded.permitted) return; const timer = setInterval(() => setFrame(previous => Math.min(previous + 1, experiment.samples.length - 1)), 180); return () => clearInterval(timer) }, [running, guarded.permitted, experiment.samples.length])
  useEffect(() => () => { if (recorder.current?.state === 'recording') recorder.current.stop(); if (recordingTimer.current) clearTimeout(recordingTimer.current) }, [])
  const reset = (nextScenario = scenario, nextMethod = method) => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
    try {
      const nextExperiment = runCanonicalExperiment(nextScenario, nextMethod)
      setScenario(nextScenario); setFamily(configurationFamilyForScenario(nextScenario)); setMethod(nextMethod); setExperiment(nextExperiment); setFrame(0); setRunning(false); setComparisons([]); setComparisonStatus('empty'); setComparisonError(''); setExplanation(''); setExplanationError(''); setExperimentError(''); setLeaseUntil(0); setMessage('')
    } catch (error) { setExperimentError(String(error)); setRunning(false) }
  }
  const chartData = experiment.samples.slice(0, frame + 1).map(point => ({ seconds: point.seconds, ...Object.fromEntries(point.temperatures.map((value, index) => [`z${index + 1}`, value])) }))
  const composite = () => {
    const source = scene.current?.querySelector('canvas')
    if (!source) throw new Error('Chamber canvas unavailable')
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720
    const paint = () => {
      const brush = canvas.getContext('2d')!
      brush.fillStyle = '#f1f5f0'; brush.fillRect(0, 0, 1280, 720)
      const ratio = Math.min(1280 / source.width, 620 / source.height)
      brush.drawImage(source, (1280 - source.width * ratio) / 2, 52, source.width * ratio, source.height * ratio)
      brush.fillStyle = '#1d3a2c'; brush.font = 'bold 25px sans-serif'; brush.fillText('COLDFLOW / 3D CONCEPT - SIMULATION ONLY', 32, 34)
      brush.font = '18px sans-serif'; brush.fillText(`${SCENARIOS[scenario].name} | ${methods.find(item => item.id === method)?.name} | No physical or food-quality evidence`, 32, 692)
    }
    paint(); return { canvas, paint }
  }
  const snapshot = () => { try { composite().canvas.toBlob(blob => blob && download(blob, 'coldflow-concept-SIMULATION.png')); setMessage('Concept image exported.') } catch (error) { setMessage(String(error)) } }
  const record = () => {
    const currentRecorder = recorder.current
    if (currentRecorder?.state === 'recording') {
      const stop = () => { if (currentRecorder.state === 'recording') currentRecorder.stop() }
      const fallback = setTimeout(stop, 1000)
      currentRecorder.addEventListener('dataavailable', () => { clearTimeout(fallback); stop() }, { once: true })
      currentRecorder.requestData()
      return
    }
    if (!activeLease) { setMessage('Simulated lease not approved.'); return }
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { setMessage('Video capture unavailable in this browser.'); return }
    try {
      const { canvas, paint } = composite()
      const mimeType = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw new Error('No supported WebM recorder')
      canvas.style.cssText = 'position:fixed;right:24px;bottom:24px;width:320px;height:180px;pointer-events:none;z-index:90;border:1px solid #98b19b'
      document.body.appendChild(canvas)
      const stream = canvas.captureStream(30); const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame: () => void }
      const media = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4000000 })
      const chunks: BlobPart[] = []
      const tick = () => { paint(); canvas.getContext('2d')!.getImageData(0, 0, 1, 1); track.requestFrame() }
      const finish = (blob: Blob, activeStream: MediaStream) => { activeStream.getTracks().forEach(activeTrack => activeTrack.stop()); canvas.remove(); setRecording(false); if (blob.size < 1024) { setMessage('Video encoder produced no usable frames.'); return }; download(blob, 'coldflow-concept-SIMULATION.webm'); setMessage('Labeled concept video exported.') }
      const retry = () => {
        stream.getTracks().forEach(activeTrack => activeTrack.stop())
        const retryStream = canvas.captureStream(30); const retryTrack = retryStream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame: () => void }; const retryRecorder = new MediaRecorder(retryStream, { mimeType, videoBitsPerSecond: 4000000 }); const retryChunks: BlobPart[] = []
        const retryAnimation = setInterval(() => { paint(); retryTrack.requestFrame() }, 33)
        retryRecorder.ondataavailable = event => { if (event.data.size) retryChunks.push(event.data) }
        retryRecorder.onstop = () => { clearInterval(retryAnimation); finish(new Blob(retryChunks, { type: mimeType }), retryStream) }
        retryRecorder.start(250); paint(); retryTrack.requestFrame()
        setTimeout(() => { if (retryRecorder.state === 'recording') retryRecorder.stop() }, 1000)
      }
      const animation = setInterval(tick, 33)
      media.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      media.onstop = () => { clearInterval(animation); if (recordingTimer.current) clearTimeout(recordingTimer.current); setTimeout(() => { const blob = new Blob(chunks, { type: mimeType }); if (blob.size < 1024) { retry(); return }; finish(blob, stream) }, 100) }
      media.start(250); tick(); recorder.current = media; setRecording(true); setRunning(true)
      recordingTimer.current = setTimeout(() => { if (media.state === 'recording') media.stop() }, 30000)
    } catch (error) { setMessage(String(error)); setRecording(false) }
  }
  const runComparators = () => {
    setComparisonStatus('loading'); setComparisonError('')
    try {
      const runs = scenarioOptions.flatMap(selectedScenario => methods.map(comparator => runCanonicalExperiment(selectedScenario, comparator.id)))
      setComparisons(runs); setComparisonStatus('complete')
    } catch (error) { setComparisons([]); setComparisonStatus('error'); setComparisonError(String(error)) }
  }
  const comparisonFor = (selectedScenario: Scenario, comparator: Method) => comparisons.find(run => run.scenario === selectedScenario && run.method === comparator)
  const explain = async () => {
    setExplaining(true); setExplanationError('')
    try { const response = await fetch('/api/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario, method, frame }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Explanation unavailable'); setExplanation(body.text) } catch (error) { setExplanation(''); setExplanationError(String(error)) } finally { setExplaining(false) }
  }
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/"><span className="brand-symbol"><Leaf size={23} /></span><span>ColdFlow<small>CONTROL LAB / 01</small></span></a><div className="workspace-label">WORKSPACE</div><nav aria-label="Workspace">{tabs.map(item => <button key={item.id} onClick={() => setTab(item.id)} className={tab === item.id ? 'nav-item selected' : 'nav-item'} aria-current={tab === item.id ? 'page' : undefined}><item.icon size={18} /><span>{item.label}</span>{tab === item.id && <ChevronRight size={14} />}</button>)}</nav><div className="sidebar-bottom"><span className="site-dot" />Software demonstrator<div>Tabletop design / six zones</div><div className="sidebar-boundary"><ShieldCheck size={16} /><span>OEM plant untouched</span></div>{import.meta.env.VITE_REPOSITORY_URL && <a href={import.meta.env.VITE_REPOSITORY_URL} target="_blank" rel="noreferrer" className="repo-link">Source repository <ArrowUpRight size={14} /></a>}</div></aside>
    <main><header className="topbar"><div><span className="breadcrumb">ColdFlow lab</span><ChevronRight size={13} /><span>{tabs.find(item => item.id === tab)?.label}</span></div><span className="evidence-badge"><span /> SIMULATION / NOT LIVE HARDWARE</span></header>
      <section className="provenance-banner" aria-label="Simulation provenance"><div><strong><ShieldCheck size={17} /> SIMULATION ONLY</strong><span>Canonical evidence path: <b>{experiment.provenance.executionPath}</b>. Hardware connected: <b>NO</b>; direct actuator writes: <b>NO</b>.</span></div><div className="provenance-meta"><span>Evidence <b>{experiment.provenance.evidenceClass}</b></span><span>Family <b>{experiment.provenance.configurationFamily}.v1</b></span><span>Simulator <b>{experiment.provenance.simulatorVersion}</b></span></div><div className="hash-grid"><span>manifestHash <code>{experiment.manifestHash}</code></span><span>configurationHash <code>{experiment.configurationHash}</code></span><span>outputHash <code>{experiment.outputHash}</code></span><span>replayHash <code>{experiment.replayHash}</code></span></div></section>
      <div className="page-heading"><div><div className="eyebrow">SPATIAL AIR TEMPERATURE / GUIDED EVIDENCE</div><h1>{tab === 'chamber' ? 'Chamber overview' : tab === 'validation' ? 'Comparative experiments' : tab === 'science' ? 'Model & boundaries' : 'Decision event record'}</h1><p>CF-01 <span>/</span> Six-zone chamber <span>/</span> Synthetic thermal plant <span>/</span> {familyLabels[family]} configuration</p></div><button className="button secondary" onClick={() => download(new Blob([exportCsv(experiment)], { type: 'text/csv' }), `coldflow-${scenario}-${method}-SIMULATION.csv`)}><ArrowDownToLine size={16} /> Export CSV</button></div>
      <div className="control-strip"><label>Scenario<select aria-label="Scenario" value={scenario} onChange={event => reset(event.target.value as Scenario)}>{scenarioOptions.map(id => <option key={id} value={id}>{SCENARIOS[id].name}</option>)}</select></label><label>Configuration family<select aria-label="Configuration family" value={family} onChange={event => { const nextFamily = event.target.value as ConfigurationFamily; setFamily(nextFamily); reset(scenarioForFamily[nextFamily], method) }}>{familyOptions.map(id => <option key={id} value={id}>{familyLabels[id]}</option>)}</select></label><label>Comparator<select aria-label="Comparator" value={method} onChange={event => reset(scenario, event.target.value as Method)}>{methods.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Source context<select aria-label="Source context" value={context} onChange={event => setContext(event.target.value as Context)}>{['NORMAL', 'DOOR_OPEN', 'DEFROST', 'DRIP', 'FAN_DELAY', 'POST_EVENT_RECOVERY', 'SOURCE_UNKNOWN'].map(value => <option key={value}>{value}</option>)}</select></label><button className={`button ${activeLease ? 'approved' : 'primary'}`} onClick={() => { setLeaseUntil(Date.now() + LIMITS.leaseMs); setWallTime(Date.now()) }}><Check size={16} />{activeLease ? `Lease ${Math.max(0, Math.ceil((leaseUntil - wallTime) / 1000))}s` : 'Approve simulated lease'}</button></div>
      <section className="scenario-guide" aria-labelledby="scenario-guide-heading"><div><div className="eyebrow">SCENARIO GUIDE</div><h2 id="scenario-guide-heading">{SCENARIOS[scenario].name}</h2><p>{SCENARIOS[scenario].description}</p></div><ol className="guided-steps" aria-label="Guided simulation steps"><li className={!activeLease ? 'current' : 'complete'}><span>1</span>Approve simulated lease</li><li className={activeLease && frame === 0 ? 'current' : frame > 0 ? 'complete' : ''}><span>2</span>Play or scrub model time</li><li className={playbackState === 'COMPLETE' ? 'complete' : ''}><span>3</span>Inspect outcome and hashes</li></ol></section>
      <div className={`safety-strip ${guarded.permitted ? 'safe' : 'inhibited'}`}><ShieldCheck size={17} /><strong>{guarded.permitted ? shown.state.replaceAll('_', ' ') : 'ADDED MOTION INHIBITED'}</strong><span>{shown.reason.replaceAll('_', ' ').toLowerCase()}</span><button onClick={() => { setCutout(previous => !previous); setRunning(false); setLeaseUntil(0) }} className="cutout"><CircleStop size={16} />{cutout ? 'Reset software cutout' : 'Software cutout'}</button></div>
      {experimentError && <div className="state-panel error-panel" role="alert"><AlertTriangle size={18} /><div><strong>Experiment unavailable</strong><p>{experimentError}</p></div></div>}
      {tab === 'chamber' && <>
        <div className="metrics"><Metric icon={Thermometer} label="Warmest zone" value={Math.max(...shown.temperatures).toFixed(2)} unit="C" note={`Z${hotZone + 1} / air, not product core`} warning={Math.max(...shown.temperatures) > 8} /><Metric icon={Activity} label="Spatial spread" value={shown.spread.toFixed(2)} unit="K" note="Maximum minus minimum / six zones" /><Metric icon={Gauge} label="Hot exposure (HDT)" value={shown.hdt.toFixed(2)} unit="K min" note="Air-only sum above illustrative 8 C limit" warning={shown.hdt > 0} /><Metric icon={Thermometer} label="Cold exposure (CDT)" value={shown.cdt.toFixed(2)} unit="K min" note="Air-only sum below illustrative 4 C limit" /><Metric icon={Zap} label="Added-fan energy" value={shown.fanWh.toFixed(3)} unit="Wh" note="Normalized model input; not total refrigeration" /></div>
        <section className="chamber-area"><div className="section-title"><div><span className="status-dot" /><h2>Spatial chamber</h2><span className="muted">CONCEPT GEOMETRY / SIMULATION ONLY</span></div><div className="legend"><span><i style={{ background: '#80af95' }} />In band</span><span><i style={{ background: '#e87654' }} />Warm air</span><span><i style={{ background: '#279db5' }} />Airflow</span><span><i style={{ background: '#d8a548' }} />Selected zone</span></div></div><div className="scene-layout"><div className="scene" ref={scene}><div className="scene-stamp">CF-01 / 3D CONCEPT / SIMULATION ONLY</div><div className="scene-context">{context === 'NORMAL' ? 'NORMAL CONTEXT' : `CONTEXT HIGHLIGHT: ${context}`}</div><Chamber sample={shown} scenario={scenario} animate={running && guarded.permitted} context={context} highlightZone={hotZone} resetToken={cameraReset} /><div className="scene-footer"><span>SIMULATION ONLY / VERSIONED_PLANT_VIRTUAL_DEVICE</span><span>Supply {shown.supply.toFixed(1)} C / return {shown.returnAir.toFixed(1)} C</span></div></div><aside className="actuator-panel"><div className="eyebrow">BOUNDED MODEL OUTPUT</div>{['Fan A', 'Fan B'].map((name, index) => <div className="fan-row" key={name}><span>{name}</span><strong>{Math.round(fans[index] * 100)}<small>%</small></strong><div className="duty-bar"><span style={{ width: `${fans[index] * 100}%` }} /></div><small>Bounded to 80% in this model</small></div>)}<div className="authority-status"><ShieldCheck size={20} /><strong>{guarded.permitted ? 'Local shield permitting' : 'Local shield inhibited'}</strong><span>{scenario === 'blocked' ? 'Insufficient authority. Inspect path; no restack diagnosis.' : 'No OEM refrigeration command path.'}</span></div><div className="scene-actions"><button className="button secondary" onClick={() => setCameraReset(previous => previous + 1)} title="Reset bounded 3D camera view"><RotateCcw size={15} /> Reset view</button><button className="button secondary" onClick={snapshot} title="Export labeled concept image"><ArrowDownToLine size={15} /> PNG</button><button className={`button secondary ${recording ? 'recording' : ''}`} onClick={record} title="Record labeled concept video"><Video size={15} />{recording ? 'Stop' : 'Video'}</button></div></aside></div><div className="decision-summary" role="status"><div><Eye size={16} /><strong>Current simulated decision: {shown.state.replaceAll('_', ' ')}</strong></div><span>Reason: {shown.reason.replaceAll('_', ' ')}</span><span>{guarded.permitted ? 'Safety shield permits bounded simulated output.' : 'No action permitted; safe fallback is visible.'}</span></div><div className="playback"><button className="icon-button" aria-label={running ? 'Pause simulation' : 'Play simulation'} title={running ? 'Pause simulation' : 'Play simulation'} disabled={!guarded.permitted || Boolean(experimentError)} onClick={() => setRunning(previous => !previous)}>{running ? <Pause size={18} /> : <Play size={18} />}</button><button className="icon-button" aria-label="Reset simulation" title="Reset simulation" onClick={() => reset()}><RotateCcw size={16} /></button><input type="range" aria-label="Simulation time" min="0" max={experiment.samples.length - 1} value={frame} onChange={event => { setFrame(Number(event.target.value)); setRunning(false) }} /><span className="time">{clock(sample.seconds)} / 10:00</span><span className="time-label">MODEL TIME / {playbackState}</span></div></section>
        <div className="probe-rail">{shown.temperatures.map((value, index) => <div key={index} className={`zone-label ${value > 8 ? 'warm' : ''} ${index === hotZone ? 'selected' : ''}`}><span>Z{index + 1}</span><strong>{value.toFixed(1)}<small> C</small></strong></div>)}</div>
        <section className="trace-area"><div className="section-title"><div><h2>Zone temperature traces</h2><span className="muted">SIMULATED AIR / CELSIUS</span></div><div className="trace-legend">{colors.map((color, index) => <span key={color}><i style={{ background: color }} />Z{index + 1}</span>)}</div></div><div className="chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 12, right: 20, left: -12, bottom: 5 }}><CartesianGrid stroke="#e5ebe5" vertical={false} /><XAxis dataKey="seconds" type="number" domain={[0, 600]} tickFormatter={value => `${value / 60}m`} tickLine={false} axisLine={false} /><YAxis domain={[3, 12]} tickLine={false} axisLine={false} /><Tooltip labelFormatter={value => `${value}s simulated`} /><ReferenceLine y={8} stroke="#dc8669" strokeDasharray="4 4" label={{ value: '8 C illustrative upper limit', position: 'insideTopRight', fontSize: 10 }} /><ReferenceLine y={4} stroke="#83b2bb" strokeDasharray="4 4" />{colors.map((color, index) => <Line key={color} type="linear" dataKey={`z${index + 1}`} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></div></section>
      </>}
      {tab === 'validation' && <section className="experiment-area"><div className="section-title"><div><h2>Matched synthetic protocol</h2><span className="muted">SEED 2026 / 600 SECONDS / NO FILTERED FAILURES</span></div><button className="button primary" onClick={runComparators}><FlaskConical size={16} /> Run all outcome comparators</button></div><div className="protocol-band"><span><strong>Seven scenarios</strong>Normal through fault and inspection cases</span><span><strong>Five methods</strong>Identified + synthetic baselines</span><span><strong>Shared safety shield</strong>No comparator bypass</span><span><strong>Simulation evidence</strong>No independent measured evidence</span></div>{comparisonStatus === 'loading' && <div className="state-panel loading-panel" role="status"><span className="loading-dot" /><strong>Running deterministic comparators…</strong></div>}{comparisonStatus === 'error' && <div className="state-panel error-panel" role="alert"><AlertTriangle size={18} /><div><strong>Comparator run unavailable</strong><p>{comparisonError}</p></div></div>}{comparisonStatus === 'empty' && <div className="state-panel empty-panel"><Info size={18} /><div><strong>No comparison runs yet</strong><p>Run all outcome comparators to show normal no-action, correctable, abstention, capacity, fault, and inspection results.</p></div></div>}{comparisonStatus === 'complete' && <div className="table-scroll"><table><thead><tr><th>Scenario / family</th><th>Identified outcome</th><th>Synthetic path-clear</th><th>Fixed baseline</th><th>Final air max / spread</th><th>Decision / reason</th></tr></thead><tbody>{scenarioOptions.map(selectedScenario => { const identified = comparisonFor(selectedScenario, 'identified')!; const pathClear = comparisonFor(selectedScenario, 'path-clear')!; const baseline = comparisonFor(selectedScenario, 'fixed-high')!; const identifiedEnd = finalSample(identified); const outcome = outcomeFor(selectedScenario, identifiedEnd); return <tr key={selectedScenario}><td><strong>{SCENARIOS[selectedScenario].name}</strong><small>{identified.provenance.configurationFamily}.v1 / {selectedScenario}</small></td><td><span className={`table-state outcome-${outcome.label.toLowerCase()}`}>{outcome.label}</span><small>{outcome.detail}</small></td><td><span className="comparison-cell"><b>{outcomeFor(selectedScenario, finalSample(pathClear)).label}</b><small>{finalSample(pathClear).state}</small></span></td><td><span className="comparison-cell"><b>{outcomeFor(selectedScenario, finalSample(baseline)).label}</b><small>{finalSample(baseline).state}</small></span></td><td>{Math.max(...identifiedEnd.temperatures).toFixed(2)} C / {identifiedEnd.spread.toFixed(2)} K<small>HDT {identifiedEnd.hdt.toFixed(2)} / CDT {identifiedEnd.cdt.toFixed(2)} / {identifiedEnd.fanWh.toFixed(3)} Wh</small></td><td><span className="comparison-cell"><b>{identifiedEnd.state.replaceAll('_', ' ')}</b><small>{identifiedEnd.reason.replaceAll('_', ' ')}</small></span></td></tr> })}</tbody></table></div>}<div className="evidence-note"><FlaskConical size={20} /><div><strong>Every outcome remains visible, including failure and ABSTAIN.</strong><p>Normal is a safe no-action case; correctable is a declared synthetic correction; blocked, capacity and fault cases retain abstention or inspection reasons. Coefficients, limits and uncertainty are illustrative. This is not calibrated product measurement or an energy-saving claim.</p></div></div><button className="button secondary" disabled={!comparisons.length} onClick={() => download(new Blob([JSON.stringify({ evidenceClass: 'SIMULATION', runs: comparisons }, null, 2)], { type: 'application/json' }), 'coldflow-comparators-SIMULATION.json')}><ArrowDownToLine size={16} /> Export experiment pack</button></section>}
      {tab === 'science' && <section className="science-area"><div className="model-heading"><FlaskConical size={28} /><div><h2>Reduced sensible-heat model</h2><span className="muted">Illustrative coefficients / not calibrated to a room</span></div></div><div className="equation">dT<sub>i</sub>/dt = k<sub>i</sub>(u)(T<sub>s</sub> - T<sub>i</sub>) + k<sub>mix</sub>(T<sub>next</sub> - T<sub>i</sub>) + q<sub>i</sub>/C + P<sub>fan</sub>/(6C)</div><div className="model-columns"><div><h3>Actuator authority / 120 s</h3><table><thead><tr><th>Zone</th><th>Fan A / K</th><th>Fan B / K</th></tr></thead><tbody>{experiment.authority.cooling.map((row, index) => <tr key={index}><td>Z{index + 1}</td><td>{row[0].toFixed(3)}</td><td>{row[1].toFixed(3)}</td></tr>)}</tbody></table><p className="muted">Per unit normalized duty. Cloned 40% pulse / baseline. Assumed prediction margin: 0.2 K.</p></div><div><h3>Commissioned scope</h3><ul className="boundary-list"><li><Check size={16} /> Added secondary fans and vane only</li><li><Check size={16} /> Fresh local inputs, sequence and 60 s lease</li><li><Check size={16} /> Condensation and critical faults inhibit</li><li><X size={16} /> No OEM fan / compressor / defrost writes</li><li><X size={16} /> No food release or inferred product core</li><li><X size={16} /> No physical evidence credit from simulation</li></ul><h3>Literature context</h3><a className="source" href="https://doi.org/10.1038/s41598-024-76385-y" target="_blank" rel="noreferrer">Apple layout research / Alexander et al. 2024 <ArrowUpRight size={14} /></a><a className="source" href="https://doi.org/10.1038/s41598-025-95886-y" target="_blank" rel="noreferrer">Pallet clearance research / Alexander et al. 2025 <ArrowUpRight size={14} /></a></div></div><div className="explanation"><div className="section-title"><div><h3>Scenario interpretation</h3><span className="muted">ADVISORY / NO ACTUATOR AUTHORITY</span></div><button className="button secondary" disabled={explaining} onClick={explain}><GitBranch size={15} />{explaining ? 'Pending...' : 'Request explanation'}</button></div>{explanationError && <p className="inline-error" role="alert">{explanationError}</p>}{explanation && <p role="status">{explanation}</p>}</div></section>}
      {tab === 'audit' && <section className="audit-area"><div className="section-title"><div><h2>Synthetic decision trace</h2><span className="muted">NOT A HARDWARE AUDIT LOG / SIMULATION ONLY</span></div></div><div className="table-scroll"><table><thead><tr><th>Model time</th><th>State</th><th>Reason</th><th>Fan A / B</th><th>Evidence</th></tr></thead><tbody>{experiment.samples.filter((point, index, all) => index === 0 || point.reason !== all[index - 1].reason || point.seconds % 60 === 0).map(point => <tr key={point.seconds}><td>{clock(point.seconds)}</td><td>{point.state}</td><td>{point.reason}</td><td>{point.fans.map(value => `${Math.round(value * 100)}%`).join(' / ')}</td><td>SIMULATION</td></tr>)}</tbody></table></div><div className="evidence-note"><ShieldCheck size={20} /><div><strong>Two separate records</strong><p>This table is the precomputed synthetic experiment. The current browser lease/context shield gates playback and animation; it does not rewrite the experiment as live telemetry. Hardware serial records are a separate future source.</p></div></div></section>}
      {message && <div className="toast" role="status">{message}<button aria-label="Dismiss notification" onClick={() => setMessage('')}><X size={16} /></button></div>}
      <footer className="page-footer"><span><span className="status-dot" />Software prototype / physical gates G0-G6 unpassed</span><span>No physical efficacy, food-quality or commercial savings claim</span></footer>
    </main>
  </div>
}
function Metric({ icon: Icon, label, value, unit, note, warning = false }: { icon: typeof Thermometer; label: string; value: string; unit: string; note: string; warning?: boolean }) {
  return <div className={`metric ${warning ? 'warning' : ''}`}><div className="metric-label"><span>{label}</span><Icon size={17} /></div><div className="metric-value">{value}<span>{unit}</span></div><div className="metric-note">{note}</div></div>
}
