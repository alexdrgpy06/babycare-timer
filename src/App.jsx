import React, { useEffect, useMemo, useRef, useState } from "react";

// ÑandeBaby Timer – Single-file React app (UX refresh)
// ✅ Modo claro/oscuro mejorado, contraste fijo
// ✅ UI más simple: Simeticona y Vitamina ahora son botón (sin cantidad)
// ✅ Leche mantiene cantidad + presets
// ✅ Pañal: solo marcar cambio (sin estado)
// ✅ Título e ícono del navegador actualizados
// ✅ Persistencia, CSV, recordatorios locales, pruebas internas

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
  units: { leche: "ml" }, // solo leche usa unidad
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
  const [entries, setEntries] = useLocalStorage("nb_entries", []);
  const [settings, setSettings] = useLocalStorage("nb_settings", DEFAULT_SETTINGS);
  const [dark, setDark] = useLocalStorage("nb_dark", safePrefersDark());
  const [notifEnabled, setNotifEnabled] = useLocalStorage("nb_notif", false);
  const [quickAmount, setQuickAmount] = useLocalStorage("nb_quick_amount", { leche: "120" });
  const [testResults, setTestResults] = useState([]);
  const fileInputRef = useRef(null);

  // App title & favicon
  useEffect(()=>{
    document.title = "ÑandeBaby Timer";
    const svgIcon = encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='${dark ? '#111827' : '#ffffff'}'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='36'>🍼</text></svg>`);
    let link = document.querySelector("link[rel='icon']");
    if(!link){ link = document.createElement('link'); link.rel='icon'; document.head.appendChild(link); }
    link.href = `data:image/svg+xml,${svgIcon}`;
  }, [dark]);

  // Theme
  useEffect(()=>{ document.documentElement.classList.toggle('dark', !!dark); }, [dark]);

  // Derivados
  const lastByType = useMemo(()=> computeLastByType(entries), [entries]);
  const nextDue = useMemo(()=> computeNextDue(lastByType, settings), [lastByType, settings]);

  // ticking countdown
  const [, setTick] = useState(0);
  useEffect(()=>{ const id = setInterval(()=> setTick(x=>x+1), 1000); return ()=> clearInterval(id); },[]);

  // Notificaciones (tab abierta)
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
    if (type === 'leche' && (!amount || String(amount).trim()==="")){
      const val = prompt("¿Cuánto tomó? (ml)", quickAmount.leche || "");
      if (val === null) return; // cancelado
      amount = val;
      setQuickAmount(q=> ({...q, leche: val}));
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
    a.href = url; a.download = `nandebaby_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
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
      { id: 'a1', type: 'leche', time: new Date(tNow-2*3600*1000).toISOString(), amount: '90' },
      { id: 'a2', type: 'leche', time: new Date(tNow-1*3600*1000).toISOString(), amount: '120' },
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
    <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <header className="sticky top-0 z-10 backdrop-blur bg-zinc-50/80 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <span className="text-2xl">🍼</span>
          <div className="flex-1">
            <h1 className="font-semibold text-lg leading-tight">ÑandeBaby Timer</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Registro rápido: Leche, Simeticona, Vitamina y Pañal</p>
          </div>
          <button
            onClick={()=> setDark(d=>!d)}
            className="px-3 py-2 text-sm rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white/60 dark:bg-zinc-800/60">
            {dark ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-6">
        {/* Quick actions */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Leche */}
          <Card label="Leche" emoji="🍼" last={lastByType.leche?.time} due={nextDue.leche}>
            <div className="flex flex-col gap-2">
              <input
                aria-label="Cantidad de leche"
                value={quickAmount.leche}
                onChange={(e)=> setQuickAmount(q=> ({...q, leche: e.target.value}))}
                inputMode="decimal"
                className="w-full px-3 py-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                placeholder={`Cantidad (${settings.units.leche})`}
              />
              <button onClick={()=> addEntry('leche', quickAmount.leche, '')} className="w-full px-4 py-3 rounded-xl bg-blue-600 text-white active:scale-[.98]">Registrar</button>
              <div className="grid grid-cols-4 gap-2 text-xs">
                {['60','90','120','150'].map(preset => (
                  <button key={preset} onClick={()=> setQuickAmount(q=>({...q, leche: preset}))} className="px-2 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900">
                    {preset} {settings.units.leche}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* Simeticona */}
          <Card label="Simeticona" emoji="💧" last={lastByType.simeticona?.time} due={nextDue.simeticona}>
            <button onClick={()=> addEntry('simeticona', '', '')} className="w-full px-4 py-3 rounded-xl bg-indigo-600 text-white active:scale-[.98]">Registrar Simeticona</button>
          </Card>

          {/* Vitamina */}
          <Card label="Vitamina" emoji="✨" last={lastByType.vitamina?.time} due={nextDue.vitamina}>
            <button onClick={()=> addEntry('vitamina', '', '')} className="w-full px-4 py-3 rounded-xl bg-emerald-600 text-white active:scale-[.98]">Registrar Vitamina</button>
          </Card>

          {/* Pañal */}
          <Card label="Pañal" emoji="🚼" last={lastByType.panal?.time} due={nextDue.panal}>
            <button onClick={()=> addEntry('panal', '', 'Cambio de pañal')} className="w-full px-4 py-3 rounded-xl bg-amber-600 text-white active:scale-[.98]">Registrar cambio</button>
          </Card>
        </section>

        {/* Settings */}
        <section className="rounded-2xl p-4 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
          <h2 className="font-semibold mb-3">Horarios y preferencias</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {TYPES.map((t)=> (
              <label key={t.key} className="flex flex-col gap-1 text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">Intervalo de {t.label} (horas)</span>
                <input
                  value={settings.intervals[t.key]}
                  onChange={(e)=> setSettings((s)=> ({...s, intervals: {...s.intervals, [t.key]: Number(e.target.value||0)}}))}
                  type="number" min={0} step={1}
                  className="px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                />
              </label>
            ))}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Unidad de Leche</span>
              <input
                value={settings.units.leche}
                onChange={(e)=> setSettings((s)=> ({...s, units: { leche: e.target.value }}))}
                className="px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Nombre de la bebé</span>
              <input
                value={settings.babyName}
                onChange={(e)=> setSettings((s)=> ({...s, babyName: e.target.value}))}
                className="px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 items-center">
            <button onClick={()=> setNotifEnabled(v=>!v)} className="px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800">
              {notifEnabled ? "🔔 Notificaciones activas" : "🔕 Activar notificaciones"}
            </button>
            <button onClick={handleExport} className="px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800">⬇️ Exportar CSV</button>
            <button onClick={()=> fileInputRef.current?.click()} className="px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800">⬆️ Importar CSV</button>
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
            <button onClick={clearAll} className="ml-auto px-4 py-2 rounded-xl bg-red-600 text-white">Borrar historial</button>
          </div>
        </section>

        {/* Timeline */}
        <section className="rounded-2xl p-0 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
          <div className="px-4 py-3 flex items-center justify-between">
            <h2 className="font-semibold">Historial</h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{entries.length} registros</span>
          </div>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {entries.length === 0 && (
              <li className="p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">Sin registros todavía. Usa los botones de arriba.</li>
            )}
            {entries.map((e)=>{
              const tmeta = TYPES.find(x=>x.key===e.type);
              return (
                <li key={e.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="text-xl" aria-hidden>{tmeta?.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{tmeta?.label} — {fmtTime(e.time)}</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {e.type==='leche' && e.amount ? `${e.amount} ${settings.units.leche}` : (e.type==='leche' ? 'Sin cantidad' : '')}
                      {e.notes ? ` • ${e.notes}` : ""}
                    </div>
                  </div>
                  <button onClick={()=> removeEntry(e.id)} className="text-sm px-3 py-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800">Eliminar</button>
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
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-2">Las pruebas se ejecutan al cargar. Revisa la consola para más detalle.</p>
        </section>
      </main>

      {/* Tailwind CDN */}
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" />
    </div>
  );
}

// -------------------- Reusable Card --------------------
function Card({ label, emoji, last, due, children }){
  return (
    <div className="rounded-2xl p-4 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-2xl" aria-hidden>{emoji}</div>
        <div className="text-sm font-medium">{label}</div>
      </div>
      <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
        {last ? (<>
          Última vez: <span className="font-medium text-zinc-700 dark:text-zinc-200">{fmtTime(last)}</span>
        </>) : "Sin registros aún"}
      </div>
      <div className="mt-1 text-xs">
        {due ? (
          <div className="flex items-center gap-1"><span className="text-zinc-500 dark:text-zinc-400">Próximo en:</span>
            <span className="font-mono text-sm">{diffToCountdown(due)}</span>
          </div>
        ) : <span className="text-zinc-500 dark:text-zinc-400">Configure intervalo</span>}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}