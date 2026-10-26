(function () {
  'use strict';
  const S = window.MPSolver;
  const $ = id => document.getElementById(id);
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const EXAMPLES = [
    { file: 'examples/power_pack_mission.json', title: 'Power pack mission (multiphysics, transient)' },
    { file: 'examples/a320_green.json', title: 'A320 Green hydraulic system' },
    { file: 'examples/excel_reference.json', title: 'Excel reference v1.4 (validation)' }
  ];
  const BASE_KEYS = ['name', 'domain', 'type', 'cell', 'n1', 'n2', 'heatTo'];
  const TYPES = {
    th: { G: { G: 10 }, Q: { P: 100, on: 'on' }, HX: { mdot: 0.1, cp: 4186, eff: 0.8 } },
    el: { R: { R: 1 }, V: { E: 28, Rint: 0.01 }, I: { I: 1 }, BAT: { vmin: 24, vmax: 28, Rint: 0.02, capacityAh: 20, soc0: 1 }, LOAD: { P: 500, eff: 0, Vnom: 28, on: 'on' }, MOTORPUMP: { pump: 'P1', eta: 0.85, on: 'on' }, SW: { Ron: 0.0001, on: 'on' } }
  };
  const TYPE_LABEL = { G: 'Conductance', Q: 'Heat source', HX: 'Heat exchanger', R: 'Resistor', V: 'Voltage source', I: 'Current source', BAT: 'Battery', LOAD: 'Constant-power load', MOTORPUMP: 'Motor-pump', SW: 'Switch' };
  let model = null, last = null, plotSel = new Set();
  const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
  const PY_FILES = ['__init__.py', 'solver.py', 'validation.py'];
  let pyReady = null;
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }
  function pyodideEngine() {
    if (pyReady) return pyReady;
    pyReady = (async () => {
      setStatus('Loading Python (Pyodide, about 10 MB – only the first time) …');
      if (!window.loadPyodide) await loadScript(PYODIDE_URL + 'pyodide.js');
      const py = await window.loadPyodide({ indexURL: PYODIDE_URL });
      py.FS.mkdirTree('/home/pyodide/boheme_mp');
      for (const f of PY_FILES) {
        const r = await fetch('python/boheme_mp/' + f, { cache: 'no-store' });
        if (!r.ok) throw new Error('python/boheme_mp/' + f + ' (HTTP ' + r.status + ')');
        py.FS.writeFile('/home/pyodide/boheme_mp/' + f, await r.text());
      }
      py.runPython("import sys\nif '/home/pyodide' not in sys.path: sys.path.insert(0, '/home/pyodide')\nimport boheme_mp");
      return py;
    })();
    pyReady.catch(() => { pyReady = null; });
    return pyReady;
  }
  async function engineSimulate(m) {
    const eng = $('engine').value;
    if (eng === 'js') return { res: S.simulate(m), name: 'JavaScript' };
    if (eng === 'pyodide') {
      const py = await pyodideEngine();
      py.globals.set('bmp_model_json', JSON.stringify(m));
      const out = JSON.parse(py.runPython('from boheme_mp.solver import simulate_json\nsimulate_json(bmp_model_json)'));
      if (!out.ok) throw new Error(out.error);
      return { res: out.result, name: 'Python (Pyodide ' + py.version + ')' };
    }
    const url = ($('serverUrl').value || '').trim().replace(/\/+$/, '');
    if (!url) throw new Error('Enter the server URL in the side bar.');
    const r = await fetch(url + '/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(Array.isArray(j.detail) ? j.detail.join('; ') : (j.detail || ('HTTP ' + r.status)));
    return { res: j.result, name: 'Python server' };
  }

  function blankModel() {
    return {
      title: 'New project', description: '',
      fluid: { model: 'skydrol', T: 20, tempNode: '' },
      hydParams: { g: 9.80665, krough: 0.0015, dUcrit: 1e-7, niter: 999, lambdaU: 0.6, kReD: 0.2, ReDcrit: 2320, zanke: false },
      ptu: { logic: true, thresholdPsi: 500 },
      nodes: [{ id: 'S0', domain: 'hyd', tap: true, z: 0 }, { id: 'N01', domain: 'hyd', z: 0 }],
      components: [{ name: 'P1', domain: 'hyd', cell: 'P1 1 19.6', n1: 'S0', n2: 'N01' }, { name: 'R01', domain: 'hyd', cell: 'R01 5 10', n1: 'N01', n2: 'S0' }],
      events: [], sim: { mode: 'steady', dt: 1, tEnd: 60, startSteady: false }
    };
  }

  function setStatus(msg, cls) { const s = $('status'); s.textContent = msg; s.className = cls || ''; }
  function save() { try { localStorage.setItem('bmp_model', JSON.stringify(model)); } catch (e) {} }
  function num(v, d) { const x = Number(String(v).replace(',', '.')); return Number.isFinite(x) ? x : d; }
  function fmt(v, d) { if (v === undefined || v === null || !Number.isFinite(Number(v))) return ''; const x = Math.abs(Number(v)) < 1e-9 ? 0 : Number(v); if (x !== 0 && (Math.abs(x) >= 1e6 || Math.abs(x) < 1e-3)) return x.toExponential(3); return x.toFixed(d === undefined ? 3 : d); }

  function paramString(c) { return Object.keys(c).filter(k => !BASE_KEYS.includes(k)).map(k => k + '=' + c[k]).join('; '); }
  function parseParams(c, s) {
    Object.keys(c).filter(k => !BASE_KEYS.includes(k)).forEach(k => delete c[k]);
    String(s).split(/[;,]/).map(x => x.trim()).filter(Boolean).forEach(kv => {
      const i = kv.indexOf('='); if (i < 1) return;
      const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      c[k] = isNaN(Number(v)) || v === '' ? v : Number(v);
    });
  }

  function loadSide() {
    $('title').value = model.title || '';
    $('descTxt').textContent = model.description || '';
    const sim = model.sim || (model.sim = {});
    $('simMode').value = sim.mode || 'steady';
    $('simDt').value = sim.dt !== undefined ? sim.dt : 1;
    $('simEnd').value = sim.tEnd !== undefined ? sim.tEnd : 60;
    $('simSteadyStart').checked = sim.startSteady === true;
    const f = model.fluid || (model.fluid = { model: 'skydrol', T: 20 });
    $('fluidModel').innerHTML = Object.keys(S.FLUIDS).map(k => '<option value="' + k + '">' + esc(S.FLUIDS[k].label) + '</option>').join('') + '<option value="custom">Custom (ρ, μ constant)</option>';
    $('fluidModel').value = f.model || 'skydrol';
    $('fluidT').value = f.T !== undefined ? f.T : 20;
    $('fluidRho').value = f.rho !== undefined ? f.rho : 1000;
    $('fluidMu').value = f.mu !== undefined ? f.mu : 0.001;
    const th = model.nodes.filter(n => n.domain === 'th' && !Number.isFinite(n.fixed));
    $('fluidNode').innerHTML = '<option value="">– fixed temperature –</option>' + th.map(n => '<option value="' + esc(n.id) + '">' + esc(n.id) + '</option>').join('');
    $('fluidNode').value = f.tempNode || '';
    $('customFluid').style.display = f.model === 'custom' ? '' : 'none';
    $('rowFluidT').style.display = f.model === 'custom' ? 'none' : '';
    const p = model.ptu || (model.ptu = { logic: true, thresholdPsi: 500 });
    $('ptuLogic').value = p.logic === false ? 'off' : 'on';
    $('ptuThr').value = p.thresholdPsi !== undefined ? p.thresholdPsi : 500;
    const h = model.hydParams || (model.hydParams = {});
    $('hpKr').value = h.krough !== undefined ? h.krough : 0.0015;
    $('hpLam').value = h.lambdaU !== undefined ? h.lambdaU : 0.6;
    $('hpDu').value = h.dUcrit !== undefined ? h.dUcrit : 1e-7;
    $('hpIt').value = h.niter !== undefined ? h.niter : 999;
    $('hpRe').value = h.ReDcrit !== undefined ? h.ReDcrit : 2320;
    $('hpK').value = h.kReD !== undefined ? h.kReD : 0.2;
    $('hpG').value = h.g !== undefined ? h.g : 9.80665;
    $('hpZ').value = h.zanke ? '1' : '0';
  }
  function readSide() {
    model.title = $('title').value;
    model.sim = { mode: $('simMode').value, dt: num($('simDt').value, 1), tEnd: num($('simEnd').value, 60), startSteady: $('simSteadyStart').checked };
    model.fluid = { model: $('fluidModel').value, T: num($('fluidT').value, 20), tempNode: $('fluidNode').value, rho: num($('fluidRho').value, 1000), mu: num($('fluidMu').value, 0.001) };
    model.ptu = { logic: $('ptuLogic').value === 'on', thresholdPsi: num($('ptuThr').value, 500) };
    model.hydParams = { krough: num($('hpKr').value, 0.0015), lambdaU: num($('hpLam').value, 0.6), dUcrit: num($('hpDu').value, 1e-7), niter: num($('hpIt').value, 999), ReDcrit: num($('hpRe').value, 2320), kReD: num($('hpK').value, 0.2), g: num($('hpG').value, 9.80665), zanke: $('hpZ').value === '1' };
    $('customFluid').style.display = model.fluid.model === 'custom' ? '' : 'none';
    $('rowFluidT').style.display = model.fluid.model === 'custom' ? 'none' : '';
    save();
  }

  function nodeOptions(domain, sel, allowEmpty) {
    const opts = model.nodes.filter(n => n.domain === domain).map(n => '<option value="' + esc(n.id) + '"' + (n.id === sel ? ' selected' : '') + '>' + esc(n.id) + '</option>');
    return (allowEmpty ? '<option value="">–</option>' : '') + opts.join('');
  }

  function renderNodes() {
    const h = '<tr><th>ID</th><th>Domain</th><th title="Fixed potential (boundary): temperature [°C] or voltage [V]">Fixed value</th><th title="Hydraulic: reservoir/tap (fixed pressure ρ·g·z)">Tap</th><th>Elevation z [m]</th><th title="Thermal capacity for transient runs">C [J/K]</th><th title="Initial temperature [°C] / voltage guess [V]">Initial</th><th></th></tr>';
    const rows = model.nodes.map((n, i) => {
      const d = n.domain;
      return '<tr data-i="' + i + '"><td><input data-f="id" value="' + esc(n.id) + '"></td><td><span class="dom ' + d + '">' + d + '</span></td>' +
        '<td>' + (d === 'hyd' ? '' : '<input data-f="fixed" value="' + (Number.isFinite(n.fixed) ? n.fixed : '') + '" placeholder="free">') + '</td>' +
        '<td>' + (d === 'hyd' ? '<input type="checkbox" data-f="tap"' + (n.tap ? ' checked' : '') + ' style="width:auto">' : '') + '</td>' +
        '<td>' + (d === 'hyd' ? '<input data-f="z" value="' + (n.z !== undefined ? n.z : 0) + '">' : '') + '</td>' +
        '<td>' + (d === 'th' ? '<input data-f="C" value="' + (n.C !== undefined ? n.C : '') + '" placeholder="0">' : '') + '</td>' +
        '<td>' + (d === 'th' ? '<input data-f="T0" value="' + (n.T0 !== undefined ? n.T0 : '') + '" placeholder="20">' : d === 'el' ? '<input data-f="V0" value="' + (n.V0 !== undefined ? n.V0 : '') + '" placeholder="0">' : '') + '</td>' +
        '<td><button class="x" data-del="' + i + '" title="Delete node">✕</button></td></tr>';
    });
    $('tNodes').innerHTML = h + rows.join('');
  }
  function renderComps() {
    const h = '<tr><th>Name</th><th>Domain</th><th>Type / cell</th><th>Node 1</th><th>Node 2</th><th>Parameters</th><th title="Thermal node that receives the losses of this component">Heat to</th><th></th></tr>';
    const rows = model.components.map((c, i) => {
      const d = c.domain;
      let typ;
      if (d === 'hyd') typ = '<input data-f="cell" value="' + esc(c.cell) + '" title="BOHEME cell syntax, e.g. R01 5 10 (length m, diameter mm)">';
      else typ = '<select data-f="type">' + Object.keys(TYPES[d]).map(t => '<option value="' + t + '"' + (t === c.type ? ' selected' : '') + '>' + t + ' – ' + TYPE_LABEL[t] + '</option>').join('') + '</select>';
      const single = d === 'th' && c.type === 'Q';
      return '<tr data-i="' + i + '"><td><input data-f="name" value="' + esc(c.name) + '"></td><td><span class="dom ' + d + '">' + d + '</span></td><td>' + typ + '</td>' +
        '<td><select data-f="n1">' + nodeOptions(d, c.n1) + '</select></td>' +
        '<td>' + (single ? '' : '<select data-f="n2">' + nodeOptions(d, c.n2) + '</select>') + '</td>' +
        '<td>' + (d === 'hyd' ? '<span style="color:var(--mut)">in cell</span>' : '<input data-f="params" value="' + esc(paramString(c)) + '">') + '</td>' +
        '<td>' + (d === 'th' ? '' : '<select data-f="heatTo">' + nodeOptions('th', c.heatTo, true) + '</select>') + '</td>' +
        '<td><button class="x" data-delc="' + i + '" title="Delete component">✕</button></td></tr>';
    });
    $('tComps').innerHTML = h + rows.join('');
  }
  function renderEvents() {
    const h = '<tr><th>t [s]</th><th>Component</th><th title="Field to change: cell (hydraulic), on, P, E, R, …">Field</th><th>Value</th><th></th></tr>';
    const rows = (model.events || []).map((e, i) => '<tr data-i="' + i + '"><td><input data-f="t" value="' + esc(e.t) + '"></td><td><select data-f="comp">' + model.components.map(c => '<option' + (c.name === e.comp ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></td><td><input data-f="field" value="' + esc(e.field) + '"></td><td><input data-f="value" value="' + esc(e.value) + '"></td><td><button class="x" data-dele="' + i + '">✕</button></td></tr>');
    $('tEvents').innerHTML = h + (rows.length ? rows.join('') : '<tr><td colspan="5" style="color:var(--mut)">No events. Example: t = 120, component Rl_V, field cell, value “Rl_V 9999 999” closes a valve.</td></tr>');
  }
  function renderModel() { loadSide(); renderNodes(); renderComps(); renderEvents(); drawDiagram(); }

  function bindTables() {
    $('tNodes').addEventListener('change', e => {
      const tr = e.target.closest('tr'); if (!tr) return; const n = model.nodes[+tr.dataset.i]; const f = e.target.dataset.f;
      if (f === 'id') { const old = n.id, nw = e.target.value.trim(); if (!nw) return; n.id = nw; model.components.forEach(c => { ['n1', 'n2', 'heatTo'].forEach(k => { if (c[k] === old) c[k] = nw; }); }); if (model.fluid && model.fluid.tempNode === old) model.fluid.tempNode = nw; }
      else if (f === 'tap') n.tap = e.target.checked;
      else if (f === 'fixed') { const v = e.target.value.trim(); if (v === '') delete n.fixed; else n.fixed = num(v, 0); }
      else { const v = e.target.value.trim(); if (v === '') delete n[f]; else n[f] = num(v, 0); }
      save(); renderModel();
    });
    $('tNodes').addEventListener('click', e => { const i = e.target.dataset.del; if (i === undefined) return; const id = model.nodes[+i].id; if (model.components.some(c => c.n1 === id || c.n2 === id)) { alert('Node ' + id + ' is still used by a component.'); return; } model.nodes.splice(+i, 1); save(); renderModel(); });
    $('tComps').addEventListener('change', e => {
      const tr = e.target.closest('tr'); if (!tr) return; const c = model.components[+tr.dataset.i]; const f = e.target.dataset.f;
      if (f === 'name') { const old = c.name, nw = e.target.value.trim(); if (!nw) return; c.name = nw; if (c.domain === 'hyd') { const t = String(c.cell).trim().split(/\s+/); if (t[0] === old) { t[0] = nw; c.cell = t.join(' '); } } (model.events || []).forEach(ev => { if (ev.comp === old) ev.comp = nw; }); model.components.forEach(x => { if (x.pump === old) x.pump = nw; }); }
      else if (f === 'cell') { c.cell = e.target.value.trim(); const nm = c.cell.split(/\s+/)[0]; if (nm) c.name = nm; }
      else if (f === 'type') { const keep = { name: c.name, domain: c.domain, n1: c.n1, n2: c.n2, heatTo: c.heatTo }; Object.keys(c).forEach(k => delete c[k]); Object.assign(c, keep, { type: e.target.value }, TYPES[c.domain][e.target.value]); }
      else if (f === 'params') parseParams(c, e.target.value);
      else c[f] = e.target.value;
      save(); renderModel();
    });
    $('tComps').addEventListener('click', e => { const i = e.target.dataset.delc; if (i === undefined) return; const nm = model.components[+i].name; model.components.splice(+i, 1); model.events = (model.events || []).filter(ev => ev.comp !== nm); save(); renderModel(); });
    $('tEvents').addEventListener('change', e => { const tr = e.target.closest('tr'); if (!tr) return; const ev = model.events[+tr.dataset.i]; const f = e.target.dataset.f; ev[f] = f === 't' ? num(e.target.value, 0) : e.target.value; save(); });
    $('tEvents').addEventListener('click', e => { const i = e.target.dataset.dele; if (i === undefined) return; model.events.splice(+i, 1); save(); renderEvents(); });
    document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
      const d = b.dataset.add; const pre = d === 'hyd' ? 'N' : d === 'th' ? 'T' : 'E'; let k = 1; while (model.nodes.some(n => n.id === pre + String(k).padStart(2, '0'))) k++;
      const n = { id: pre + String(k).padStart(2, '0'), domain: d }; if (d === 'hyd') n.z = 0; model.nodes.push(n); save(); renderModel();
    }));
    document.querySelectorAll('[data-addc]').forEach(b => b.addEventListener('click', () => {
      const d = b.dataset.addc; const nodes = model.nodes.filter(n => n.domain === d);
      if (nodes.length < (d === 'th' ? 1 : 2)) { alert('Add at least ' + (d === 'th' ? 'one' : 'two') + ' ' + d + ' node(s) first.'); return; }
      let c;
      if (d === 'hyd') { let k = 1; while (model.components.some(x => x.name === 'R' + String(k).padStart(2, '0'))) k++; const nm = 'R' + String(k).padStart(2, '0'); c = { name: nm, domain: 'hyd', cell: nm + ' 1 10', n1: nodes[0].id, n2: nodes[1].id }; }
      else { const t = d === 'th' ? 'G' : 'R'; let k = 1; while (model.components.some(x => x.name === t + '_' + k)) k++; c = Object.assign({ name: t + '_' + k, domain: d, type: t, n1: nodes[0].id, n2: (nodes[1] || nodes[0]).id }, TYPES[d][t]); }
      model.components.push(c); save(); renderModel();
    }));
    $('addEvent').addEventListener('click', () => { if (!model.components.length) return; (model.events = model.events || []).push({ t: 0, comp: model.components[0].name, field: 'on', value: 'off' }); save(); renderEvents(); });
  }

  function run() {
    readSide();
    setStatus('Running …');
    setTimeout(async () => {
      try {
        const errs = S.validateModel(model);
        if (errs.length) throw new Error(errs.join(' · '));
        const t0 = performance.now();
        const out = await engineSimulate(JSON.parse(JSON.stringify(model)));
        last = out.res;
        const ms = performance.now() - t0;
        const f = last.final;
        let msg = out.name + ' · ' + (last.mode === 'transient' ? 'Transient: ' + (last.steps.length - 1) + ' steps' : 'Steady state') + ' · ' + ms.toFixed(0) + ' ms';
        if (f.hyd) msg += ' · hydraulics ' + (f.hyd.converged ? 'converged' : 'NOT CONVERGED') + ' (' + f.hyd.iterations + ' it., residual ' + f.hyd.residual.toExponential(2) + ')';
        if (f.hyd && f.hyd.ptu && f.hyd.ptu.present) msg += ' · PTU ' + (f.hyd.ptu.enabled ? (f.hyd.ptu.active ? 'active' : 'inactive') + ' (Δp w/o PTU ' + Math.round(f.hyd.ptu.dpOffPsi) + ' psi)' : 'always on');
        if (f.coupleIt > 1) msg += ' · coupling iterations ' + f.coupleIt;
        setStatus(msg, f.hyd && !f.hyd.converged ? 'err' : 'ok');
        if (last.mode === 'transient' && plotSel.size === 0) defaultSignals();
        renderResults(last.steps.length - 1);
        drawDiagram();
        if (window.View3D) window.View3D.onSolveComplete();
        activate('results');
      } catch (err) { setStatus('Error: ' + err.message, 'err'); }
    }, 20);
  }

  function signalsOf(step) {
    const sig = [];
    if (step.hyd) { Object.keys(step.hyd.nodes).forEach(k => sig.push({ key: 'p:' + k, grp: 'Hydraulic pressure [bar]', label: 'p ' + k, get: s => s.hyd && s.hyd.nodes[k] })); Object.keys(step.hyd.components).forEach(k => sig.push({ key: 'q:' + k, grp: 'Hydraulic flow [m³/h]', label: 'Q ' + k, get: s => s.hyd && s.hyd.components[k] && s.hyd.components[k].q })); }
    if (step.T) Object.keys(step.T).forEach(k => sig.push({ key: 'T:' + k, grp: 'Temperature [°C]', label: 'T ' + k, get: s => s.T && s.T[k] }));
    if (step.el) { Object.keys(step.el.nodes).forEach(k => sig.push({ key: 'V:' + k, grp: 'Voltage [V]', label: 'V ' + k, get: s => s.el && s.el.nodes[k] })); Object.keys(step.el.components).forEach(k => { sig.push({ key: 'P:' + k, grp: 'Electrical power [W]', label: 'P ' + k, get: s => s.el && s.el.components[k] && s.el.components[k].p }); sig.push({ key: 'I:' + k, grp: 'Current [A]', label: 'I ' + k, get: s => s.el && s.el.components[k] && s.el.components[k].i }); }); }
    if (step.soc) Object.keys(step.soc).forEach(k => sig.push({ key: 'soc:' + k, grp: 'State of charge [–]', label: 'SOC ' + k, get: s => s.soc && s.soc[k] }));
    return sig;
  }
  function defaultSignals() { const s = signalsOf(last.final); plotSel = new Set(s.filter(x => x.grp.startsWith('Temperature') && !model.nodes.some(n => n.id === x.key.slice(2) && Number.isFinite(n.fixed))).slice(0, 4).map(x => x.key)); }

  function renderResults(stepIdx) {
    if (!last) return;
    const st = last.steps[stepIdx];
    const k = [];
    if (st.hyd) { const ps = Object.values(st.hyd.nodes); k.push(['max. pressure', fmt(Math.max(...ps), 2) + ' bar']); }
    if (st.T && Object.keys(st.T).length) { const ts = Object.values(st.T); k.push(['max. temperature', fmt(Math.max(...ts), 2) + ' °C']); }
    if (st.el) { const pw = Object.values(st.el.components).filter(c => c.type === 'LOAD' || c.type === 'MOTORPUMP').reduce((a, c) => a + c.p, 0); k.push(['electrical load', fmt(pw / 1000, 2) + ' kW']); }
    if (st.soc && Object.keys(st.soc).length) Object.keys(st.soc).forEach(b => k.push(['SOC ' + b, fmt(st.soc[b] * 100, 1) + ' %']));
    if (last.mode === 'transient') k.unshift(['time', fmt(st.t, 1) + ' s']);
    $('resKpi').innerHTML = k.map(x => '<div><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>').join('');
    if (last.mode === 'transient') {
      const sig = signalsOf(last.final);
      const groups = [...new Set(sig.map(s => s.grp))];
      $('resPlot').innerHTML = '<div class="card"><h2>Time history <small>– choose signals</small> <button class="btn sm" id="btnCsv" style="float:right">⬇ CSV</button></h2><div class="plotwrap"><div class="siglist">' + groups.map(g => '<div class="grp">' + esc(g) + '</div>' + sig.filter(s => s.grp === g).map(s => '<label><input type="checkbox" data-sig="' + esc(s.key) + '"' + (plotSel.has(s.key) ? ' checked' : '') + '>' + esc(s.label) + '</label>').join('')).join('') + '</div><svg id="plot" height="420"></svg></div><div class="row" style="margin-top:8px"><label style="flex:0 0 auto">Tables at t =</label><input type="range" id="tSlider" min="0" max="' + (last.steps.length - 1) + '" value="' + stepIdx + '" style="flex:1"><b id="tVal">' + fmt(st.t, 1) + ' s</b></div></div>';
      $('resPlot').querySelectorAll('[data-sig]').forEach(cb => cb.addEventListener('change', () => { if (cb.checked) plotSel.add(cb.dataset.sig); else plotSel.delete(cb.dataset.sig); drawPlot(sig, stepIdx); }));
      $('tSlider').addEventListener('input', e => { renderResults(+e.target.value); });
      $('btnCsv').addEventListener('click', () => exportCsv(sig));
      drawPlot(sig, stepIdx);
    } else $('resPlot').innerHTML = '';
    const blocks = [];
    if (st.hyd) {
      blocks.push(table('Hydraulic nodes', ['Node', 'p [bar]'], Object.keys(st.hyd.nodes).map(id => [id, fmt(st.hyd.nodes[id], 4)])));
      blocks.push(table('Hydraulic components', ['Name', 'Type', 'Node 1', 'Node 2', 'Q [m³/h]', 'ΔP [bar]', 'U [m/s]', 'Re [–]', 'P [kW]', 'State'], Object.keys(st.hyd.components).map(n => { const c = st.hyd.components[n]; return [n, c.kind, c.n1, c.n2, fmt(c.q, 4), fmt(c.dp, 3), fmt(c.u, 3), fmt(c.re, 0), fmt(c.pow, 3), c.open ? 'open' : '<span class="fail">closed</span>']; }), true));
    }
    if (st.th) {
      blocks.push(table('Thermal nodes', ['Node', 'T [°C]', 'heat input [W]'], Object.keys(st.th.nodes).map(id => [id, fmt(st.th.nodes[id], 3), fmt(st.th.heatIn[id] || 0, 1)])));
      blocks.push(table('Thermal components', ['Name', 'Type', 'Node 1', 'Node 2', 'Heat flow [W]'], Object.keys(st.th.components).map(n => { const c = st.th.components[n]; return [n, c.type, c.n1, c.n2 || '', fmt(c.q, 2)]; })));
    }
    if (st.el) {
      blocks.push(table('Electrical nodes', ['Node', 'V [V]'], Object.keys(st.el.nodes).map(id => [id, fmt(st.el.nodes[id], 3)])));
      blocks.push(table('Electrical components', ['Name', 'Type', 'Node 1', 'Node 2', 'V [V]', 'I [A]', 'P [W]', 'Heat [W]', 'SOC'], Object.keys(st.el.components).map(n => { const c = st.el.components[n]; return [n, c.type, c.n1, c.n2, fmt(c.v, 3), fmt(c.i, 3), fmt(c.p, 1), fmt(c.heat, 1), c.soc !== undefined ? fmt(c.soc * 100, 2) + ' %' : '']; })));
    }
    $('resTables').innerHTML = '<div class="grid2">' + blocks.join('') + '</div>';
  }
  function table(title, head, rows, raw) {
    return '<div class="card"><h2>' + esc(title) + '</h2><div style="max-height:420px;overflow:auto"><table class="t"><tr>' + head.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr>' + rows.map(r => '<tr>' + r.map((c, i) => '<td' + (i > 0 && /^-?[\d.]/.test(String(c)) ? ' class="num"' : '') + '>' + (raw && i === r.length - 1 ? c : esc(c)) + '</td>').join('') + '</tr>').join('') + '</table></div></div>';
  }
  const COLORS = ['#4fc3f7', '#ff8a50', '#ffd740', '#7cfc9a', '#e94560', '#c792ea', '#80cbc4', '#f48fb1', '#a1887f', '#90a4ae'];
  function drawPlot(sig, stepIdx) {
    const svg = $('plot'); if (!svg) return;
    const W = svg.clientWidth || 700, H = 420, m = { l: 64, r: 16, t: 14, b: 40 };
    const sel = sig.filter(s => plotSel.has(s.key));
    const ts = last.steps.map(s => s.t);
    let ymin = Infinity, ymax = -Infinity;
    const data = sel.map(s => last.steps.map(st => { const v = s.get(st); return Number.isFinite(v) ? v : null; }));
    data.forEach(d => d.forEach(v => { if (v !== null) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); } }));
    if (!sel.length || !Number.isFinite(ymin)) { svg.innerHTML = '<text x="20" y="40" fill="#8d98b8">Select one or more signals on the left.</text>'; return; }
    if (ymax - ymin < 1e-9) { ymax += 1; ymin -= 1; }
    const pad = (ymax - ymin) * 0.06; ymin -= pad; ymax += pad;
    const x = t => m.l + (t - ts[0]) / (ts[ts.length - 1] - ts[0] || 1) * (W - m.l - m.r);
    const y = v => m.t + (1 - (v - ymin) / (ymax - ymin)) * (H - m.t - m.b);
    let out = '';
    for (let i = 0; i <= 5; i++) { const v = ymin + (ymax - ymin) * i / 5; out += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#222a4a"/><text x="' + (m.l - 6) + '" y="' + (y(v) + 4) + '" fill="#8d98b8" font-size="11" text-anchor="end">' + fmt(v, Math.abs(ymax - ymin) < 5 ? 3 : 1) + '</text>'; }
    for (let i = 0; i <= 6; i++) { const t = ts[0] + (ts[ts.length - 1] - ts[0]) * i / 6; out += '<text x="' + x(t) + '" y="' + (H - m.b + 16) + '" fill="#8d98b8" font-size="11" text-anchor="middle">' + fmt(t, 0) + '</text>'; }
    out += '<text x="' + ((W + m.l) / 2) + '" y="' + (H - 6) + '" fill="#8d98b8" font-size="11" text-anchor="middle">time [s]</text>';
    data.forEach((d, j) => { let p = ''; d.forEach((v, i) => { if (v === null) return; p += (p ? 'L' : 'M') + x(ts[i]).toFixed(1) + ' ' + y(v).toFixed(1); }); out += '<path d="' + p + '" fill="none" stroke="' + COLORS[j % COLORS.length] + '" stroke-width="2"/>'; });
    out += '<line x1="' + x(ts[stepIdx]) + '" x2="' + x(ts[stepIdx]) + '" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="#e94560" stroke-dasharray="4 4"/>';
    sel.forEach((s, j) => { out += '<rect x="' + (m.l + 10) + '" y="' + (m.t + 6 + j * 16) + '" width="12" height="3" fill="' + COLORS[j % COLORS.length] + '"/><text x="' + (m.l + 28) + '" y="' + (m.t + 11 + j * 16) + '" fill="#dfe5f5" font-size="11">' + esc(s.label) + '</text>'; });
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = out;
  }
  function exportCsv(sig) {
    const head = ['t [s]'].concat(sig.map(s => s.label));
    const lines = [head.join(',')].concat(last.steps.map(st => [st.t].concat(sig.map(s => { const v = s.get(st); return Number.isFinite(v) ? v : ''; })).join(',')));
    download('boheme_multiphysics_timeseries.csv', lines.join('\r\n'), 'text/csv');
  }
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

  function drawDiagram() {
    const svg = $('diagram'); if (!svg) return;
    const W = svg.clientWidth || 1000, H = 640;
    const doms = ['hyd', 'th', 'el'].filter(d => model.nodes.some(n => n.domain === d));
    const weight = d => Math.max(1, Math.sqrt(model.nodes.filter(n => n.domain === d).length));
    const tot = doms.reduce((a, d) => a + weight(d), 0);
    let x0 = 20; const box = {};
    doms.forEach(d => { const w = (W - 40) * weight(d) / tot; box[d] = { x0: x0 + 10, x1: x0 + w - 10, y0: 30, y1: H - 30 }; x0 += w; });
    const pos = {};
    doms.forEach(d => {
      const ns = model.nodes.filter(n => n.domain === d); const b = box[d]; const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      ns.forEach((n, i) => { const a = 2 * Math.PI * i / ns.length; pos[n.id] = { x: cx + Math.cos(a) * (b.x1 - b.x0) * 0.35, y: cy + Math.sin(a) * (b.y1 - b.y0) * 0.35, d }; });
      const edges = model.components.filter(c => c.domain === d && c.n2 && pos[c.n1] && pos[c.n2] && c.n1 !== c.n2);
      const L0 = Math.max(60, Math.min(170, 0.75 * Math.min(b.x1 - b.x0, b.y1 - b.y0) / Math.max(1, Math.sqrt(ns.length))));
      for (let it = 0; it < 500; it++) {
        const f = {}; ns.forEach(n => f[n.id] = { x: 0, y: 0 });
        for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) { const a = pos[ns[i].id], c = pos[ns[j].id]; let dx = a.x - c.x, dy = a.y - c.y; const r = Math.max(Math.sqrt(dx * dx + dy * dy), 5); const k = 0.18 * L0 * L0 / r; dx /= r; dy /= r; f[ns[i].id].x += dx * k / 10; f[ns[i].id].y += dy * k / 10; f[ns[j].id].x -= dx * k / 10; f[ns[j].id].y -= dy * k / 10; }
        edges.forEach(e => { const a = pos[e.n1], c = pos[e.n2]; const dx = c.x - a.x, dy = c.y - a.y; const r = Math.sqrt(dx * dx + dy * dy) || 1; const k = (r - L0) * 0.06; f[e.n1].x += dx / r * k; f[e.n1].y += dy / r * k; f[e.n2].x -= dx / r * k; f[e.n2].y -= dy / r * k; });
        ns.forEach(n => { const p = pos[n.id]; p.x = Math.min(b.x1 - 60, Math.max(b.x0 + 10, p.x + Math.max(-10, Math.min(10, f[n.id].x)))); p.y = Math.min(b.y1 - 10, Math.max(b.y0 + 10, p.y + Math.max(-10, Math.min(10, f[n.id].y)))); });
      }
    });
    const col = { hyd: '#4fc3f7', th: '#ff8a50', el: '#ffd740' };
    const fin = last && last.final;
    let out = '';
    doms.forEach(d => { const b = box[d]; out += '<rect x="' + (b.x0 - 6) + '" y="' + (b.y0 - 22) + '" width="' + (b.x1 - b.x0 + 12) + '" height="' + (b.y1 - b.y0 + 34) + '" rx="10" fill="none" stroke="#222a4a"/><text x="' + (b.x0 + 4) + '" y="' + (b.y0 - 6) + '" fill="' + col[d] + '" font-size="12" font-weight="700">' + ({ hyd: 'HYDRAULIC', th: 'THERMAL', el: 'ELECTRICAL' })[d] + '</text>'; });
    const pairCount = {}, pairIdx = {};
    model.components.forEach(c => { if (!c.n2 || c.n1 === c.n2) return; const k = [c.n1, c.n2].sort().join('|'); pairCount[k] = (pairCount[k] || 0) + 1; });
    const seen = {};
    model.components.forEach(c => { if (!c.n2 || c.n1 === c.n2) return; const k = [c.n1, c.n2].sort().join('|'); seen[k] = (seen[k] || 0); pairIdx[c.name] = seen[k] - (pairCount[k] - 1) / 2; seen[k]++; });
    const geo = c => {
      const a = pos[c.n1], b = pos[c.n2 || c.n1]; if (!a || !b) return null;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const off = (pairIdx[c.name] || 0) * 30;
      let nx = -(b.y - a.y), ny = b.x - a.x; const nl = Math.sqrt(nx * nx + ny * ny) || 1; nx /= nl; ny /= nl;
      const sa = [a.x, b.x].sort()[0] === a.x ? 1 : -1;
      return { a, b, cx: mx + nx * off * 2 * sa, cy: my + ny * off * 2 * sa, x: mx + nx * off * sa, y: my + ny * off * sa };
    };
    const mid = c => { const g = geo(c); return g ? { x: g.x, y: g.y } : null; };
    model.components.forEach(c => {
      const mp = mid(c); if (!mp) return;
      if (c.heatTo && pos[c.heatTo]) out += '<line x1="' + mp.x + '" y1="' + mp.y + '" x2="' + pos[c.heatTo].x + '" y2="' + pos[c.heatTo].y + '" stroke="#ff8a50" stroke-opacity=".45" stroke-dasharray="5 5"/>';
      if (c.type === 'MOTORPUMP') { const pc = model.components.find(x => x.name === c.pump); const pm = pc && mid(pc); if (pm) out += '<line x1="' + mp.x + '" y1="' + mp.y + '" x2="' + pm.x + '" y2="' + pm.y + '" stroke="#ffd740" stroke-opacity=".6" stroke-dasharray="5 5"/>'; }
    });
    model.components.forEach(c => {
      const a = pos[c.n1], b = pos[c.n2]; const mp = mid(c); if (!mp) return;
      if (a && b && c.n1 !== c.n2) { const g = geo(c); out += '<path d="M' + a.x + ' ' + a.y + ' Q' + g.cx + ' ' + g.cy + ' ' + b.x + ' ' + b.y + '" fill="none" stroke="' + col[c.domain] + '" stroke-width="2.2" stroke-opacity=".85"/>'; }
      else if (a) out += '<circle cx="' + (a.x + 14) + '" cy="' + (a.y - 14) + '" r="6" fill="none" stroke="' + col[c.domain] + '"/>';
      let v = '';
      if (fin) { if (c.domain === 'hyd' && fin.hyd && fin.hyd.components[c.name]) v = fmt(fin.hyd.components[c.name].q, 2) + ' m³/h'; else if (c.domain === 'el' && fin.el && fin.el.components[c.name]) v = fmt(fin.el.components[c.name].p, 0) + ' W'; else if (c.domain === 'th' && fin.th && fin.th.components[c.name]) v = fmt(fin.th.components[c.name].q, 0) + ' W'; }
      out += '<text x="' + mp.x + '" y="' + (mp.y - 4) + '" fill="#c9d3ef" font-size="10" text-anchor="middle">' + esc(c.name) + '</text>' + (v ? '<text x="' + mp.x + '" y="' + (mp.y + 9) + '" fill="#8d98b8" font-size="9" text-anchor="middle">' + esc(v) + '</text>' : '');
    });
    model.nodes.forEach(n => {
      const p = pos[n.id]; if (!p) return;
      const fixed = n.tap || Number.isFinite(n.fixed);
      let v = '';
      if (fin) { if (n.domain === 'hyd' && fin.hyd) v = fmt(fin.hyd.nodes[n.id], 1) + ' bar'; else if (n.domain === 'th' && fin.T) v = fmt(fin.T[n.id], 1) + ' °C'; else if (n.domain === 'el' && fin.el) v = fmt(fin.el.nodes[n.id], 1) + ' V'; }
      out += (fixed ? '<rect x="' + (p.x - 7) + '" y="' + (p.y - 7) + '" width="14" height="14" fill="' + col[n.domain] + '" stroke="#fff"/>' : '<circle cx="' + p.x + '" cy="' + p.y + '" r="6" fill="' + col[n.domain] + '"/>') + '<text x="' + (p.x + 10) + '" y="' + (p.y + 4) + '" fill="#dfe5f5" font-size="11" font-weight="600">' + esc(n.id) + '</text>' + (v ? '<text x="' + (p.x + 10) + '" y="' + (p.y + 16) + '" fill="#7cfc9a" font-size="10">' + esc(v) + '</text>' : '');
    });
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = out;
  }

  async function runValidation() {
    $('valOut').innerHTML = 'Running …';
    try {
      const [excel, a320] = await Promise.all(['tests/fixtures/excel_reference.json', 'tests/fixtures/a320_green.json'].map(f => fetch(f, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(f + ' (HTTP ' + r.status + ')'); return r.json(); })));
      const eng = $('engine').value;
      let res, ms, engName = 'JavaScript';
      if (eng === 'pyodide') {
        const py = await pyodideEngine();
        py.globals.set('bmp_fx_excel', JSON.stringify(excel));
        py.globals.set('bmp_fx_a320', JSON.stringify(a320));
        const t0 = performance.now();
        res = JSON.parse(py.runPython("import json\nfrom boheme_mp import validation\njson.dumps(validation.run({'excel': json.loads(bmp_fx_excel), 'a320': json.loads(bmp_fx_a320)}))"));
        ms = performance.now() - t0; engName = 'Python (Pyodide)';
      } else if (eng === 'server') {
        const url = ($('serverUrl').value || '').trim().replace(/\/+$/, '');
        const t0 = performance.now();
        const r = await fetch(url + '/api/validate'); if (!r.ok) throw new Error('server HTTP ' + r.status);
        res = (await r.json()).checks; ms = performance.now() - t0; engName = 'Python server';
      } else {
        const t0 = performance.now();
        res = window.MPValidation.run(S, { excel, a320 });
        ms = performance.now() - t0;
      }
      const ok = res.filter(r => r.ok).length;
      $('valOut').innerHTML = '<div class="kpi"><div><span>checks passed</span><b class="' + (ok === res.length ? 'pass' : 'fail') + '">' + ok + ' / ' + res.length + '</b></div><div><span>engine</span><b>' + esc(engName) + '</b></div><div><span>run time</span><b>' + ms.toFixed(0) + ' ms</b></div></div><table class="t"><tr><th>Group</th><th>Check</th><th>Result</th><th>Detail</th><th>Reference</th></tr>' + res.map(r => '<tr><td>' + esc(r.group) + '</td><td>' + esc(r.name) + '</td><td class="' + (r.ok ? 'pass' : 'fail') + '">' + (r.ok ? 'PASS' : 'FAIL') + '</td><td>' + esc(r.detail) + '</td><td style="color:var(--mut)">' + esc(r.ref) + '</td></tr>').join('') + '</table>';
    } catch (e) { $('valOut').innerHTML = '<span class="fail">Could not run the validation: ' + esc(e.message) + '</span><div class="desc">Open the page through a web server (e.g. GitHub Pages, Netlify) – browsers block file access when opened directly from disk.</div>'; }
  }

  function renderHelp() {
    $('pane-help').innerHTML = '<div class="card"><h2>How it works</h2><p>Every domain is a network of <b>nodes</b> (potential) and <b>components</b> (flow between two nodes): hydraulic – pressure / volume flow, thermal – temperature / heat flow, electrical – voltage / current. Domains are coupled: losses of hydraulic and electrical components heat a thermal node (<code>Heat to</code>), the fluid temperature can be taken from a thermal node (viscosity and density follow), and a <code>MOTORPUMP</code> draws the hydraulic power of its pump from the electrical network.</p><p><b>Steady state</b> solves the coupled equilibrium. <b>Transient</b> integrates thermal capacities and battery state of charge with implicit Euler; hydraulics are solved quasi-steady in every time step. Events change component parameters at given times.</p></div>' +
      '<div class="card"><h2>Hydraulic components (BOHEME cell syntax)</h2><table><tr><td><code>R01 L D</code></td><td>Pipe: length [m], inner diameter [mm]; laminar/turbulent with smooth transition</td></tr><tr><td><code>Rz01 ζ D</code></td><td>Local loss coefficient ζ, diameter [mm]</td></tr><tr><td><code>Rl_X R D</code></td><td>Linear resistance [bar/(m³/h)] – valves: Rl_on / Rl_off</td></tr><tr><td><code>Rk_X kV</code></td><td>k_V valve [m³/h]: Δp = (Q/k_V)² bar</td></tr><tr><td><code>P1 Q D</code></td><td>Pump with fixed flow [m³/h]</td></tr><tr><td><code>Upm1 Pset Qmax D</code></td><td>Pressure-regulated pump: set pressure [bar], max. flow [m³/h]</td></tr><tr><td><code>Ucv1 Popen rd D</code></td><td>Relief/check valve: opening pressure [bar], resistance [bar/(m³/h)]</td></tr><tr><td><code>UXX ΔPoc Qsc D</code></td><td>Universal component (consumer, centrifugal pump …)</td></tr><tr><td><code>Upt1a ηv ηhm R0 D</code> / <code>Upt1b ηv ηhm Vb/Va D</code></td><td>Power transfer unit motor (a) and pump (b) with losses; activation logic in the side bar</td></tr></table><p class="desc">Reservoirs are hydraulic nodes with <code>Tap</code> checked (pressure ρ·g·z). The order Node 1 → Node 2 defines the positive flow direction.</p></div>' +
      '<div class="card"><h2>Thermal and electrical components</h2><table><tr><td><code>G</code></td><td>Thermal conductance <code>G</code> [W/K]</td></tr><tr><td><code>Q</code></td><td>Heat source <code>P</code> [W] into Node 1, <code>on</code> = on/off</td></tr><tr><td><code>HX</code></td><td>Heat exchanger: <code>mdot</code> [kg/s], <code>cp</code> [J/(kg·K)], effectiveness <code>eff</code></td></tr><tr><td><code>R</code></td><td>Resistor <code>R</code> [Ω]</td></tr><tr><td><code>V</code></td><td>Voltage source <code>E</code> [V], <code>Rint</code> [Ω] (Node 1 = −, Node 2 = +)</td></tr><tr><td><code>BAT</code></td><td>Battery: <code>vmin</code>/<code>vmax</code> [V] (open-circuit voltage linear in SOC), <code>Rint</code>, <code>capacityAh</code>, <code>soc0</code></td></tr><tr><td><code>LOAD</code></td><td>Constant-power load <code>P</code> [W], heat fraction 1 − <code>eff</code></td></tr><tr><td><code>MOTORPUMP</code></td><td>Electric motor driving hydraulic <code>pump</code>, efficiency <code>eta</code>; when <code>on=off</code> the pump stops</td></tr><tr><td><code>SW</code></td><td>Switch, <code>on</code> = on/off</td></tr></table><p class="desc">Parameters are written as <code>key=value; key=value</code>. Thermal and electrical nodes with a <code>Fixed value</code> are boundaries (ambient temperature, ground). Thermal nodes need <code>C</code> [J/K] for transient behaviour.</p></div>' +
      '<div class="card"><h2>Limits</h2><p class="desc">Lumped (0-D) networks, no water hammer or wave propagation; hydraulics quasi-steady per time step; fluid property formulas are approximations. Results are engineering estimates and must be validated for design decisions.</p></div>';
  }

  function activate(name) { document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name)); document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + name)); if (name === 'diagram') drawDiagram(); if (name === 'view3d' && window.View3D) window.View3D.onTabActivate(name); if (name === 'results' && last && last.mode === 'transient') drawPlot(signalsOf(last.final), +(($('tSlider') || {}).value || last.steps.length - 1)); }

  async function loadExample(file) {
    try { const r = await fetch(file, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); model = await r.json(); last = null; plotSel = new Set(); save(); renderModel(); $('resKpi').innerHTML = ''; $('resPlot').innerHTML = ''; $('resTables').innerHTML = '<div class="desc">Press ▶ Run.</div>'; setStatus('Loaded: ' + (model.title || file)); }
    catch (e) { setStatus('Could not load ' + file + ': ' + e.message + ' – open the page through a web server.', 'err'); }
  }

  function init() {
    $('exampleSel').innerHTML = '<option value="">Examples …</option>' + EXAMPLES.map(e => '<option value="' + e.file + '">' + esc(e.title) + '</option>').join('');
    $('exampleSel').addEventListener('change', e => { if (e.target.value) loadExample(e.target.value); e.target.value = ''; });
    $('btnNew').addEventListener('click', () => { if (!confirm('Start a new, empty project?')) return; model = blankModel(); last = null; save(); renderModel(); setStatus('New project.'); });
    $('btnExport').addEventListener('click', () => { readSide(); download((model.title || 'project').replace(/[^\w-]+/g, '_') + '.json', JSON.stringify(model, null, 1), 'application/json'); });
    $('btnImport').addEventListener('click', () => $('fileIn').click());
    $('fileIn').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { const m = JSON.parse(rd.result); if (!Array.isArray(m.nodes) || !Array.isArray(m.components)) throw new Error('not a project file'); model = m; last = null; save(); renderModel(); setStatus('Imported ' + f.name); } catch (err) { setStatus('Import failed: ' + err.message, 'err'); } }; rd.readAsText(f); e.target.value = ''; });
    $('btnRun').addEventListener('click', run);
    const engSaved = (() => { try { return JSON.parse(localStorage.getItem('bmp_engine') || '{}'); } catch (e) { return {}; } })();
    if (engSaved.engine) $('engine').value = engSaved.engine;
    if (engSaved.url) $('serverUrl').value = engSaved.url;
    const engSync = () => { $('rowServer').style.display = $('engine').value === 'server' ? '' : 'none'; $('engineInfo').textContent = { js: 'Fastest. The solver runs as JavaScript in your browser.', pyodide: 'The Python package (python/boheme_mp) runs in your browser via Pyodide. First start loads about 10 MB.', server: 'The model is sent to a Python API (python -m boheme_mp serve); the solver code stays on the server.' }[$('engine').value]; try { localStorage.setItem('bmp_engine', JSON.stringify({ engine: $('engine').value, url: $('serverUrl').value })); } catch (e) {} };
    $('engine').addEventListener('change', engSync); $('serverUrl').addEventListener('change', engSync); engSync();
    $('btnValidate').addEventListener('click', runValidation);
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => activate(t.dataset.tab)));
    document.querySelectorAll('aside input, aside select').forEach(el => el.addEventListener('change', readSide));
    $('title').addEventListener('input', readSide);
    window.addEventListener('resize', () => { if ($('pane-diagram').classList.contains('active')) drawDiagram(); });
    bindTables();
    renderHelp();
    let saved = null; try { saved = JSON.parse(localStorage.getItem('bmp_model') || 'null'); } catch (e) {}
    if (saved && Array.isArray(saved.nodes)) { model = saved; renderModel(); setStatus('Restored last project. Press ▶ Run.'); }
    else loadExample(EXAMPLES[0].file);
  }
  window.BMPApp = { get model() { return model; }, get last() { return last; }, run, loadExample, runValidation, activate };
  init();
})();
