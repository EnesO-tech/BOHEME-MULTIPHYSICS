(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPSolver = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PA = 1e5, SH = 3600, MM = 1000;

  function gauss(A, b) {
    const n = b.length;
    const M = A.map((r, i) => r.slice().concat([b[i]]));
    for (let k = 0; k < n; k++) {
      let p = k, mx = Math.abs(M[k][k]);
      for (let i = k + 1; i < n; i++) { const v = Math.abs(M[i][k]); if (v > mx) { mx = v; p = i; } }
      if (!(mx > 1e-300)) return null;
      if (p !== k) { const t = M[k]; M[k] = M[p]; M[p] = t; }
      const piv = M[k][k];
      for (let i = k + 1; i < n; i++) {
        const f = M[i][k] / piv;
        if (f === 0) continue;
        const Mi = M[i], Mk = M[k];
        for (let j = k; j <= n; j++) Mi[j] -= f * Mk[j];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i][n];
      for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  const FLUIDS = {
    skydrol: {
      label: 'Skydrol LD-4 (BOHEME/Excel formula)',
      rho: T => 1025 * Math.exp(-0.00083 * T),
      mu: T => 5.17e-5 * Math.exp(1084 / (T + 273.15 - 110)),
      cp: () => 1750
    },
    water: {
      label: 'Water (approximation 5–90 °C)',
      rho: T => 1000 * (1 - Math.pow(T - 4, 2) / 180000),
      mu: T => 2.414e-5 * Math.pow(10, 247.8 / (T + 273.15 - 140)),
      cp: () => 4186
    },
    glycol50: {
      label: 'Water–glycol 50/50 (approximation)',
      rho: T => 1082 - 0.5 * T,
      mu: T => 3.2e-3 * Math.exp(-0.026 * (T - 20)) + 3e-4,
      cp: () => 3300
    }
  };

  function hydKind(name) {
    const u = String(name).toUpperCase();
    for (const k of ['RZ', 'RK', 'RR', 'RL']) if (u.startsWith(k)) return k;
    for (const k of ['UCP', 'UPR', 'UCV', 'UPT', 'UPM']) if (u.startsWith(k)) return k;
    if (u.startsWith('R')) return 'R';
    if (u.startsWith('P')) return 'P';
    if (u.startsWith('U')) return 'U';
    return null;
  }

  function numTokens(cell) {
    const t = String(cell).trim().split(/\s+/);
    const nums = [];
    for (let i = 1; i < t.length; i++) {
      const v = Number(String(t[i]).replace(',', '.'));
      if (!Number.isFinite(v)) break;
      nums.push(v);
    }
    return { name: t[0], nums };
  }

  function parseHydComponent(src, par) {
    const { name, nums } = numTokens(src.cell || src.name);
    const kind = hydKind(name);
    if (!kind) throw new Error('Unknown hydraulic component type "' + name + '".');
    if (kind === 'RR') throw new Error('Pressure regulator Rr is not supported (' + name + ').');
    const need = { R: 2, RZ: 2, RK: 1, RL: 2, P: 2, UCP: 3, UPR: 3, UCV: 3, UPM: 3, U: 3, UPT: 2 }[kind];
    if (nums.length < need) throw new Error('Component "' + name + '" needs ' + need + ' numeric parameters.');
    const c = { name, kind, n1: src.n1, n2: src.n2, U: 1.0, q: 0, Ptot1: 0, Ptot2: 0, Fwd: true, Qsc: 0, Rd: 0, Dpoc: 0, Diam: 0, PipeLen: 0, Zeta: 0, Kv: 0, heatTo: src.heatTo || '' };
    switch (kind) {
      case 'R': c.PipeLen = nums[0]; c.Diam = nums[1] / MM; break;
      case 'RZ': c.Zeta = nums[0]; c.Diam = nums[1] / MM; break;
      case 'RK': c.Kv = nums[0]; break;
      case 'RL': c.Rd = nums[0] * PA * SH; c.Diam = nums[1] / MM; break;
      case 'P': c.Qsc = nums[0] / SH; c.Diam = nums[1] / MM; break;
      case 'UCP': c.Qsc = nums[0] / SH; c.Dpoc = nums[1] * PA; c.Diam = nums[2] / MM; c.Rd = -c.Dpoc / c.Qsc; break;
      case 'UPR': c.Dpoc = nums[0] * PA; c.Rd = nums[1] * PA * SH; c.Diam = nums[2] / MM; c.Qsc = -c.Dpoc / c.Rd; break;
      case 'UCV': c.Dpoc = nums[0] * PA; c.Rd = nums[1] * PA * SH; c.Diam = nums[2] / MM; c.Qsc = -c.Dpoc / c.Rd; break;
      case 'UPM': c.Pset = nums[0] * PA; c.Qmax = nums[1] / SH; c.Qsc = c.Qmax; c.Diam = nums[2] / MM; break;
      case 'U': c.Dpoc = nums[0] * PA; c.Qsc = nums[1] / SH; c.Diam = nums[2] / MM; c.Rd = -c.Dpoc / c.Qsc; break;
      case 'UPT': {
        c.isPtuPump = name.slice(-1).toLowerCase() === 'b';
        if (c.isPtuPump) {
          if (nums.length >= 4) { c.EtaV = nums[0]; c.EtaHm = nums[1]; c.DispRatio = nums[2]; c.Diam = nums[3] / MM; }
          else { c.EtaV = 1; c.EtaHm = 1; c.DispRatio = 1; c.Diam = nums[0] / MM; }
        } else {
          if (nums.length >= 4) { c.EtaV = nums[0]; c.EtaHm = nums[1]; c.Rd = nums[2] * PA * SH; c.Diam = nums[3] / MM; }
          else { c.EtaV = 1; c.EtaHm = nums[0]; c.Rd = nums[1] * PA * SH; c.Diam = nums[2] / MM; }
          c.Rd0 = c.Rd;
        }
        break;
      }
    }
    if (kind === 'RK') { c.Area = c.Kv / Math.SQRT2 * (1 / SH) * Math.sqrt(par.rho / PA); c.Kd = 0; }
    else { c.Area = Math.PI / 4 * c.Diam * c.Diam; c.Kd = c.Diam !== 0 ? (par.krough / MM) / c.Diam : 0; }
    return c;
  }

  function solveHydraulic(net, par, opt) {
    opt = opt || {};
    const nodes = (net.nodes || []).filter(n => (n.domain || 'hyd') === 'hyd');
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const internal = nodes.filter(n => !n.tap);
    const idx = new Map(internal.map((n, i) => [n.id, i]));
    const N = internal.length;
    const rho = par.rho, mu = par.mu, g = par.g, lam = par.lambdaU;
    let comps;
    if (opt.state && opt.state.comps && opt.state.sig === sigOf(net)) {
      comps = opt.state.comps;
      for (const c of comps) { const fresh = parseHydComponent(net.components.find(x => x.name === c.srcName), par); c.reparse = fresh; }
      for (const c of comps) {
        const f = c.reparse; delete c.reparse;
        for (const k of ['Qsc', 'Dpoc', 'Diam', 'PipeLen', 'Zeta', 'Kv', 'Area', 'Kd', 'EtaV', 'EtaHm', 'DispRatio', 'Pset', 'Qmax', 'heatTo']) if (f[k] !== undefined) c[k] = f[k];
        if (c.kind === 'RL' || c.kind === 'UPR' || c.kind === 'UCV' || c.kind === 'U' || c.kind === 'UCP') c.Rd = f.Rd;
        if (c.kind === 'UPT' && !c.isPtuPump) c.Rd0 = f.Rd0;
        if (c.kind === 'UPM' && opt.state.upmQ && opt.state.upmQ[c.name] !== undefined) c.Qsc = opt.state.upmQ[c.name];
      }
    } else {
      comps = net.components.map(src => { const c = parseHydComponent(src, par); c.srcName = src.name; return c; });
    }
    for (const c of comps) {
      for (const side of ['n1', 'n2']) {
        const id = c[side];
        if (!nodeById.has(id)) throw new Error('Component ' + c.name + ' refers to unknown node "' + id + '".');
      }
      c.i1 = idx.has(c.n1) ? idx.get(c.n1) : -1;
      c.i2 = idx.has(c.n2) ? idx.get(c.n2) : -1;
      c.Z1 = Number(nodeById.get(c.n1).z) || 0;
      c.Z2 = Number(nodeById.get(c.n2).z) || 0;
    }
    const ptu = {};
    for (const c of comps) if (c.kind === 'UPT') { const suf = c.name.slice(3); const nr = suf.slice(0, -1); const side = suf.slice(-1).toLowerCase(); (ptu[nr] = ptu[nr] || {})[side] = c; }
    for (const nr in ptu) if (ptu[nr].a && ptu[nr].b) { ptu[nr].a.partner = ptu[nr].b; ptu[nr].b.partner = ptu[nr].a; }
    if (N === 0) throw new Error('No internal hydraulic node.');
    const X = new Array(N).fill(0);
    const tapZ = (c, side) => side === 2 ? (c.Z2 > 0 ? c.Z2 : c.Z1) : (c.Z1 > 0 ? c.Z1 : c.Z2);
    const isRes = k => k !== 'UPM' && (k[0] === 'R' || k[0] === 'U');
    const isSrc = k => k === 'P' || k === 'UPM' || k[0] === 'U';
    const log10 = Math.log10;
    function resistance(c, it) {
      switch (c.kind) {
        case 'UCV': if (it > 1 && (c.Ptot1 - c.Ptot2) <= c.Dpoc) c.Fwd = false; break;
        case 'RZ': c.Rd = rho / 2 * c.U / c.Area * c.Zeta; break;
        case 'RK': c.Rd = c.U * PA * SH * SH * c.Area / (c.Kv * c.Kv); break;
        case 'R': {
          const Rlam = 128 / Math.PI * c.PipeLen / Math.pow(c.Diam, 4) * mu;
          const Re = c.U * c.Diam * rho / mu;
          let lamb = 0;
          if (c.U > 0) {
            if (par.zanke) { const ReL = Re <= 1 ? 1 : Re; lamb = Math.pow(-2 * log10(2.7 * Math.pow(log10(ReL), 1.2) / Re + c.Kd / 3.71), -2); }
            else lamb = 0.25 / Math.pow(log10(c.Kd / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2);
          }
          const Rturb = rho / 2 * c.U / c.Area * lamb * c.PipeLen / c.Diam;
          const lo = par.ReDcrit * (1 - par.kReD), hi = par.ReDcrit * (1 + par.kReD);
          if (Re > lo && Re < hi) { const wf = (Re - lo) / (hi - lo); const w = 0.5 * (Math.sin((wf - 0.5) * Math.PI) + 1); c.Rd = (1 - w) * Rlam + w * Rturb; }
          else if (Re >= hi) c.Rd = Rturb; else c.Rd = Rlam;
          break;
        }
      }
    }
    let it = 0, dUres = 1, dUres1 = 1;
    const maxIt = Number(par.niter) || 999;
    const tolP = 1e-6;
    while (true) {
      it++;
      for (const c of comps) {
        if (c.kind === 'UPT' && c.isPtuPump && c.partner) {
          const m = c.partner;
          if (par.ptuOff) { c.Qsc = 0; m.Rd = 1e15; continue; }
          const Qa = Math.abs(m.q);
          c.Qsc = Qa * c.DispRatio * m.EtaV * c.EtaV;
          if (it <= 1 || Qa < 1e-12) continue;
          const Qb = Math.abs(c.q), DPb = Math.abs(c.Ptot1 - c.Ptot2);
          const eta = m.EtaV * m.EtaHm * c.EtaV * c.EtaHm;
          const Rn = m.Rd0 + DPb * Qb / (eta * Qa * Qa);
          if (Math.abs(Rn - m.Rd) < tolP * m.Rd) continue;
          m.Rd = 0.1 * Rn + 0.9 * m.Rd;
        }
      }
      if (it > 1) for (const c of comps) {
        if (c.kind !== 'UPM') continue;
        let Pist;
        if (c.i2 >= 0) Pist = X[c.i2]; else if (c.i1 >= 0) Pist = X[c.i1]; else continue;
        if (Math.abs(Pist - c.Pset) < tolP * c.Pset) continue;
        let Qn = Pist > 0 ? c.Qsc * (c.Pset / Pist) : c.Qmax;
        Qn = Math.max(0, Math.min(Qn, c.Qmax));
        c.Qsc = 0.3 * Qn + 0.7 * c.Qsc;
      }
      const A = Array.from({ length: N }, () => new Array(N).fill(0));
      const b = new Array(N).fill(0);
      for (const c of comps) {
        c.Fwd = true;
        if (isRes(c.kind)) resistance(c, it);
        if (!c.Fwd) continue;
        if (isRes(c.kind) && !(c.kind === 'UPT' && c.isPtuPump)) {
          const gc = 1 / (c.Rd / PA / SH);
          if (c.i1 >= 0) A[c.i1][c.i1] += gc;
          if (c.i2 >= 0) A[c.i2][c.i2] += gc;
          if (c.i1 >= 0 && c.i2 >= 0) { A[c.i1][c.i2] -= gc; A[c.i2][c.i1] -= gc; }
          if (c.i1 >= 0 && c.i2 < 0) { const z = tapZ(c, 2); const head = (c.q < 0 || c.kind === 'RK') ? rho * g * z : rho * g * z + 0.5 * rho * c.U * c.U; b[c.i1] += head / (c.Rd / PA / SH) / PA; }
          if (c.i2 >= 0 && c.i1 < 0) { const z = tapZ(c, 1); const head = (c.q > 0 || c.kind === 'RK') ? rho * g * z : rho * g * z + 0.5 * rho * c.U * c.U; b[c.i2] += head / (c.Rd / PA / SH) / PA; }
        }
        if (isSrc(c.kind)) {
          if (c.i1 >= 0) b[c.i1] -= c.Qsc * SH;
          if (c.i2 >= 0) b[c.i2] += c.Qsc * SH;
        }
      }
      const xb = gauss(A, b);
      if (!xb) throw new Error('Hydraulic coefficient matrix is singular – check that every node is connected and that the network has a tap/reservoir.');
      for (let i = 0; i < N; i++) X[i] = xb[i] * PA;
      let dUsum = 0;
      for (const c of comps) {
        if (c.kind === 'P' || c.kind === 'UPM' || (c.kind === 'UPT' && c.isPtuPump)) c.q = c.Qsc;
        else if (c.i2 < 0 && c.i1 >= 0) {
          const z = tapZ(c, 2); const num = c.Rd * c.Qsc + X[c.i1] - rho * g * z;
          c.q = (c.q < 0 || c.kind === 'RK') ? num / c.Rd : num / (0.5 * rho * c.U / c.Area + c.Rd);
        } else if (c.i1 < 0 && c.i2 >= 0) {
          const z = tapZ(c, 1); const num = c.Rd * c.Qsc + rho * g * z - X[c.i2];
          c.q = (c.q > 0 || c.kind === 'RK') ? num / c.Rd : num / (0.5 * rho * c.U / c.Area + c.Rd);
        } else if (c.i1 >= 0 && c.i2 >= 0) c.q = c.Qsc + (X[c.i1] - X[c.i2]) / c.Rd;
        if (c.kind[0] === 'U' && !c.Fwd) c.q = 0;
        const prev = c.U;
        c.U = c.Area !== 0 ? Math.abs(c.q / c.Area) : 0;
        c.U = Math.abs(lam * c.U + (1 - lam) * prev);
        dUsum += Math.abs(c.U - prev);
        if (c.i2 < 0 && c.i1 >= 0) { const z = tapZ(c, 2); c.Ptot2 = (c.q < 0 || c.kind === 'RK') ? rho * g * z : rho * g * z + 0.5 * rho * c.U * c.U; c.Ptot1 = X[c.i1]; }
        else if (c.i1 < 0 && c.i2 >= 0) { const z = tapZ(c, 1); c.Ptot1 = (c.q > 0 || c.kind === 'RK') ? rho * g * z : rho * g * z + 0.5 * rho * c.U * c.U; c.Ptot2 = X[c.i2]; }
        else if (c.i1 >= 0 && c.i2 >= 0) { c.Ptot1 = X[c.i1]; c.Ptot2 = X[c.i2]; }
      }
      dUres1 = dUres;
      dUres = comps.length ? dUsum / comps.length : 0;
      if (dUres <= par.dUcrit || it >= maxIt) break;
    }
    const resC = {};
    for (const c of comps) {
      const dp = c.Ptot1 - c.Ptot2;
      resC[c.name] = {
        kind: c.kind, n1: c.n1, n2: c.n2,
        q: c.q * SH, dp: dp / PA, u: c.kind === 'RK' ? 0 : c.U,
        re: c.kind === 'RK' ? 0 : c.U * c.Diam * rho / mu,
        qdyn: c.kind === 'RK' ? 0 : 0.5 * rho * c.U * c.U / PA,
        pow: dp * c.q / 1000, open: c.Fwd, heatTo: c.heatTo || ''
      };
    }
    const resN = {};
    internal.forEach((n, i) => { resN[n.id] = X[i] / PA; });
    nodes.filter(n => n.tap).forEach(n => { resN[n.id] = rho * g * (Number(n.z) || 0) / PA; });
    const upmQ = {};
    for (const c of comps) if (c.kind === 'UPM') upmQ[c.name] = c.Qsc;
    return { iterations: it, residual: dUres, converged: dUres <= par.dUcrit, components: resC, nodes: resN, state: { comps, sig: sigOf(net), upmQ } };
  }

  function sigOf(net) {
    return (net.components || []).map(c => c.name + '|' + c.n1 + '|' + c.n2 + '|' + String(c.cell || '').split(/\s+/)[0]).join(';') + '#' + (net.nodes || []).map(n => n.id + ':' + (n.tap ? 'T' : '') + (n.z || 0)).join(',');
  }

  function solveHydraulicWithPtuLogic(net, par, opt) {
    const on = net.ptu && net.ptu.logic !== false;
    const thr = net.ptu && Number.isFinite(Number(net.ptu.thresholdPsi)) ? Number(net.ptu.thresholdPsi) : 500;
    const base = solveHydraulic(net, Object.assign({}, par, { ptuOff: false }), opt);
    const pairs = [];
    for (const k in base.components) { const c = base.components[k]; if (c.kind === 'UPT' && /b$/i.test(k)) { const a = k.slice(0, -1) + 'a'; const A = Object.keys(base.components).find(x => x.toLowerCase() === a.toLowerCase()); if (A) pairs.push([A, k]); } }
    const info = { enabled: on, present: pairs.length > 0, active: pairs.length > 0, dpOffPsi: null, thresholdPsi: thr };
    if (!on || !pairs.length) { base.ptu = info; return base; }
    const off = solveHydraulic(net, Object.assign({}, par, { ptuOff: true }));
    const st = c => Math.max(c.Ptot1, c.Ptot2);
    const offComps = new Map(off.state.comps.map(c => [c.name, c]));
    let dp = Infinity;
    for (const [a, b] of pairs) dp = Math.min(dp, st(offComps.get(a)) - st(offComps.get(b)));
    info.dpOffPsi = dp / PA * 14.5037738;
    info.active = info.dpOffPsi >= thr;
    const r = info.active ? base : off;
    r.ptu = info;
    return r;
  }

  function linearNetwork(domain, nodes, elems, ctx) {
    const free = nodes.filter(n => !Number.isFinite(n.fixed));
    const idx = new Map(free.map((n, i) => [n.id, i]));
    const fixedVal = new Map(nodes.filter(n => Number.isFinite(n.fixed)).map(n => [n.id, n.fixed]));
    const N = free.length;
    const A = Array.from({ length: N }, () => new Array(N).fill(0));
    const b = new Array(N).fill(0);
    const pot = id => fixedVal.has(id) ? fixedVal.get(id) : null;
    const stampG = (a, c, gval) => {
      const ia = idx.has(a) ? idx.get(a) : -1, ic = idx.has(c) ? idx.get(c) : -1;
      if (ia >= 0) A[ia][ia] += gval;
      if (ic >= 0) A[ic][ic] += gval;
      if (ia >= 0 && ic >= 0) { A[ia][ic] -= gval; A[ic][ia] -= gval; }
      if (ia >= 0 && ic < 0 && pot(c) !== null) b[ia] += gval * pot(c);
      if (ic >= 0 && ia < 0 && pot(a) !== null) b[ic] += gval * pot(a);
    };
    const inject = (id, val) => { if (idx.has(id)) b[idx.get(id)] += val; };
    for (const e of elems) e.stamp(stampG, inject, ctx);
    for (const n of free) if (n.cdt) { const i = idx.get(n.id); A[i][i] += n.cdt; b[i] += n.cdt * n.prev; }
    for (let i = 0; i < N; i++) if (A[i][i] === 0) { A[i][i] = 1e-12; }
    const x = N ? gauss(A, b) : [];
    if (!x) throw new Error('The ' + domain + ' network matrix is singular – every node needs a path to a fixed node.');
    const out = {};
    nodes.forEach(n => { out[n.id] = fixedVal.has(n.id) ? fixedVal.get(n.id) : x[idx.get(n.id)]; });
    return out;
  }

  function evalSchedule(comp, key, t, events) {
    let v = comp[key];
    if (!events) return v;
    const evs = events.filter(e => e.comp === comp.name && e.field === key && Number(e.t) <= t + 1e-12).sort((a, b) => a.t - b.t);
    if (evs.length) v = evs[evs.length - 1].value;
    return v;
  }

  function applyEvents(model, t) {
    const m = JSON.parse(JSON.stringify(model));
    const ev = (model.events || []).filter(e => e && e.comp && e.field);
    for (const c of m.components) {
      for (const e of ev.filter(e => e.comp === c.name)) {
        if (Number(e.t) <= t + 1e-12) {
          const val = isNaN(Number(e.value)) ? e.value : Number(e.value);
          if (e.field === 'cell') c.cell = String(e.value);
          else c[e.field] = val;
        }
      }
    }
    return m;
  }

  function fluidAt(model, Tf) {
    const f = model.fluid || { model: 'skydrol', T: -40 };
    if (f.model === 'custom') return { rho: Number(f.rho), mu: Number(f.mu), cp: Number(f.cp) || 2000 };
    const F = FLUIDS[f.model] || FLUIDS.skydrol;
    return { rho: F.rho(Tf), mu: F.mu(Tf), cp: F.cp(Tf) };
  }

  function solveCoupled(model, t, dt, state, opts) {
    opts = opts || {};
    const m = applyEvents(model, t);
    const hydNodes = m.nodes.filter(n => n.domain === 'hyd');
    const thNodes = m.nodes.filter(n => n.domain === 'th');
    const elNodes = m.nodes.filter(n => n.domain === 'el');
    const offPumps = new Set(m.components.filter(c => c.domain === 'el' && c.type === 'MOTORPUMP' && (c.on === false || c.on === 'off')).map(c => c.pump));
    const hydComps = m.components.filter(c => c.domain === 'hyd').map(c => {
      if (!offPumps.has(c.name)) return c;
      const t = String(c.cell).trim().split(/\s+/);
      const k = hydKind(t[0]);
      if (k === 'P' && t.length > 1) t[1] = '0';
      else if (k === 'UPM' && t.length > 2) t[2] = '0';
      return Object.assign({}, c, { cell: t.join(' ') });
    });
    const thComps = m.components.filter(c => c.domain === 'th');
    const elComps = m.components.filter(c => c.domain === 'el');
    const fl = m.fluid || { model: 'skydrol', T: -40 };
    const transient = dt > 0;
    let T = Object.assign({}, state.T || {});
    thNodes.forEach(n => { if (T[n.id] === undefined) T[n.id] = Number.isFinite(n.fixed) ? n.fixed : (Number.isFinite(Number(n.T0)) ? Number(n.T0) : 20); });
    const soc = Object.assign({}, state.soc || {});
    elComps.filter(c => c.type === 'BAT').forEach(c => { if (soc[c.name] === undefined) soc[c.name] = Number(c.soc0 !== undefined ? c.soc0 : 1); });
    let V = Object.assign({}, state.V || {});
    let hyd = null, el = null, th = null;
    let Tfluid = fl.tempNode && T[fl.tempNode] !== undefined ? T[fl.tempNode] : Number(fl.T);
    let coupleIt = 0, coupleErr = 0;
    const maxCouple = opts.maxCouple || 60;
    let hydState = state.hydState || null;
    for (coupleIt = 1; coupleIt <= maxCouple; coupleIt++) {
      const props = fluidAt(m, Tfluid);
      if (hydNodes.length && hydComps.length) {
        const par = Object.assign({}, m.hydParams || {}, { rho: props.rho, mu: props.mu, g: Number((m.hydParams || {}).g) || 9.80665 });
        par.krough = Number(par.krough !== undefined ? par.krough : 0.0015);
        par.dUcrit = Number(par.dUcrit !== undefined ? par.dUcrit : 1e-7);
        par.niter = Number(par.niter !== undefined ? par.niter : 999);
        par.lambdaU = Number(par.lambdaU !== undefined ? par.lambdaU : 0.6);
        par.kReD = Number(par.kReD !== undefined ? par.kReD : 0.2);
        par.ReDcrit = Number(par.ReDcrit !== undefined ? par.ReDcrit : 2320);
        par.zanke = !!par.zanke;
        hyd = solveHydraulicWithPtuLogic({ nodes: hydNodes, components: hydComps.map(c => ({ name: c.name, cell: c.cell, n1: c.n1, n2: c.n2, heatTo: c.heatTo })), ptu: m.ptu }, par, { state: opts.warm ? hydState : null });
        hyd.props = props;
        hydState = hyd.state;
      }
      const hydPow = name => hyd && hyd.components[name] ? Math.abs(hyd.components[name].pow) * 1000 : 0;
      let Vit = Object.assign({}, V);
      elNodes.forEach(n => { if (Vit[n.id] === undefined) Vit[n.id] = Number.isFinite(n.fixed) ? n.fixed : (Number(n.V0) || 0); });
      const batOcv = c => { const s = Math.max(0, Math.min(1, soc[c.name])); return Number(c.vmin) + (Number(c.vmax) - Number(c.vmin)) * s; };
      const loadPower = c => {
        if (c.type === 'MOTORPUMP') { const eta = Number(c.eta) || 1; return c.on === false || c.on === 'off' ? 0 : hydPow(c.pump) / eta; }
        if (c.type === 'LOAD') return (c.on === false || c.on === 'off') ? 0 : Number(c.P) || 0;
        return 0;
      };
      if (elNodes.length && elComps.length) {
        let elIt = 0;
        for (elIt = 1; elIt <= 200; elIt++) {
          const elems = elComps.map(c => ({
            stamp: (G, J) => {
              const v1 = Vit[c.n1] || 0, v2 = Vit[c.n2] || 0;
              if (c.type === 'R') G(c.n1, c.n2, 1 / Number(c.R));
              else if (c.type === 'SW') G(c.n1, c.n2, (c.on === false || c.on === 'off') ? 1e-9 : 1 / (Number(c.Ron) || 1e-4));
              else if (c.type === 'V' || c.type === 'BAT') {
                const E = c.type === 'V' ? Number(c.E) : batOcv(c); const r = Number(c.Rint) || 1e-3;
                G(c.n1, c.n2, 1 / r); J(c.n2, E / r); J(c.n1, -E / r);
              } else if (c.type === 'I') { J(c.n2, Number(c.I)); J(c.n1, -Number(c.I)); }
              else if (c.type === 'LOAD' || c.type === 'MOTORPUMP') {
                const P = loadPower(c); const v = v1 - v2;
                if (P > 0) { const vv = Math.abs(v) > 1e-6 ? v : (Number(c.Vnom) || 28); G(c.n1, c.n2, P / (vv * vv)); }
                else G(c.n1, c.n2, 1e-12);
              }
            }
          }));
          const res = linearNetwork('electrical', elNodes, elems, null);
          let d = 0;
          for (const k in res) d = Math.max(d, Math.abs(res[k] - (Vit[k] || 0)));
          Vit = res;
          if (d < 1e-9) break;
        }
        const comps = {};
        for (const c of elComps) {
          const v = (Vit[c.n1] || 0) - (Vit[c.n2] || 0);
          let i = 0, p = 0, heat = 0;
          if (c.type === 'R') { i = v / Number(c.R); p = v * i; heat = p; }
          else if (c.type === 'SW') { const gsw = (c.on === false || c.on === 'off') ? 1e-9 : 1 / (Number(c.Ron) || 1e-4); i = v * gsw; p = v * i; heat = p; }
          else if (c.type === 'V' || c.type === 'BAT') {
            const E = c.type === 'V' ? Number(c.E) : batOcv(c); const r = Number(c.Rint) || 1e-3;
            const vt = (Vit[c.n2] || 0) - (Vit[c.n1] || 0); i = (E - vt) / r; p = vt * i; heat = i * i * r;
          } else if (c.type === 'I') { i = Number(c.I); p = -v * i; }
          else if (c.type === 'LOAD' || c.type === 'MOTORPUMP') {
            const P = loadPower(c); i = Math.abs(v) > 1e-9 ? P / v : 0; p = P;
            const eta = Number(c.eta) || 1; heat = c.type === 'MOTORPUMP' ? P * (1 - eta) : P * (1 - (Number(c.eff) || 0));
          }
          comps[c.name] = { type: c.type, n1: c.n1, n2: c.n2, v, i, p, heat, heatTo: c.heatTo || '', soc: c.type === 'BAT' ? soc[c.name] : undefined };
        }
        el = { nodes: Vit, components: comps, iterations: elIt };
      }
      const heatIn = {};
      const addHeat = (node, w) => { if (node) heatIn[node] = (heatIn[node] || 0) + w; };
      if (hyd) for (const c of hydComps) if (c.heatTo) { const r = hyd.components[c.name]; if (r && r.kind[0] === 'R') addHeat(c.heatTo, Math.max(0, r.pow * 1000)); else if (r && r.kind[0] === 'U' && r.kind !== 'UPM' && !(r.kind === 'UPT')) addHeat(c.heatTo, Math.max(0, r.pow * 1000)); }
      if (el) for (const c of elComps) if (c.heatTo && el.components[c.name]) addHeat(c.heatTo, Math.max(0, el.components[c.name].heat));
      if (thNodes.length) {
        const nodesTh = thNodes.map(n => {
          const o = { id: n.id, fixed: Number.isFinite(n.fixed) ? n.fixed : NaN };
          if (transient && Number(n.C) > 0 && !Number.isFinite(n.fixed)) { o.cdt = Number(n.C) / dt; o.prev = (state.T && state.T[n.id] !== undefined) ? state.T[n.id] : T[n.id]; }
          return o;
        });
        const elems = thComps.map(c => ({
          stamp: (G, J) => {
            if (c.type === 'G') G(c.n1, c.n2, Number(c.G));
            else if (c.type === 'Q') J(c.n1, (c.on === false || c.on === 'off') ? 0 : Number(c.P));
            else if (c.type === 'HX') { const mdot = Number(c.mdot), cp = Number(c.cp) || 4186; const eps = Number(c.eff); G(c.n1, c.n2, eps * mdot * cp); }
          }
        }));
        elems.push({ stamp: (G, J) => { for (const k in heatIn) J(k, heatIn[k]); } });
        const Tn = linearNetwork('thermal', nodesTh, elems, null);
        coupleErr = 0;
        for (const k in Tn) coupleErr = Math.max(coupleErr, Math.abs(Tn[k] - T[k]));
        T = Tn;
        const flows = {};
        for (const c of thComps) {
          if (c.type === 'G' || c.type === 'HX') { const gg = c.type === 'G' ? Number(c.G) : Number(c.eff) * Number(c.mdot) * (Number(c.cp) || 4186); flows[c.name] = { type: c.type, n1: c.n1, n2: c.n2, q: gg * ((T[c.n1] || 0) - (T[c.n2] || 0)) }; }
          else if (c.type === 'Q') flows[c.name] = { type: 'Q', n1: c.n1, q: (c.on === false || c.on === 'off') ? 0 : Number(c.P) };
        }
        th = { nodes: T, components: flows, heatIn };
      }
      const Tnew = fl.tempNode && T[fl.tempNode] !== undefined ? T[fl.tempNode] : Number(fl.T);
      const dTf = Math.abs(Tnew - Tfluid);
      Tfluid = Tnew;
      V = el ? el.nodes : V;
      const needIter = (fl.tempNode && hydComps.length) || (elComps.some(c => c.type === 'MOTORPUMP'));
      if (!needIter) break;
      if (coupleIt > 1 && dTf < 1e-7 && coupleErr < 1e-7) break;
    }
    if (transient && el) for (const c of elComps.filter(c => c.type === 'BAT')) {
      const i = el.components[c.name].i;
      soc[c.name] = soc[c.name] - i * dt / (3600 * Number(c.capacityAh));
    }
    return { t, hyd, el, th, T, V, soc, Tfluid, coupleIt, hydState };
  }

  function validateModel(model) {
    const errs = [];
    const ids = new Set();
    for (const n of model.nodes || []) {
      if (!n.id) errs.push('A node has no id.');
      if (ids.has(n.id)) errs.push('Duplicate node id "' + n.id + '".');
      ids.add(n.id);
      if (!['hyd', 'th', 'el'].includes(n.domain)) errs.push('Node "' + n.id + '" has an unknown domain.');
    }
    const names = new Set();
    for (const c of model.components || []) {
      if (!c.name) errs.push('A component has no name.');
      if (names.has(c.name)) errs.push('Duplicate component name "' + c.name + '".');
      names.add(c.name);
      const nodesOf = c.domain === 'th' && c.type === 'Q' ? [c.n1] : [c.n1, c.n2];
      for (const nid of nodesOf) if (!ids.has(nid)) errs.push('Component "' + c.name + '" refers to unknown node "' + nid + '".');
      const dn = (model.nodes || []).filter(n => nodesOf.includes(n.id)).map(n => n.domain);
      if (dn.some(d => d !== c.domain)) errs.push('Component "' + c.name + '" connects nodes of another domain.');
      if (c.heatTo && !(model.nodes || []).some(n => n.id === c.heatTo && n.domain === 'th')) errs.push('Component "' + c.name + '": heatTo "' + c.heatTo + '" is not a thermal node.');
      if (c.type === 'MOTORPUMP' && !(model.components || []).some(x => x.name === c.pump && x.domain === 'hyd')) errs.push('Motor-pump "' + c.name + '" refers to unknown hydraulic pump "' + c.pump + '".');
    }
    const f = model.fluid || {};
    if (f.tempNode && !(model.nodes || []).some(n => n.id === f.tempNode && n.domain === 'th')) errs.push('Fluid temperature node "' + f.tempNode + '" is not a thermal node.');
    return errs;
  }

  function simulate(model, opts) {
    opts = opts || {};
    const errs = validateModel(model);
    if (errs.length) throw new Error(errs.join('\n'));
    const sim = model.sim || {};
    if (sim.mode !== 'transient') {
      const r = solveCoupled(model, 0, 0, {}, { warm: false });
      return { mode: 'steady', steps: [r], final: r };
    }
    const dt = Number(sim.dt) || 1, tEnd = Number(sim.tEnd) || 60;
    const nSteps = Math.round(tEnd / dt);
    if (nSteps > 20000) throw new Error('Too many time steps (max. 20000).');
    let state = {};
    const init = solveCoupled(model, 0, 0, {}, { warm: false });
    state = { T: init.T, V: init.V, soc: init.soc, hydState: init.hydState };
    if (sim.startSteady !== true) { const T0 = {}; model.nodes.filter(n => n.domain === 'th').forEach(n => { T0[n.id] = Number.isFinite(n.fixed) ? n.fixed : (Number.isFinite(Number(n.T0)) ? Number(n.T0) : 20); }); state.T = T0; }
    const steps = [Object.assign({}, init, { t: 0, T: state.T })];
    for (let k = 1; k <= nSteps; k++) {
      const t = k * dt;
      const r = solveCoupled(model, t, dt, state, { warm: true });
      state = { T: r.T, V: r.V, soc: r.soc, hydState: r.hydState };
      steps.push(r);
      if (opts.onStep && k % 25 === 0) opts.onStep(k / nSteps);
    }
    return { mode: 'transient', steps, final: steps[steps.length - 1], dt, tEnd };
  }

  return { gauss, FLUIDS, hydKind, parseHydComponent, solveHydraulic, solveHydraulicWithPtuLogic, linearNetwork, solveCoupled, simulate, validateModel, fluidAt, PA, SH };
});
