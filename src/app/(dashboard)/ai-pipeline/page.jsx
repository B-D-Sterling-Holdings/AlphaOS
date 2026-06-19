'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Workflow, Play, Download, Upload, BarChart3, Settings, List, Info, Trash2,
  Terminal, Loader2, ChevronDown, History, X, Cpu,
} from 'lucide-react';
import Card from '@/components/Card';
import Toast from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';

const MODES = [
  { value: 'balanced', label: 'DHQ Investment Philosophy' },
];

// Commands that incur real cost/time (model inference, external APIs, env build)
// and therefore prompt for confirmation before running.
const HEAVY = new Set(['analyze', 'analyze-all', 'generate-data', 'install']);

function signalClasses(sig) {
  const s = (sig || '').toUpperCase();
  if (s === 'BUY') return { dot: 'bg-emerald-500', text: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (s === 'HOLD') return { dot: 'bg-amber-500', text: 'text-amber-700', chip: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (s === 'AVOID') return { dot: 'bg-red-500', text: 'text-red-700', chip: 'bg-red-50 text-red-700 border-red-200' };
  return { dot: 'bg-gray-400', text: 'text-gray-600', chip: 'bg-gray-50 text-gray-600 border-gray-200' };
}

function fmtDate(d, withTime = false) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + (withTime ? ` ${dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : '');
}

export default function AiPipelinePage() {
  const [tab, setTab] = useState('pipeline'); // 'pipeline' | 'history'
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, message, onConfirm }
  const [model, setModel] = useState('gemini-2.5-flash'); // configured Gemini model

  // ── Pipeline state ──
  const [tickers, setTickers] = useState([]);
  const [runStatus, setRunStatus] = useState({ running: false });
  const [runLog, setRunLog] = useState('');
  const [runHistory, setRunHistory] = useState([]);
  const [historyLog, setHistoryLog] = useState(null);
  const [genTicker, setGenTicker] = useState('');
  const [uploadTicker, setUploadTicker] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [plotTicker, setPlotTicker] = useState('');
  const [analyzeTicker, setAnalyzeTicker] = useState('');
  const [analyzeMode, setAnalyzeMode] = useState('balanced');
  const [utilTicker, setUtilTicker] = useState('');

  // ── Signal History state ──
  const [histories, setHistories] = useState([]);
  const [selectedTicker, setSelectedTicker] = useState('');
  const [timeline, setTimeline] = useState([]);
  const [detail, setDetail] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const pollRef = useRef(null);
  const logRef = useRef(null);

  // ── Initial load: tickers + any in-flight run ──
  useEffect(() => {
    (async () => {
      try {
        const [t, r] = await Promise.all([
          fetch('/api/prism/tickers').then((x) => x.json()),
          fetch('/api/prism/run').then((x) => x.json()),
        ]);
        const list = t.tickers || [];
        setTickers(list);
        if (list.length) {
          setPlotTicker(list[0]);
          setAnalyzeTicker(list[0]);
          setUtilTicker(list[0]);
          setUploadTicker(list[0]);
        }
        if (r) {
          setRunStatus(r.running ? { running: true, command: r.command } : { running: false });
          setRunLog(r.log || '');
          if (r.history) setRunHistory(r.history);
          if (r.model) setModel(r.model);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // ── Auto-scroll the log to the bottom on update ──
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [runLog]);

  // ── Poll while a run is in progress ──
  useEffect(() => {
    if (!runStatus.running) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const d = await fetch('/api/prism/run').then((x) => x.json());
        setRunLog(d.log || '');
        if (d.history) setRunHistory(d.history);
        if (!d.running) {
          clearInterval(pollRef.current);
          setRunStatus({ running: false });
          setToast({
            message: d.exitCode === 0 ? `${d.command} completed` : `${d.command} failed (exit ${d.exitCode})`,
            type: d.exitCode === 0 ? 'success' : 'error',
          });
          // A finished analysis may have produced new signals — refresh history.
          if (['analyze', 'analyze-all'].includes(d.command) && d.exitCode === 0) loadHistories();
        }
      } catch { /* keep polling */ }
    }, 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runStatus.running]);

  // ── Run a pipeline command ──
  const startRun = useCallback(async (command, opts = {}) => {
    try {
      const d = await fetch('/api/prism/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, ...opts }),
      }).then((x) => x.json());
      if (d.error) { setToast({ message: d.error, type: 'error' }); return; }
      setRunStatus({ running: true, command });
      setHistoryLog(null);
    } catch (e) {
      setToast({ message: e.message, type: 'error' });
    }
  }, []);

  const run = useCallback((command, opts = {}, label) => {
    if (HEAVY.has(command)) {
      setConfirm({
        title: `Run: ${label || command}`,
        message: command === 'generate-data'
          ? 'This calls the Alpha Vantage API to fetch market data. Continue?'
          : command.startsWith('analyze')
            ? 'This runs the local Ollama model and may take a few minutes. Continue?'
            : 'This may take a while. Continue?',
        onConfirm: () => { setConfirm(null); startRun(command, opts); },
      });
    } else {
      startRun(command, opts);
    }
  }, [startRun]);

  const cancelRun = useCallback(async () => {
    try {
      await fetch('/api/prism/run', { method: 'DELETE' });
      setRunStatus({ running: false });
      setToast({ message: 'Run cancelled', type: 'warning' });
    } catch (e) {
      setToast({ message: e.message, type: 'error' });
    }
  }, []);

  const viewLog = useCallback(async (id) => {
    if (historyLog?.id === id) { setHistoryLog(null); return; }
    try {
      const d = await fetch(`/api/prism/run?history=${id}`).then((x) => x.json());
      if (d.run) setHistoryLog(d.run);
    } catch { /* ignore */ }
  }, [historyLog]);

  const doUpload = useCallback(async () => {
    if (!uploadTicker) { setToast({ message: 'Select a ticker', type: 'warning' }); return; }
    if (!uploadFile) { setToast({ message: 'Choose a file', type: 'warning' }); return; }
    setUploadStatus('Uploading…');
    try {
      const buf = await uploadFile.arrayBuffer();
      const base64 = btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''));
      const d = await fetch('/api/prism/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: uploadTicker, filename: uploadFile.name, file: base64 }),
      }).then((x) => x.json());
      if (d.error) { setUploadStatus(`Error: ${d.error}`); return; }
      setUploadStatus(`Uploaded ${d.filename}`);
      setUploadFile(null);
    } catch (e) {
      setUploadStatus(`Failed: ${e.message}`);
    }
  }, [uploadTicker, uploadFile]);

  // ── Signal History data ──
  const loadHistories = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const d = await fetch('/api/prism/history').then((x) => x.json());
      const list = d.histories || [];
      setHistories(list);
      if (list.length && !selectedTicker) selectTicker(list[0].ticker);
    } catch (e) {
      setToast({ message: e.message, type: 'error' });
    } finally {
      setHistoryLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTicker]);

  const selectTicker = useCallback(async (ticker) => {
    setSelectedTicker(ticker);
    setDetail(null);
    if (!ticker) { setTimeline([]); return; }
    try {
      const d = await fetch(`/api/prism/history/${ticker}/timeline`).then((x) => x.json());
      setTimeline(d.timeline || []);
    } catch (e) {
      setToast({ message: e.message, type: 'error' });
    }
  }, []);

  const openDetail = useCallback(async (point) => {
    const ref = point.id || point.source_file;
    if (!ref) return;
    try {
      const d = await fetch(`/api/prism/recommendations/${encodeURIComponent(ref)}`).then((x) => x.json());
      if (d.error) { setToast({ message: d.error, type: 'error' }); return; }
      setDetail(d);
    } catch (e) {
      setToast({ message: e.message, type: 'error' });
    }
  }, []);

  useEffect(() => {
    if (tab === 'history' && !histories.length) loadHistories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
      {/* Header */}
      <div className="pt-8 pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-100 shadow-sm">
            <Workflow size={20} className="text-gray-700" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">AI Pipeline</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Run the LLM fundamental-analysis pipeline on Google Gemini and track signal history.
            </p>
          </div>
          <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
            <Cpu size={12} /> Google Gemini · {model}
          </span>
          {runStatus.running && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
              <Loader2 size={11} className="animate-spin" /> {runStatus.command}
            </span>
          )}
        </div>

        {/* Sub-tabs */}
        <div className="mt-6 inline-flex rounded-2xl border border-gray-200 bg-gray-50 p-1">
          {[
            { id: 'pipeline', label: 'Pipeline', icon: Workflow },
            { id: 'history', label: 'Signal History', icon: History },
          ].map(({ id, label, icon: I }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-semibold transition-all ${
                tab === id ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <I size={13} /> {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'pipeline' ? (
        <PipelineTab
          tickers={tickers}
          runStatus={runStatus} runLog={runLog} runHistory={runHistory} historyLog={historyLog}
          logRef={logRef}
          run={run} cancelRun={cancelRun} viewLog={viewLog}
          genTicker={genTicker} setGenTicker={setGenTicker}
          uploadTicker={uploadTicker} setUploadTicker={setUploadTicker}
          uploadFile={uploadFile} setUploadFile={setUploadFile} uploadStatus={uploadStatus} doUpload={doUpload}
          plotTicker={plotTicker} setPlotTicker={setPlotTicker}
          analyzeTicker={analyzeTicker} setAnalyzeTicker={setAnalyzeTicker}
          analyzeMode={analyzeMode} setAnalyzeMode={setAnalyzeMode}
          utilTicker={utilTicker} setUtilTicker={setUtilTicker}
        />
      ) : (
        <HistoryTab
          histories={histories} loading={historyLoading}
          selectedTicker={selectedTicker} selectTicker={selectTicker}
          timeline={timeline} detail={detail} setDetail={setDetail} openDetail={openDetail}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
      {confirm && (
        <ConfirmModal title={confirm.title} message={confirm.message}
          onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />
      )}
    </div>
  );
}

// ════════════════════════════════════ Pipeline tab ════════════════════════════
function StepCard({ step, icon: I, title, desc, badge, children, onRun, runLabel, disabled }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-gray-100 p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gray-900 text-white text-[11px] font-bold">{step}</span>
        <I size={15} className="text-gray-700" />
        <span className="text-[13px] font-semibold text-gray-900">{title}</span>
        {badge && <span className="ml-auto rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">{badge}</span>}
      </div>
      {desc && <p className="text-[11px] text-gray-400 leading-relaxed mb-3">{desc}</p>}
      <div className="mt-auto space-y-2">
        {children}
        <button onClick={onRun} disabled={disabled}
          className="w-full rounded-xl bg-gray-900 text-white px-3 py-2 text-[12px] font-semibold hover:bg-gray-800 disabled:opacity-30 transition-all">
          {runLabel}
        </button>
      </div>
    </div>
  );
}

function TickerSelect({ value, onChange, tickers, placeholder = 'Select ticker…' }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30">
      <option value="">{placeholder}</option>
      {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

function PipelineTab(props) {
  const {
    tickers, runStatus, runLog, runHistory, historyLog, logRef,
    run, cancelRun, viewLog,
    genTicker, setGenTicker, uploadTicker, setUploadTicker, uploadFile, setUploadFile, uploadStatus, doUpload,
    plotTicker, setPlotTicker, analyzeTicker, setAnalyzeTicker, analyzeMode, setAnalyzeMode,
    utilTicker, setUtilTicker,
  } = props;
  const busy = runStatus.running;

  return (
    <div className="space-y-6">
      {/* Full pipeline */}
      <Card title="Full Pipeline">
        <p className="text-sm text-gray-500 -mt-2 mb-5">Run a complete analysis from setup to AI recommendation, step by step.</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StepCard step={1} icon={Settings} title="Setup" desc="Prepare the Python environment & dependencies."
            onRun={() => run('install', {}, 'Setup Environment')} runLabel="Setup Environment" disabled={busy}>
          </StepCard>

          <StepCard step={2} icon={Download} title="Fetch Data" badge="API" desc="Pull fundamentals & prices from market sources."
            onRun={() => run('generate-data', { ticker: genTicker }, 'Fetch Market Data')} runLabel="Fetch Market Data" disabled={busy}>
            <input value={genTicker} onChange={(e) => setGenTicker(e.target.value.toUpperCase())} placeholder="e.g. AAPL"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
          </StepCard>

          <StepCard step={3} icon={Upload} title="Upload Doc" desc="Attach a research PDF for the selected ticker."
            onRun={doUpload} runLabel="Upload Document" disabled={busy}>
            <TickerSelect value={uploadTicker} onChange={setUploadTicker} tickers={tickers} />
            <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="w-full text-[11px] text-gray-500 file:mr-2 file:rounded-lg file:border-0 file:bg-gray-100 file:px-2 file:py-1 file:text-[11px] file:text-gray-700" />
            {uploadStatus && <p className="text-[10px] text-gray-400">{uploadStatus}</p>}
          </StepCard>

          <StepCard step={4} icon={BarChart3} title="Build Charts" desc="Generate interactive charts for the ticker."
            onRun={() => run('plot', { ticker: plotTicker }, 'Build Charts')} runLabel="Build Charts" disabled={busy}>
            <TickerSelect value={plotTicker} onChange={setPlotTicker} tickers={tickers} />
          </StepCard>

          <StepCard step={5} icon={Play} title="Run AI Analysis" badge="LLM" desc="Generate an AI investment recommendation."
            onRun={() => run('analyze', { ticker: analyzeTicker, mode: analyzeMode }, 'Run AI Analysis')} runLabel="Run AI Analysis" disabled={busy}>
            <TickerSelect value={analyzeTicker} onChange={setAnalyzeTicker} tickers={tickers} />
            <select value={analyzeMode} onChange={(e) => setAnalyzeMode(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30">
              {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </StepCard>
        </div>
      </Card>

      {/* Utilities */}
      <Card title="Utilities">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => run('analyze-all', {}, 'Analyze All')} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 text-white px-3.5 py-2 text-[12px] font-semibold hover:bg-gray-800 disabled:opacity-30">
            <Play size={13} /> Analyze All <span className="rounded bg-white/20 px-1 text-[9px] font-bold">LLM</span>
          </button>
          <button onClick={() => run('list', {}, 'List Tickers')} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:border-gray-300 disabled:opacity-30">
            <List size={13} /> List Tickers
          </button>
          <div className="inline-flex items-center gap-2">
            <TickerSelect value={utilTicker} onChange={setUtilTicker} tickers={tickers} />
            <button onClick={() => run('info', { ticker: utilTicker }, 'Ticker Info')} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:border-gray-300 disabled:opacity-30 whitespace-nowrap">
              <Info size={13} /> Info
            </button>
          </div>
        </div>
      </Card>

      {/* Command output */}
      <Card
        title="Command Output"
        actions={
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${busy ? 'text-amber-600' : 'text-gray-400'}`}>
              <span className={`h-2 w-2 rounded-full ${busy ? 'bg-amber-500 animate-pulse' : 'bg-gray-300'}`} />
              {busy ? `Running: ${runStatus.command}` : 'Idle'}
            </span>
            {busy && (
              <button onClick={cancelRun}
                className="rounded-lg border border-red-200 px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50">
                Cancel
              </button>
            )}
          </div>
        }
      >
        <div ref={logRef} className="max-h-72 overflow-y-auto rounded-xl bg-gray-950 px-4 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-gray-300">
          {runLog || 'Ready to run a pipeline command…'}
        </div>

        {runHistory.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 mr-1"><Terminal size={11} /> Recent:</span>
            {runHistory.map((r) => (
              <button key={r.id} onClick={() => viewLog(r.id)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  historyLog?.id === r.id ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:text-gray-600'
                }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${r.status === 'completed' ? 'bg-emerald-400' : r.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'}`} />
                {r.run_type}{r.ticker ? ` ${r.ticker}` : ''}
              </button>
            ))}
          </div>
        )}
        {historyLog && (
          <div className="mt-2 max-h-44 overflow-y-auto rounded-xl bg-gray-950 p-3 font-mono text-[10px] whitespace-pre-wrap text-gray-400">
            {historyLog.log_output || 'No log.'}
          </div>
        )}
      </Card>
    </div>
  );
}

// ════════════════════════════════════ Signal History tab ══════════════════════
function HistoryTab({ histories, loading, selectedTicker, selectTicker, timeline, detail, setDetail, openDetail }) {
  if (loading && !histories.length) {
    return <Card><div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center"><Loader2 size={16} className="animate-spin" /> Loading signal history…</div></Card>;
  }
  if (!histories.length) {
    return (
      <Card>
        <div className="text-center py-12">
          <History size={28} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm font-semibold text-gray-700">No signal history yet</p>
          <p className="text-[12px] text-gray-400 mt-1">Run an analysis from the Pipeline tab to generate recommendations.</p>
        </div>
      </Card>
    );
  }

  const selected = histories.find((h) => h.ticker === selectedTicker);

  return (
    <div className="space-y-6">
      {/* Ticker picker + summary */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">{selectedTicker || 'Select a ticker'}</h2>
            <select value={selectedTicker} onChange={(e) => selectTicker(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[12px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30">
              {histories.map((h) => <option key={h.ticker} value={h.ticker}>{h.ticker} ({h.total_analyses})</option>)}
            </select>
          </div>
          {selected && (
            <div className="flex items-center gap-4 text-[11px] text-gray-500">
              <span><span className="font-semibold text-gray-800">{selected.total_analyses}</span> analyses</span>
              <span><span className="font-semibold text-gray-800">{selected.signal_changes}</span> signal changes</span>
              <span className="font-mono text-gray-400">{selected.signal_progression}</span>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="mt-6 overflow-x-auto">
          {timeline.length ? (
            <div className="flex items-start gap-6 min-w-min pb-2">
              {timeline.map((p, i) => {
                const c = signalClasses(p.signal);
                return (
                  <button key={p.id || i} onClick={() => openDetail(p)} className="group flex flex-col items-center gap-1.5 shrink-0">
                    <div className="relative flex items-center">
                      {i > 0 && <span className="absolute right-full mr-3 h-px w-6 bg-gray-200" />}
                      <span className={`h-4 w-4 rounded-full ${c.dot} ring-4 ring-white shadow group-hover:scale-125 transition-transform`} />
                    </div>
                    <span className={`text-[11px] font-bold ${c.text}`}>{p.signal}</span>
                    <span className="text-[10px] text-gray-400">{fmtDate(p.date)}</span>
                    {p.signal_changed && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600">changed</span>}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No history for this ticker.</p>
          )}
        </div>

        <div className="mt-5 flex items-center gap-4 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> BUY</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> HOLD</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> AVOID</span>
        </div>
      </Card>

      {/* Detail panel */}
      {detail && <DetailPanel detail={detail} onClose={() => setDetail(null)} />}

      {/* History table */}
      <Card title={`${selectedTicker} Analysis History`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="py-2 pr-3 font-semibold">Date</th>
                <th className="py-2 pr-3 font-semibold">Signal</th>
                <th className="py-2 pr-3 font-semibold">Conviction</th>
                <th className="py-2 pr-3 font-semibold">Position</th>
                <th className="py-2 pr-3 font-semibold">Price Target</th>
                <th className="py-2 pr-3 font-semibold">Changed</th>
              </tr>
            </thead>
            <tbody>
              {[...timeline].reverse().map((e, i) => {
                const c = signalClasses(e.signal);
                return (
                  <tr key={e.id || i} onClick={() => openDetail(e)}
                    className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${e.signal_changed ? 'bg-indigo-50/40' : ''}`}>
                    <td className="py-2.5 pr-3 text-gray-600">{fmtDate(e.date, true)}</td>
                    <td className="py-2.5 pr-3"><span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${c.chip}`}>{e.signal}</span></td>
                    <td className="py-2.5 pr-3 text-gray-600">{e.conviction || '—'}</td>
                    <td className="py-2.5 pr-3 font-mono text-gray-600">{e.position_size_pct != null ? `${Number(e.position_size_pct).toFixed(1)}%` : '—'}</td>
                    <td className="py-2.5 pr-3 font-mono text-gray-600">{e.price_target != null ? `$${Number(e.price_target).toFixed(2)}` : '—'}</td>
                    <td className={`py-2.5 pr-3 font-semibold ${e.signal_changed ? 'text-indigo-600' : 'text-gray-300'}`}>{e.signal_changed ? 'Yes' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function DetailPanel({ detail, onClose }) {
  const rec = detail.recommendation || {};
  const sections = detail.sections || {};
  const c = signalClasses(rec.signal);
  const sectionLabels = {
    executive_summary: 'Executive Summary',
    fundamental_analysis: 'Fundamental Analysis',
    valuation_assessment: 'Valuation Assessment',
    qualitative_factors: 'Qualitative Factors',
    risk_factors: 'Risk Factors',
  };

  return (
    <Card
      title={`${detail.ticker} · ${fmtDate(detail.analysis_date)}`}
      actions={
        <div className="flex items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${c.chip}`}>{rec.signal || '—'}</span>
          <button onClick={onClose} className="rounded-lg border border-gray-200 p-1 text-gray-400 hover:text-gray-700"><X size={14} /></button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-5">
        {[
          { label: 'Conviction', value: rec.conviction || '—' },
          { label: 'Position', value: rec.position_size_pct != null ? `${Number(rec.position_size_pct).toFixed(1)}%` : '—' },
          { label: 'Price Target', value: rec.price_target_12mo != null ? `$${Number(rec.price_target_12mo).toFixed(2)}` : '—' },
          { label: 'Model', value: detail.model || '—' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-gray-50 ring-1 ring-gray-100 p-3">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">{s.label}</div>
            <div className="text-[13px] font-bold text-gray-900 mt-0.5 truncate">{s.value}</div>
          </div>
        ))}
      </div>

      {rec.reasoning && (
        <div className="mb-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Reasoning</h4>
          <p className="text-[13px] text-gray-700 leading-relaxed">{rec.reasoning}</p>
        </div>
      )}

      {(rec.key_catalysts?.length || rec.key_risks?.length) ? (
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          {rec.key_catalysts?.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 mb-1.5">Catalysts</h4>
              <ul className="space-y-1">{rec.key_catalysts.map((k, i) => <li key={i} className="text-[12px] text-gray-600 flex gap-1.5"><span className="text-emerald-500">+</span>{k}</li>)}</ul>
            </div>
          )}
          {rec.key_risks?.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-red-600 mb-1.5">Risks</h4>
              <ul className="space-y-1">{rec.key_risks.map((k, i) => <li key={i} className="text-[12px] text-gray-600 flex gap-1.5"><span className="text-red-500">!</span>{k}</li>)}</ul>
            </div>
          )}
        </div>
      ) : null}

      <div className="space-y-3">
        {Object.entries(sectionLabels).map(([key, label]) =>
          sections[key] ? (
            <details key={key} className="rounded-xl border border-gray-100 p-3" open={key === 'executive_summary'}>
              <summary className="cursor-pointer text-[12px] font-semibold text-gray-800">{label}</summary>
              <p className="mt-2 text-[12px] text-gray-600 leading-relaxed whitespace-pre-wrap">{sections[key]}</p>
            </details>
          ) : null
        )}
      </div>
    </Card>
  );
}
