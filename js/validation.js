(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPValidation = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hydModelFromFixture(fx, extra) {
    const p = fx.params;
    return Object.assign({
      fluid: { model: 'custom', rho: p.rho, mu: p.mu, cp: 1750 },
      hydParams: { g: p.g, krough: p.krough, dUcrit: p.dUcrit, niter: p.niter, lambdaU: p.lambdaU, kReD: p.kReD, ReDcrit: p.ReDcrit, zanke: p.zanke },
      ptu: { logic: true, thresholdPsi: 500 },
      nodes: fx.nodes.map(n => Object.assign({}, n, { domain: 'hyd' })),
      components: fx.components.map(c => ({ name: c.name, domain: 'hyd', cell: c.cell, n1: c.n1, n2: c.n2 })),
      sim: { mode: 'steady' }
    }, extra || {});
  }

  function relErr(a, b) { return Math.abs(b) > 1e-9 ? Math.abs(a - b) / Math.abs(b) : Math.abs(a - b); }

  function run(S, fixtures) {
    const R = [];
    const add = (group, name, ok, detail, ref) => R.push({ group, name, ok: !!ok, detail: detail || '', ref: ref || '' });
    const T40 = -40, rho40 = S.FLUIDS.skydrol.rho(T40), mu40 = S.FLUIDS.skydrol.mu(T40);

    if (fixtures && fixtures.excel) {
      const fx = fixtures.excel;
      const r = S.simulate(hydModelFromFixture(fx)).final.hyd;
      const X = fx.expected_excel;
      add('Hydraulics vs. Excel', 'Iterations equal Excel (18)', r.iterations === 18, r.iterations + ' iterations', 'hydraulic_networks v1.4');
      let worst = 0, where = '';
      for (const name in X.components) {
        const x = X.components[name], w = r.components[name];
        if (!w) { worst = Infinity; where = name + ' missing'; break; }
        const sgn = w.n1 === x.n1 || (x.n1 === 'S' && /^S/.test(w.n1)) ? 1 : -1;
        for (const [fx_, fw] of [['q', 'q'], ['u', 'u'], ['re', 're'], ['qdyn', 'qdyn'], ['dp', 'dp'], ['pow', 'pow']]) {
          const xv = Number(x[fx_]); const wv = Number(w[fw]) * ((fx_ === 'q' || fx_ === 'dp' || fx_ === 'pow') ? sgn : 1);
          const e = relErr(wv, xv);
          if (e > worst) { worst = e; where = name + '.' + fx_; }
        }
      }
      add('Hydraulics vs. Excel', 'All 51 components × 6 quantities (Q, U, Re, q, ΔP, P) rel. < 1e-6', worst < 1e-6, 'max ' + worst.toExponential(2) + ' (' + where + ')', 'hydraulic_networks v1.4');
      let dn = 0;
      for (const id in X.nodes) dn = Math.max(dn, Math.abs(r.nodes[id] - X.nodes[id]));
      add('Hydraulics vs. Excel', 'All 38 node pressures |Δ| < 1e-4 bar (Excel output is rounded)', dn < 1e-4, 'max ' + dn.toExponential(2) + ' bar', 'hydraulic_networks v1.4');
      let dpy = 0;
      for (const id in fx.expected_python.nodes) dpy = Math.max(dpy, Math.abs(r.nodes[id] - fx.expected_python.nodes[id]));
      add('Hydraulics vs. Excel', 'Node pressures equal the Python BOHEME solver (< 1e-9 bar)', dpy < 1e-9, 'max ' + dpy.toExponential(2) + ' bar', 'BOHEME (Python)');
    }

    if (fixtures && fixtures.a320) {
      const fx = fixtures.a320;
      const r = S.simulate(hydModelFromFixture(fx)).final.hyd;
      const E = fx.expected_python;
      add('A320 Green model', 'Iterations equal BOHEME (' + E.iterations + ')', r.iterations === E.iterations, r.iterations + ' iterations', 'BOHEME (Python)');
      let dn = 0; for (const id in E.nodes) dn = Math.max(dn, Math.abs(r.nodes[id] - E.nodes[id]));
      add('A320 Green model', 'All node pressures equal BOHEME (< 1e-8 bar)', dn < 1e-8, 'max ' + dn.toExponential(2) + ' bar', 'BOHEME (Python)');
      let dq = 0; for (const n in E.components) dq = Math.max(dq, relErr(r.components[n].q, E.components[n].q));
      add('A320 Green model', 'All component flows equal BOHEME (rel. < 1e-8)', dq < 1e-8, 'max ' + dq.toExponential(2), 'BOHEME (Python)');
      const dpsi = (r.nodes.N02 - r.nodes.N41) * 14.5037738;
      add('A320 Green model', 'PTU active, Green–Yellow Δp = 461 psi', r.ptu && r.ptu.active && Math.round(dpsi) === 461, Math.round(dpsi) + ' psi, Δp without PTU ' + Math.round(r.ptu.dpOffPsi) + ' psi', 'BOHEME');
    }

    {
      const L = 10, D = 0.01, Q = 0.2;
      const m = {
        fluid: { model: 'custom', rho: rho40, mu: mu40 },
        hydParams: { g: 9.80665, krough: 0.0015, dUcrit: 1e-12, niter: 5000, lambdaU: 0.6, kReD: 0.2, ReDcrit: 2320 },
        nodes: [{ id: 'S0', domain: 'hyd', tap: true, z: 0 }, { id: 'N01', domain: 'hyd', z: 0 }],
        components: [{ name: 'P1', domain: 'hyd', cell: 'P1 ' + Q + ' 19.6', n1: 'S0', n2: 'N01' }, { name: 'R01', domain: 'hyd', cell: 'R01 ' + L + ' ' + D * 1000, n1: 'N01', n2: 'S0' }],
        sim: { mode: 'steady' }
      };
      const r = S.simulate(m).final.hyd;
      const q = Q / 3600, A = Math.PI / 4 * D * D, U = q / A;
      const p = (128 * mu40 * L * q / (Math.PI * Math.pow(D, 4)) + 0.5 * rho40 * U * U) / 1e5;
      add('Hydraulics – analytic', 'Laminar pipe: p = 128·μ·L·Q/(π·d⁴) + ρU²/2 (Hagen–Poiseuille + outlet head)', relErr(r.nodes.N01, p) < 1e-9, r.nodes.N01.toFixed(6) + ' vs ' + p.toFixed(6) + ' bar', 'Hagen–Poiseuille');
    }
    {
      for (const kv of [0.1, 0.54]) {
        const m = {
          fluid: { model: 'custom', rho: rho40, mu: mu40 }, hydParams: { dUcrit: 1e-12, niter: 5000 },
          nodes: [{ id: 'S0', domain: 'hyd', tap: true, z: 0 }, { id: 'N01', domain: 'hyd' }],
          components: [{ name: 'P1', domain: 'hyd', cell: 'P1 1 19.6', n1: 'S0', n2: 'N01' }, { name: 'Rk_G', domain: 'hyd', cell: 'Rk_G ' + kv, n1: 'N01', n2: 'S0' }],
          sim: { mode: 'steady' }
        };
        const r = S.simulate(m).final.hyd; const ex = Math.pow(1 / kv, 2);
        add('Hydraulics – analytic', 'k_V valve: Δp = (Q/k_V)² bar, k_V = ' + kv, relErr(r.nodes.N01, ex) < 1e-6, r.nodes.N01.toFixed(6) + ' vs ' + ex.toFixed(6) + ' bar', 'k_V definition');
      }
    }
    {
      const m = {
        fluid: { model: 'custom', rho: 1000, mu: 1e-3 }, hydParams: { dUcrit: 1e-12, niter: 5000 },
        nodes: [{ id: 'S0', domain: 'hyd', tap: true, z: 0 }, { id: 'N01', domain: 'hyd' }, { id: 'N02', domain: 'hyd' }],
        components: [{ name: 'P1', domain: 'hyd', cell: 'P1 3 19.6', n1: 'S0', n2: 'N01' }, { name: 'Rl_A', domain: 'hyd', cell: 'Rl_A 2 999', n1: 'N01', n2: 'N02' }, { name: 'Rl_B', domain: 'hyd', cell: 'Rl_B 4 999', n1: 'N01', n2: 'N02' }, { name: 'Rl_C', domain: 'hyd', cell: 'Rl_C 1 999', n1: 'N02', n2: 'S0' }],
        sim: { mode: 'steady' }
      };
      const r = S.simulate(m).final.hyd;
      const Rp = 1 / (1 / 2 + 1 / 4);
      add('Hydraulics – analytic', 'Linear network: parallel/series resistances (Ohm analogy)', relErr(r.nodes.N01 - r.nodes.N02, 3 * Rp) < 1e-6 && relErr(r.components.Rl_A.q / r.components.Rl_B.q, 2) < 1e-6, 'Δp = ' + (r.nodes.N01 - r.nodes.N02).toFixed(6) + ' vs ' + (3 * Rp).toFixed(6) + ' bar, flow split ' + (r.components.Rl_A.q / r.components.Rl_B.q).toFixed(6), 'Kirchhoff');
    }

    {
      const m = { nodes: [{ id: 'AMB', domain: 'th', fixed: 20 }, { id: 'T1', domain: 'th' }], components: [{ name: 'G1', domain: 'th', type: 'G', n1: 'T1', n2: 'AMB', G: 5 }, { name: 'Q1', domain: 'th', type: 'Q', n1: 'T1', P: 150 }], sim: { mode: 'steady' } };
      const r = S.simulate(m).final;
      add('Thermal – analytic', 'Steady conduction: T = T_amb + P/G', relErr(r.T.T1, 50) < 1e-12, r.T.T1.toFixed(9) + ' °C vs 50 °C', 'Fourier');
    }
    {
      const C = 2000, G = 4, P = 100, Tamb = 20, tau = C / G;
      for (const dt of [5, 1, 0.1]) {
        const m = { nodes: [{ id: 'AMB', domain: 'th', fixed: Tamb }, { id: 'T1', domain: 'th', C, T0: Tamb }], components: [{ name: 'G1', domain: 'th', type: 'G', n1: 'T1', n2: 'AMB', G }, { name: 'Q1', domain: 'th', type: 'Q', n1: 'T1', P }], sim: { mode: 'transient', dt, tEnd: 1000, startSteady: false } };
        const res = S.simulate(m); const Tsim = res.final.T.T1;
        const Tinf = Tamb + P / G; const n = Math.round(1000 / dt); const a = 1 / (1 + dt / tau);
        const Tdisc = Tinf + (Tamb - Tinf) * Math.pow(a, n);
        const Tex = Tinf + (Tamb - Tinf) * Math.exp(-1000 / tau);
        if (dt === 5) add('Thermal – analytic', 'RC transient equals exact implicit-Euler solution (dt = 5 s)', Math.abs(Tsim - Tdisc) < 1e-9, Tsim.toFixed(9) + ' vs ' + Tdisc.toFixed(9) + ' °C', 'implicit Euler');
        add('Thermal – analytic', 'RC transient vs. analytic e^(−t/τ), dt = ' + dt + ' s (error must shrink with dt)', Math.abs(Tsim - Tex) < (dt === 5 ? 0.2 : dt === 1 ? 0.04 : 0.004), 'error ' + Math.abs(Tsim - Tex).toExponential(2) + ' K', 'T(t) = T∞ + (T0−T∞)·e^(−t/τ)');
      }
    }

    {
      const m = { nodes: [{ id: 'GND', domain: 'el', fixed: 0 }, { id: 'A', domain: 'el' }, { id: 'B', domain: 'el' }], components: [{ name: 'V1', domain: 'el', type: 'V', n1: 'GND', n2: 'A', E: 28, Rint: 1e-6 }, { name: 'R1', domain: 'el', type: 'R', n1: 'A', n2: 'B', R: 3 }, { name: 'R2', domain: 'el', type: 'R', n1: 'B', n2: 'GND', R: 1 }], sim: { mode: 'steady' } };
      const r = S.simulate(m).final.el;
      add('Electrical – analytic', 'Voltage divider: V_B = E·R2/(R1+R2)', relErr(r.nodes.B, 7) < 1e-6, r.nodes.B.toFixed(9) + ' V vs 7 V', 'Ohm/Kirchhoff');
    }
    {
      const E = 28, Ri = 0.2, P = 500;
      const m = { nodes: [{ id: 'GND', domain: 'el', fixed: 0 }, { id: 'BUS', domain: 'el', V0: 28 }], components: [{ name: 'V1', domain: 'el', type: 'V', n1: 'GND', n2: 'BUS', E, Rint: Ri }, { name: 'L1', domain: 'el', type: 'LOAD', n1: 'BUS', n2: 'GND', P }], sim: { mode: 'steady' } };
      const r = S.simulate(m).final.el; const ex = (E + Math.sqrt(E * E - 4 * P * Ri)) / 2;
      add('Electrical – analytic', 'Constant-power load: V = (E + √(E² − 4PR))/2', relErr(r.nodes.BUS, ex) < 1e-9, r.nodes.BUS.toFixed(9) + ' vs ' + ex.toFixed(9) + ' V', 'quadratic solution');
    }
    {
      const m = { nodes: [{ id: 'GND', domain: 'el', fixed: 0 }, { id: 'BUS', domain: 'el', V0: 25 }], components: [{ name: 'B1', domain: 'el', type: 'BAT', n1: 'GND', n2: 'BUS', vmin: 24, vmax: 24, Rint: 0.01, capacityAh: 10, soc0: 1 }, { name: 'R1', domain: 'el', type: 'R', n1: 'BUS', n2: 'GND', R: 2.39 }], sim: { mode: 'transient', dt: 60, tEnd: 1800 } };
      const res = S.simulate(m); const I = 24 / 2.4; const ex = 1 - I * 1800 / (3600 * 10);
      add('Electrical – analytic', 'Battery SOC (Coulomb counting): SOC = SOC0 − I·t/C', relErr(res.final.soc.B1, ex) < 1e-9, res.final.soc.B1.toFixed(9) + ' vs ' + ex.toFixed(9), 'charge balance');
    }

    {
      const m = { nodes: [{ id: 'GND', domain: 'el', fixed: 0 }, { id: 'A', domain: 'el' }, { id: 'AMB', domain: 'th', fixed: 25 }, { id: 'Tr', domain: 'th' }], components: [{ name: 'V1', domain: 'el', type: 'V', n1: 'GND', n2: 'A', E: 10, Rint: 1e-9 }, { name: 'R1', domain: 'el', type: 'R', n1: 'A', n2: 'GND', R: 2, heatTo: 'Tr' }, { name: 'G1', domain: 'th', type: 'G', n1: 'Tr', n2: 'AMB', G: 0.5 }], sim: { mode: 'steady' } };
      const r = S.simulate(m).final;
      add('Coupling', 'Electrical → thermal: T = T_amb + U²/(R·G)', relErr(r.T.Tr, 25 + 100 / 2 / 0.5) < 1e-9, r.T.Tr.toFixed(9) + ' vs ' + (25 + 100) + ' °C', 'Joule heating');
    }
    {
      const m = {
        fluid: { model: 'skydrol', T: 40, tempNode: 'Toil' }, hydParams: { dUcrit: 1e-12, niter: 5000 },
        nodes: [{ id: 'S0', domain: 'hyd', tap: true, z: 0 }, { id: 'N01', domain: 'hyd' }, { id: 'AMB', domain: 'th', fixed: 20 }, { id: 'Toil', domain: 'th' }],
        components: [{ name: 'P1', domain: 'hyd', cell: 'P1 2 19.6', n1: 'S0', n2: 'N01' }, { name: 'R01', domain: 'hyd', cell: 'R01 30 6', n1: 'N01', n2: 'S0', heatTo: 'Toil' }, { name: 'G1', domain: 'th', type: 'G', n1: 'Toil', n2: 'AMB', G: 400 }],
        sim: { mode: 'steady' }
      };
      const r = S.simulate(m).final;
      const heat = r.hyd.components.R01.pow * 1000;
      add('Coupling', 'Hydraulic losses → thermal node: heat = ΔP·Q, energy balance closed', relErr(heat, 400 * (r.T.Toil - 20)) < 1e-6, 'ΔP·Q = ' + heat.toFixed(3) + ' W, G·ΔT = ' + (400 * (r.T.Toil - 20)).toFixed(3) + ' W', 'energy conservation');
      const muUsed = r.hyd.props.mu, muAtT = S.FLUIDS.skydrol.mu(r.T.Toil);
      add('Coupling', 'Thermal → hydraulic: viscosity consistent with converged oil temperature', relErr(muUsed, muAtT) < 1e-6, 'T_oil = ' + r.T.Toil.toFixed(4) + ' °C, μ used ' + muUsed.toExponential(6) + ' vs μ(T) ' + muAtT.toExponential(6), 'two-way fixed point');
    }
    {
      const m = {
        fluid: { model: 'skydrol', T: 20 }, hydParams: { dUcrit: 1e-12, niter: 5000 },
        nodes: [{ id: 'S0', domain: 'hyd', tap: true, z: 0 }, { id: 'N01', domain: 'hyd' }, { id: 'GND', domain: 'el', fixed: 0 }, { id: 'BUS', domain: 'el', V0: 115 }],
        components: [{ name: 'P1', domain: 'hyd', cell: 'P1 1.5 19.6', n1: 'S0', n2: 'N01' }, { name: 'Rl_A', domain: 'hyd', cell: 'Rl_A 40 999', n1: 'N01', n2: 'S0' }, { name: 'V1', domain: 'el', type: 'V', n1: 'GND', n2: 'BUS', E: 115, Rint: 0.05 }, { name: 'M1', domain: 'el', type: 'MOTORPUMP', n1: 'BUS', n2: 'GND', pump: 'P1', eta: 0.8 }],
        sim: { mode: 'steady' }
      };
      const r = S.simulate(m).final;
      const Ph = Math.abs(r.hyd.components.P1.pow) * 1000, Pe = r.el.components.M1.p;
      add('Coupling', 'Hydraulic → electrical: motor-pump draws P_el = P_hyd / η', relErr(Pe, Ph / 0.8) < 1e-9 && relErr(r.el.components.V1.i * r.el.nodes.BUS, Pe) < 1e-6, 'P_hyd = ' + Ph.toFixed(3) + ' W, P_el = ' + Pe.toFixed(3) + ' W', 'power balance');
    }
    return R;
  }

  return { run, hydModelFromFixture };
});
