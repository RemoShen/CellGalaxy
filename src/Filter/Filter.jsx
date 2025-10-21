import React, { useEffect, useMemo, useRef, useState } from "react";
import "./Filter.css";

// Align with DataLoader: use backend base on dev (port 3000)
const API = (typeof window !== 'undefined' && window.location && window.location.port === '3000')
  ? 'http://localhost:8000'
  : '';
// CRA injects PUBLIC_URL at build time; use as an additional hint
// eslint-disable-next-line no-undef
const PUBLIC_URL = (typeof process !== 'undefined' && process.env && process.env.PUBLIC_URL) ? process.env.PUBLIC_URL : '';

// Build a safe JS identifier alias from a column name
function baseNameOf(name) {
  const s = String(name || "");
  const i = s.indexOf("(");
  const base = (i >= 0 ? s.slice(0, i) : s).trim();
  return base.length ? base : s.trim();
}

function aliasOf(name) {
  const base = baseNameOf(name).toLowerCase();
  const a = base.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/__+/g, "_");
  return a || "col";
}

// Guard: only allow safe characters/operators
function isExpressionSafe(expr) {
  return /^[\s\w\d_"'().,!<>=&|+\-/*%\[\]]+$/.test(expr);
}

// Infer basic stats for hinting
function parseDescriptorFromName(name) {
  const s = String(name || "");
  const m = s.match(/\((.*)\)\s*$/);
  if (!m) return { base: baseNameOf(s), choices: null, unit: null, desc: null };
  const inside = m[1].trim();
  // Try parse comma-separated label:value
  const parts = inside.split(/\s*,\s*/);
  const choices = [];
  let choiceLike = true;
  for (const p of parts) {
    const mm = p.match(/^(.*?):\s*(.*)$/);
    if (mm) {
      const label = mm[1].trim();
      let valRaw = mm[2].trim();
      const num = Number(valRaw);
      const value = Number.isFinite(num) ? num : valRaw.replace(/^['"]|['"]$/g, "");
      choices.push({ label, value });
    } else {
      choiceLike = false;
      break;
    }
  }
  if (choiceLike && choices.length) return { base: baseNameOf(s), choices, unit: null, desc: inside };
  // Otherwise treat as unit text
  return { base: baseNameOf(s), choices: null, unit: inside, desc: inside };
}

function buildMetaFromFirstRow(rawObj) {
  const list = [];
  const aliasCount = {};
  for (const [rawName, v] of Object.entries(rawObj || {})) {
    const desc = parseDescriptorFromName(rawName);
    let al = aliasOf(rawName);
    aliasCount[al] = (aliasCount[al] || 0) + 1;
    if (aliasCount[al] > 1) al = `${al}_${aliasCount[al]}`;
    const num = Number(v);
    list.push({
      rawName,
      baseName: desc.base,
      alias: al,
      isNumeric: Number.isFinite(num),
      // We only peek the first row, so no min/max; keep undefined
      min: undefined,
      max: undefined,
      examples: [v],
      choices: desc.choices,
      unit: desc.unit,
      description: desc.desc,
    });
  }
  const aliasIndex = {};
  for (const m of list) aliasIndex[m.alias] = m;
  return { list, aliasIndex };
}

function parseChoicesFromDescription(desc) {
  if (!desc) return null;
  const parts = String(desc).split(/\s*,\s*/);
  const choices = [];
  for (const p of parts) {
    const m = p.match(/^(.*?):\s*(.*)$/);
    if (!m) return null;
    const label = m[1].trim();
    const valRaw = m[2].trim();
    const n = Number(valRaw);
    const value = Number.isFinite(n) ? n : valRaw.replace(/^['"]|['"]$/g, "");
    choices.push({ label, value });
  }
  return choices.length ? choices : null;
}

function buildMetaFromSchema(schemaList) {
  const list = [];
  const aliasCount = {};
  for (const s of schemaList || []) {
    const name = s.name || s.rawName || '';
    const rawName = s.rawName || s.name || '';
    let al = aliasOf(name || rawName);
    aliasCount[al] = (aliasCount[al] || 0) + 1;
    if (aliasCount[al] > 1) al = `${al}_${aliasCount[al]}`;
    const choices = parseChoicesFromDescription(s.description || '');
    list.push({
      rawName,
      baseName: baseNameOf(name || rawName),
      alias: al,
      isNumeric: String(s.type || '').toLowerCase() === 'numeric',
      min: undefined,
      max: undefined,
      examples: [],
      choices,
      unit: null,
      description: s.description || '',
    });
  }
  const aliasIndex = {};
  for (const m of list) aliasIndex[m.alias] = m;
  return { list, aliasIndex };
}

export default function Filter({ setSelectedIds = () => {} }) {
  const [expr, setExpr] = useState("");
  const [error, setError] = useState("");
  const [count, setCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rawRows, setRawRows] = useState(null);
  const [metaList, setMetaList] = useState([]);
  const [aliasIndex, setAliasIndex] = useState({});
  const [loadingMeta, setLoadingMeta] = useState(false);
  const inputRef = useRef(null);
  const [showPopover, setShowPopover] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  // Load raw.json lazily when first needed
  const ensureMeta = useRef(null);
  ensureMeta.current = async () => {
    if (loadingMeta || metaList.length > 0) return;
    let finalized = false;
    const done = () => { if (!finalized) { setLoadingMeta(false); finalized = true; } };
    try {
      setLoadingMeta(true);
      const ts = Date.now();
      const tries = [
        `/public/raw.json?ts=${ts}`,              // FastAPI static or CRA proxy -> backend
        `${API}/public/raw.json?ts=${ts}`,        // direct backend in dev
        `${PUBLIC_URL}/raw.json?ts=${ts}`,        // CRA public base
        `/raw.json?ts=${ts}`,                     // CRA serves public/raw.json at root
      ];
      let data = null;
      for (const url of tries) {
        try {
          // Surface to devtools which URL we are trying
          // eslint-disable-next-line no-console
          console.debug('Filter: fetch', url);
          const r = await fetch(url, { cache: 'no-store' });
          if (r.ok) { data = await r.json(); break; }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('Filter: fetch error', e);
        }
      }
      if (!data) { done(); return; }
      const arr = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : []);
      setRawRows(arr);
      const first = arr[0] || {};
      if (first && first.schema) {
        const { list, aliasIndex } = buildMetaFromSchema(first.schema);
        setMetaList(list.sort((a,b)=>a.baseName.localeCompare(b.baseName)));
        setAliasIndex(aliasIndex);
        done();
        return;
      }
      const firstRaw = first.raw || first.RAW || first.Raw || first; // tolerate bare raw object
      const { list, aliasIndex } = buildMetaFromFirstRow(firstRaw || {});
      setMetaList(list.sort((a,b)=>a.baseName.localeCompare(b.baseName)));
      setAliasIndex(aliasIndex);
      // eslint-disable-next-line no-console
      console.debug('Filter: meta loaded', list.length, 'columns');
      done();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Filter: meta load failed', e);
      done();
    }
  };

  // Try preloading on mount so第一次聚焦更快（若失败不影响，聚焦时仍会再尝试）
  useEffect(() => { ensureMeta.current(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const columns = useMemo(() => metaList.map((m)=>m.rawName), [metaList]);

  // Tokens used in the expression (whole word matches)
  const usedColumns = useMemo(() => {
    if (!metaList.length || !expr) return new Set();
    const set = new Set();
    for (const m of metaList) {
      const re = new RegExp(`\\b${m.alias}\\b`, 'i');
      if (re.test(expr)) set.add(m.rawName);
    }
    return set;
  }, [expr, metaList, columns]);

  // Current word prefix at caret
  const caretPrefix = useMemo(() => {
    const el = inputRef.current;
    const pos = el ? el.selectionStart : expr.length;
    const upto = expr.slice(0, pos);
    const m = upto.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
    return m ? m[1] : "";
  }, [expr]);

  // Suggest columns by typed prefix; grey out those already used
  // Detect context: if an operator is present after a full alias, switch to value suggestions
  const context = useMemo(() => {
    const el = inputRef.current;
    const pos = el ? el.selectionStart : expr.length;
    const upto = expr.slice(0, pos);
    // match: <alias> <op-part>
    const m = upto.match(/([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<|\bin\b)?\s*$/i);
    if (!m) return { mode: 'column' };
    const token = m[1];
    const op = m[2];
    const meta = aliasIndex[token];
    if (meta && op) return { mode: 'value', alias: token, op, meta };
    return { mode: 'column' };
  }, [expr, aliasIndex]);

  const suggestions = useMemo(() => {
    if (context.mode === 'value') {
      const m = context.meta;
      if (!m) return [];
      if (Array.isArray(m.choices) && m.choices.length) {
        return m.choices.map((c) => ({ type: 'value', insert: typeof c.value === 'number' ? String(c.value) : JSON.stringify(c.value), label: `${c.label} = ${c.value}` }));
      }
      if (m.isNumeric) {
        const vals = [];
        if (Number.isFinite(m.min)) vals.push(m.min);
        if (Number.isFinite(m.max) && m.max !== m.min) vals.push(m.max);
        return vals.map((v) => ({ type: 'value', insert: String(v), label: String(v) }));
      }
      const ex = (m.examples || []).slice(0, 6).map((v) => ({ type: 'value', insert: JSON.stringify(v), label: JSON.stringify(v) }));
      return ex;
    }
    // Column suggestions
    const p = caretPrefix.toLowerCase();
    const ordered = [...metaList].sort((a,b)=>{
      const au = usedColumns.has(a.rawName) ? 1 : 0;
      const bu = usedColumns.has(b.rawName) ? 1 : 0;
      if (au !== bu) return au - bu; // unused first
      return a.baseName.localeCompare(b.baseName);
    });
    return ordered
      .filter((m) => !p || m.alias.toLowerCase().startsWith(p))
      .slice(0, 12)
      .map((m) => ({ type: 'column', meta: m }));
  }, [context, caretPrefix, metaList, usedColumns]);

  // Contextual hint when a full column alias is just typed
  const columnHint = useMemo(() => {
    const el = inputRef.current;
    const pos = el ? el.selectionStart : expr.length;
    const upto = expr.slice(0, pos);
    const m = upto.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
    if (!m) return "";
    const token = m[1];
    const meta = aliasIndex[token];
    if (!meta) return "";
    if (Array.isArray(meta.choices) && meta.choices.length) {
      const items = meta.choices.map((c)=>`${c.label}:${c.value}`).join(", ");
      return `${token} == (${items})`;
    }
    if (meta.isNumeric) {
      const min = Number.isFinite(meta.min) ? meta.min : 0;
      const max = Number.isFinite(meta.max) ? meta.max : 0;
      return `${token} > ${min}  |  ${token} < ${max}  |  ${token} == ${min}`;
    }
    const ex = (meta.examples || []).slice(0, 3).map((v) => JSON.stringify(v)).join(", ");
    return ex ? `${token} == ${JSON.stringify((meta.examples||[])[0])}  |  ${token} in [${ex}]` : `${token} == '...'`;
  }, [expr, aliasIndex]);

  const insertTextAtCaret = (text, replaceFromIdx) => {
    const el = inputRef.current;
    const start = typeof replaceFromIdx === 'number' ? replaceFromIdx : el.selectionStart;
    const end = el.selectionEnd;
    const next = expr.slice(0, start) + text + expr.slice(end);
    setExpr(next);
    // restore caret
    requestAnimationFrame(() => {
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
      el.focus();
    });
  };

  const insertSuggestion = (sug) => {
    if (sug.type === 'value') {
      insertTextAtCaret(sug.insert);
      return;
    }
    const alias = sug.meta.alias;
    const m = expr.slice(0, inputRef.current.selectionStart).match(/([A-Za-z_][A-Za-z0-9_]*)$/);
    const replaceFrom = m ? m.index : inputRef.current.selectionStart;
    insertTextAtCaret(alias, replaceFrom);
  };

  const applyFilter = async () => {
    setError("");
    setLoading(true);
    try {
      const rows = rawRows || [];
      if (rows.length === 0) { setSelectedIds(new Set()); setCount(0); return; }
      if (!expr.trim()) { setSelectedIds(new Set()); setCount(0); return; }
      if (!isExpressionSafe(expr)) { setError("表达式包含不支持的字符"); setSelectedIds(new Set()); setCount(0); return; }

      // Build param aliases from known columns (by aliasIndex order)
      const uniqueAliases = Object.keys(aliasIndex);
      const fn = new Function(...uniqueAliases, `return (${expr});`);

      const ids = new Set();
      for (const item of rows) {
        const obj = item?.raw || {};
        const args = uniqueAliases.map((al) => {
          const col = aliasIndex[al]?.rawName;
          return obj[col];
        });
        let ok = false;
        try { ok = Boolean(fn(...args)); }
        catch (e) { setError(String(e?.message || e)); ok = false; }
        if (ok) ids.add(item.id);
      }
      setSelectedIds(ids);
      setCount(ids.size);
    } finally { setLoading(false); }
  };

  const onKeyDown = (e) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab') { e.preventDefault(); insertSuggestion(suggestions[activeIdx] || suggestions[0]); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyFilter(); }
  };

  return (
    <div className="filter-block">
      <div className="filter-title">Filter</div>
      <div className="filter-input-row">
        <input
          ref={inputRef}
          className="filter-input"
          placeholder="输入表达式，例如: sex == 0 || age > 75"
          value={expr}
          onChange={(e) => { setExpr(e.target.value); setActiveIdx(0); }}
          onKeyDown={onKeyDown}
          onFocus={async () => { setShowPopover(true); await ensureMeta.current(); }}
          onBlur={() => setTimeout(() => setShowPopover(false), 120)}
          spellCheck={false}
        />
        <button className="filter-apply" onClick={applyFilter} disabled={loading}>
          {loading ? 'Filtering...' : 'Apply'}
        </button>
      </div>

      {/* Live suggestions popover (on focus and while typing) */}
      {showPopover && (
        <div className="filter-popover">
          {loadingMeta && (
            <div className="filter-popover-empty">正在读取 raw.json...</div>
          )}
          {!loadingMeta && metaList.length === 0 && (
            <div className="filter-popover-empty">未找到可用列</div>
          )}
          {!loadingMeta && metaList.length > 0 && suggestions.length === 0 && (
            <div className="filter-popover-empty">无匹配列（继续输入筛选）</div>
          )}
          {!loadingMeta && suggestions.length > 0 && suggestions.map((s, i) => {
            if (s.type === 'value') {
              return (
                <div
                  key={`v-${i}-${s.label}`}
                  className={`filter-popover-item${i === activeIdx ? ' active' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); insertSuggestion(s); }}
                >
                  <span className="name">{s.label}</span>
                </div>
              );
            }
            const m = s.meta;
            const used = usedColumns.has(m.rawName);
            return (
              <div
                key={`c-${m.alias}`}
                className={`filter-popover-item${i === activeIdx ? ' active' : ''}${used ? ' used' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); insertSuggestion(s); }}
                title={m.rawName}
              >
                <span className="name">{m.alias}</span>
                <span className="sep">→</span>
                <span className="raw">{m.rawName}</span>
                {Array.isArray(m.choices) && m.choices.length ? (
                  <span className="meta">[{m.choices.slice(0,2).map((c)=>`${c.label}:${c.value}`).join(', ')}]</span>
                ) : m.isNumeric ? (
                  <span className="meta">[{Number.isFinite(m.min)?m.min:'-'}, {Number.isFinite(m.max)?m.max:'-'}]</span>
                ) : (
                  <span className="meta">[{(m.examples||[]).slice(0,2).map((v)=>JSON.stringify(v)).join(', ')}]</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Contextual hint when a full column is typed */}
      {columnHint && <div className="filter-hint">{columnHint}</div>}

      <div className="filter-footer">
        <div className="filter-columns">
          {metaList.map((m) => (
            <span
              className={`filter-col-pill${usedColumns.has(m.rawName)?' used':''}`}
              key={m.alias}
              title={m.rawName}
              onMouseDown={(e)=>{e.preventDefault(); insertSuggestion({ type: 'column', meta: m });}}
            >{m.rawName}</span>
          ))}
        </div>
        <div className="filter-status">
          {error ? <span className="filter-error">{error}</span> : (count != null ? <span>匹配: {count}</span> : null)}
        </div>
      </div>
    </div>
  );
}
