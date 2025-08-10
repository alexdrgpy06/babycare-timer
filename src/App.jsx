import React, { useEffect, useMemo, useRef, useState } from "react";

// BabyCare Timer – Single-file React app (FULL, fixed)
// Responsive, mobile-first UI with large touch targets
// Tracks: Leche (con cantidad), Simeticona, Vitamina y Pañal
// Persiste en localStorage. Exporta/Importa CSV, notificaciones opcionales.
// Fixes: TDZ con lastByType; historial de pañal usa la nota guardada; botones debajo del input.

// -------------------- Utilities --------------------
const nowISO = () => new Date().toISOString();
const fmtTime = (iso) => new Date(iso).toLocaleString();
const pad = (n) => String(n).padStart(2, "0");

const toCSV = (rows) => {
  const header = ["id", "tipo", "hora", "cantidad", "notas"]; 
  const escape = (s) => '"' + String(s ?? "").replace(/"/g, '""') + '"';
  return [header.join(","), ...rows.map(r => [r.id, r.type, r.time, r.amount ?? "", r.notes ?? ""].map(escape).join(","))].join("\n");
};

const fromCSV = async (file) => {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const [h, ...rest] = lines;
  const idx = Object.fromEntries(h.split(',').map((k, i) => [k.trim(), i]));
  return rest.map((line) => {
    const cols = [];
    let cur = ""; let inQ = false;
    for (let i=0;i<line.length;i++){
      const ch = line[i];
      if (ch === '"'){
        if (inQ && line[i+1] === '"'){ cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ){ cols.push(cur); cur=""; }
      else cur += ch;
    }
    cols.push(cur);
    const get = (k) => cols[idx[k]] ?? "";
    return { id: get("id"), type: get("tipo"), time: get("hora"), amount: get("cantidad") || undefined, notes: get("notas") || undefined };
  });
};

const DEFAULT_SETTINGS = {
  intervals: { leche: 3, simeticona: 6, vitamina: 24, panal: 3 }, // horas (0 = sin recordatorio)
  units: { leche: "ml", simeticona: "gts", vitamina: "ml", panal: "" },
  babyName: "Bebé",
};

const TYPES = [
  { key: "leche", label: "Leche", emoji: "🍼" },
  { key: "simeticona", label: "Simeticona", emoji: "💧" },
  { key: "vitamina", label: "Vitamina", emoji: "✨" },
  { key: "panal", label: "Pañal", emoji: "🚼" },
];

// -------------------- Pure helpers (testable) --------------------
function computeLastByType(entries){
  const map = Object.fromEntries(TYPES.map(t => [t.key, null]));
  const sorted = [...entries].sort((a,b)=> new Date(b.time)-new Date(a.time));
  for (const e of sorted){ if (!map[e.type]) map[e.type] = e; }
  return map; // { key: entry|null }
}

function computeNextDue(lastByType, settings){
  const res = Object.fromEntries(TYPES.map(t => [t.key, null]));
  for (const t of TYPES){
    const last = lastByType?.[t.key]?.time;
    const hours = Number(settings?.intervals?.[t.key] || 0);
    if (last && hours>0){
      const due = new Date(new Date(last).getTime() + hours*3600*1000).toISOString();
      res[t.key] = due;
    }
  }
  return res; // { key: iso|null }
}

function diffToCountdown(isoUntil){
  if (!isoUntil) return "--:--:--";
  const ms = new Date(isoUntil).getTime() - Date.now();
  if (Number.isNaN(ms)) return "--:--:--";
  if (ms <= 0) return "¡Ahora!";
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const ss = s%60;
  return `${pad(h)}:${pad(m)}:${pad(ss)}`;
}

function safePrefersDark(){
  try {
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch { return false; }
}

function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }, [key, value]);
  return [value, setValue];
}

// -------------------- Component --------------------
export default function App(){
  const [entries, setEntries] = useLocalStorage("bct_entries", []);
  const [settings, setSettings] = useLocalStorage("bct_settings", DEFAULT_SETTINGS);
  const [dark, setDark] = useLocalStorage("bct_dark", safePrefersDark());
  const [notifEnabled, setNotifEnabled] = useLocalStorage("bct_notif", false);
  const [quickAmount, setQuickAmount] = useLocalStorage("bct_quick_amount", { leche: "120", simeticona: "6", vitamina: "1", panal: "" });
  const [panalEstado, setPanalEstado] = useLocalStorage("bct_panal_estado", "Mojado"); // Mojado | Sucio | Mixto
  const [testResults, setTestResults] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(()=>{ document.documentElement.classList.toggle('dark', !!dark); }, [dark]);

  // Derivados (sin autoreferencia)
  const lastByType = useMemo(()=> computeLastByType(entries), [entries]);
  const nextDue = useMemo(()=> computeNextDue(lastByType, settings), [lastByType, settings]);

  // ticking countdown
  const [, setTick] = useState(0);
  useEffect(()=>{ const id = setInterval(()=> setTick(x=>x+1), 1000); return ()=> clearInterval(id); },[]);

  // Notificaciones básicas (pestaña abierta)
  useEffect(()=>{
    if (!notifEnabled) return; 
    if (typeof Notification !== "undefined" && Notification.permission === "default"){ Notification.requestPermission(); }
    if (!nextDue) return;
    const timers = [];
    for (const t of TYPES){
      const due = nextDue[t.key];
      if (!due) continue;
      const ms = new Date(due).getTime() - Date.now();
      if (Number.isNaN(ms)) continue;
      if (ms > 0 && ms < 24*3600*1000){
        const timer = setTimeout(()=>{
          if (typeof Notification !== "undefined" && Notification.permission === "granted"){
            new Notification(`${t.label}: hora del próximo evento`);
          } else {
            alert(`${t.label}: hora del próximo evento`);
          }
        }, ms);
        timers.push(timer);
      }
    }
    return ()=> timers.forEach(clearTimeout);
  }, [nextDue, notifEnabled]);

  // -------------------- Actions --------------------
  function addEntry(type, amount, notes){
    // Solo pedimos cantidad si es leche y está vacío
    if (type === 'leche' && (!amount || String(amount).trim()==="")){
      const val = prompt("¿Cuánto tomó? (ml)", quickAmount.leche || "");
      if (val === null) return; // cancelado
      amount = val;
      setQuickAmount(q=> ({...q, leche: val}));
    }
    // Para pañal, si no hay nota, usar el estado elegido en el selector
    if (type === 'panal' && (!notes || notes.trim()==="")){
      notes = panalEstado;
    }
    const entry = { id: crypto.randomUUID(), type, time: nowISO(), amount: amount || undefined, notes: notes || undefined };
    setEntries((e)=> [entry, ...e]);
  }

  function removeEntry(id){ setEntries((e)=> e.filter(x=>x.id!==id)); }

  function clearAll(){ if (confirm("¿Borrar todo el historial?")) setEntries([]); }

  function handleExport(){
    const csv = toCSV(entries);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `babycare_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  async function handleImport(ev){
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const rows = await fromCSV(file);
      setEntries((prev)=> {
        const existing = new Set(prev.map(x=>x.id));
        const merged = [...prev, ...rows.filter(r=>!existing.has(r.id))];
        return merged.sort((a,b)=> new Date(b.time)-new Date(a.time));
      });
      alert("Importación completada");
    } catch (e){
      alert("No se pudo importar el CSV");
    } finally { if (fileInputRef.current) fileInputRef.current.value = ""; }
  }

  // -------------------- Simple self-tests --------------------
  useEffect(()=>{
    const results = [];
    function expect(name, cond){ results.push({ name, pass: !!cond }); }

    const tNow = Date.now();
    const mock = [
      { id: 'a1', type: 'leche', time: new Date(tNow-2*3600*1000).toISOString() },
      { id: 'a2', type: 'leche', time: new Date(tNow-1*3600*1000).toISOString() },
      { id: 'b1', type: 'simeticona', time: new Date(tNow-7*3600*1000).toISOString() },
      { id: 'c1', type: 'panal', time: new Date(tNow-30*60*1000).toISOString() },
    ];
    const lb = computeLastByType(mock);
    expect('lastByType leche = a2', lb.leche?.id === 'a2');
    expect('lastByType simeticona = b1', lb.simeticona?.id === 'b1');
    expect('lastByType panal = c1', lb.panal?.id === 'c1');

    const nd = computeNextDue(lb, { intervals: { leche: 3, simeticona: 6, panal: 3 } });
    expect('nextDue leche is ISO', typeof nd.leche === 'string' && !Number.isNaN(Date.parse(nd.leche)));
    expect('nextDue simeticona is ISO', typeof nd.simeticona === 'string' && !Number.isNaN(Date.parse(nd.simeticona)));
    expect('nextDue panal is ISO', typeof nd.panal === 'string' && !Number.isNaN(Date.parse(nd.panal)));

    const future = new Date(Date.now()+90*1000).toISOString();
    expect('diffToCountdown shows 00:01:', diffToCountdown(future).startsWith('00:01'));

    setTestResults(results);
    // eslint-disable-next-line no-console
    console.table(results.map(r=>({ test: r.name, pass: r.pass })));
  }, []);

  // -------------------- UI --------------------
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 dark:bg-zinc-900/70 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <span className="text-2xl">👶</span>
          <div className="flex-1">
            <h1 className="font-semibold text-lg leading-tight">BabyCare Timer</h1>
            <p className="text-xs text-zinc-500">Registro rápido de leche, simeticona, vitaminas y pañal</p>
          </div>
          <button
            onClick={()=> setDark(d=>!d)}
            className="px-3 py-2 text-sm rounded-xl border border-zinc-300 dark:border-zinc-700">
            {dark ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-6">
        {/* Quick actions */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {TYPES.map((t)=>{
            const due = nextDue?.[t.key] ?? null;
            const last = lastByType?.[t.key]?.time ?? null;
            return (
              <div key={t.key} className="rounded-2xl p-4 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-2xl" aria-hidden>{t.emoji}</div>
                  <div className="text-sm font-medium">{t.label}</div>
                </div>

                <div className="mt-2 text-xs text-zinc-500">
                  {last ? (<>
                    Última vez: <span className="font-medium text-zinc-700 dark:text-zinc-200">{fmtTime(last)}</span>
                  </>) : "Sin registros aún"}
                </div>

                <div className="mt-1 text-xs">
                  {due ? (
                    <div className="flex items-center gap-1"><span className="text-zinc-500">Próximo en:</span>
                      <span className="font-mono text-sm">{diffToCountdown(due)}</span>
                    </div>
                  ) : <span className="text-zinc-500">Configure intervalo</span>}
                </div>

                {/* Inputs por tipo: botón debajo del input */}
                {t.key !== 'panal' ? (
                  <div className="mt-4 flex flex-col gap-2">
                    <input
                      aria-label={`Cantidad para ${t.label}`}
                      value={quickAmount[t.key] ?? ""}
                      onChange={(e)=> setQuickAmount((qa)=> ({...qa, [t.key]: e.target.value}))}
                      inputMode="decimal"
                      className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900"
                      placeholder={`Cantidad (${settings.units[t.key] || ''})`}
                    />
                    <button
                      onClick={()=> addEntry(t.key, quickAmount[t.key], "")}
                      className="w-full px-4 py-2 rounded-xl bg-blue-600 text-white active:scale-[.98]">
                      Registrar
                    </button>
                    {t.key === 'leche' && (
                      <div className="grid grid-cols-4 gap-2 text-xs pt-1">
                        {['60','90','120','150'].map(preset => (
                          <button key={preset} onClick={()=> setQuickAmount(q=>({...q, leche: preset}))} className="px-2 py-1 rounded-lg border border-zinc-300 dark:border-zinc-700">
                            {preset} {settings.units.leche}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 flex flex-col gap-2">
                    <select
                      aria-label="Estado del pañal"
                      value={panalEstado}
                      onChange={(e)=> setPanalEstado(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900"
                    >
                      <option>Mojado</option>
                      <option>Sucio</option>
                      <option>Mixto</option>
                    </select>
                    <button
                      onClick={()=> addEntry('panal', '', panalEstado)}
                      className="w-full px-4 py-2 rounded-xl bg-blue-600 text-white active:scale-[.98]">
                      Registrar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* Settings */}
        <section className="rounded-2xl p-4 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm">
          <h2 className="font-semibold mb-3">Horarios y preferencias</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {TYPES.map((t)=> (
              <label key={t.key} className="flex flex-col gap-1 text-sm">
                <span className="text-zinc-500">Intervalo de {t.label} (horas)</span>
                <input
                  value={settings.intervals[t.key]}
                  onChange={(e)=> setSettings((s)=> ({...s, intervals: {...s.intervals, [t.key]: Number(e.target.value||0)}}))}
                  type="number" min={0} step={1}
                  className="px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {TYPES.map((t)=> (
              <label key={t.key+"u"} className="flex flex-col gap-1 text-sm">
                <span className="text-zinc-500">Unidad de {t.label}</span>
                <input
                  value={settings.units[t.key]}
                  onChange={(e)=> setSettings((s)=> ({...s, units: {...s.units, [t.key]: e.target.value}}))}
                  className="px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900"
                />
              </label>
            ))}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Nombre de la bebé</span>
              <input
                value={settings.babyName}
                onChange={(e)=> setSettings((s)=> ({...s, babyName: e.target.value}))}
                className="px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 items-center">
            <button onClick={()=> setNotifEnabled(v=>!v)} className="px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700">
              {notifEnabled ? "🔔 Notificaciones activas" : "🔕 Activar notificaciones"}
            </button>
            <button onClick={handleExport} className="px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700">⬇️ Exportar CSV</button>
            <button onClick={()=> fileInputRef.current?.click()} className="px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700">⬆️ Importar CSV</button>
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
            <button onClick={clearAll} className="ml-auto px-4 py-2 rounded-xl bg-red-600 text-white">Borrar historial</button>
          </div>
        </section>

        {/* Timeline */}
        <section className="rounded-2xl p-0 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden shadow-sm">
          <div className="px-4 py-3 flex items-center justify-between">
            <h2 className="font-semibold">Historial</h2>
            <span className="text-xs text-zinc-500">{entries.length} registros</span>
          </div>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {entries.length === 0 && (
              <li className="p-6 text-center text-sm text-zinc-500">Sin registros todavía. Use los botones de arriba para registrar.</li>
            )}
            {entries.map((e)=>{
              const tmeta = TYPES.find(x=>x.key===e.type);
              return (
                <li key={e.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="text-xl" aria-hidden>{tmeta?.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{tmeta?.label} — {fmtTime(e.time)}</div>
                    <div className="text-xs text-zinc-500 truncate">
                      {e.amount ? `${e.amount} ${settings.units[e.type] || ''}` : "Sin cantidad"}
                      {e.notes ? ` • ${e.notes}` : ""}
                    </div>
                  </div>
                  <button onClick={()=> removeEntry(e.id)} className="text-sm px-3 py-1 rounded-lg border border-zinc-300 dark:border-zinc-700">Eliminar</button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Diagnostics */}
        <section className="rounded-2xl p-4 border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-900/40">
          <h3 className="font-medium text-sm mb-2">Pruebas internas</h3>
          <ul className="text-xs space-y-1">
            {testResults.map((r, i)=> (
              <li key={i} className={r.pass?"text-green-600":"text-red-500"}>
                {r.pass ? "✔" : "✖"} {r.name}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-zinc-500 mt-2">Las pruebas se ejecutan al cargar. Revise la consola para más detalle.</p>
        </section>

        {/* Helper info */}
        <section className="text-xs text-zinc-500 text-center pb-10">
          <p>
            Consejos: defina los intervalos (p. ej., Leche cada 3h, Simeticona cada 6h, Vitamina cada 24h, Pañal cada 3h o 0 para desactivar). 
            Active notificaciones para avisos locales mientras la app esté abierta.
          </p>
        </section>
      </main>

      {/* Tailwind CDN for quick demo */}
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" />
    </div>
  );
}
