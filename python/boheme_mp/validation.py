import math

from . import solver as S


def hyd_model_from_fixture(fx, extra=None):
    p = fx['params']
    m = {
        'fluid': {'model': 'custom', 'rho': p['rho'], 'mu': p['mu'], 'cp': 1750},
        'hydParams': {'g': p['g'], 'krough': p['krough'], 'dUcrit': p['dUcrit'], 'niter': p['niter'], 'lambdaU': p['lambdaU'], 'kReD': p['kReD'], 'ReDcrit': p['ReDcrit'], 'zanke': p['zanke']},
        'ptu': {'logic': True, 'thresholdPsi': 500},
        'nodes': [dict(n, domain='hyd') for n in fx['nodes']],
        'components': [{'name': c['name'], 'domain': 'hyd', 'cell': c['cell'], 'n1': c['n1'], 'n2': c['n2']} for c in fx['components']],
        'sim': {'mode': 'steady'},
    }
    if extra:
        m.update(extra)
    return m


def rel_err(a, b):
    return abs(a - b) / abs(b) if abs(b) > 1e-9 else abs(a - b)


def run(fixtures=None):
    R = []

    def add(group, name, ok, detail='', ref=''):
        R.append({'group': group, 'name': name, 'ok': bool(ok), 'detail': detail, 'ref': ref})

    T40 = -40
    rho40 = S.FLUIDS['skydrol'].rho(T40)
    mu40 = S.FLUIDS['skydrol'].mu(T40)

    if fixtures and fixtures.get('excel'):
        fx = fixtures['excel']
        r = S.simulate(hyd_model_from_fixture(fx))['final']['hyd']
        X = fx['expected_excel']
        add('Hydraulics vs. Excel', 'Iterations equal Excel (18)', r['iterations'] == 18, str(r['iterations']) + ' iterations', 'hydraulic_networks v1.4')
        worst, where = 0.0, ''
        for name, x in X['components'].items():
            w = r['components'].get(name)
            if not w:
                worst, where = float('inf'), name + ' missing'
                break
            sgn = 1 if (w['n1'] == x['n1'] or (x['n1'] == 'S' and str(w['n1']).startswith('S'))) else -1
            for fx_, fw in (('q', 'q'), ('u', 'u'), ('re', 're'), ('qdyn', 'qdyn'), ('dp', 'dp'), ('pow', 'pow')):
                xv = float(x[fx_])
                wv = float(w[fw]) * (sgn if fx_ in ('q', 'dp', 'pow') else 1)
                e = rel_err(wv, xv)
                if e > worst:
                    worst, where = e, name + '.' + fx_
        add('Hydraulics vs. Excel', 'All 51 components × 6 quantities (Q, U, Re, q, ΔP, P) rel. < 1e-6', worst < 1e-6, 'max %.2e (%s)' % (worst, where), 'hydraulic_networks v1.4')
        dn = max(abs(r['nodes'][i] - v) for i, v in X['nodes'].items())
        add('Hydraulics vs. Excel', 'All 38 node pressures |Δ| < 1e-4 bar (Excel output is rounded)', dn < 1e-4, 'max %.2e bar' % dn, 'hydraulic_networks v1.4')
        dpy = max(abs(r['nodes'][i] - v) for i, v in fx['expected_python']['nodes'].items())
        add('Hydraulics vs. Excel', 'Node pressures equal the Python BOHEME solver (< 1e-9 bar)', dpy < 1e-9, 'max %.2e bar' % dpy, 'BOHEME (Python)')

    if fixtures and fixtures.get('a320'):
        fx = fixtures['a320']
        r = S.simulate(hyd_model_from_fixture(fx))['final']['hyd']
        E = fx['expected_python']
        add('A320 Green model', 'Iterations equal BOHEME (%d)' % E['iterations'], r['iterations'] == E['iterations'], str(r['iterations']) + ' iterations', 'BOHEME (Python)')
        dn = max(abs(r['nodes'][i] - v) for i, v in E['nodes'].items())
        add('A320 Green model', 'All node pressures equal BOHEME (< 1e-8 bar)', dn < 1e-8, 'max %.2e bar' % dn, 'BOHEME (Python)')
        dq = max(rel_err(r['components'][n]['q'], v['q']) for n, v in E['components'].items())
        add('A320 Green model', 'All component flows equal BOHEME (rel. < 1e-8)', dq < 1e-8, 'max %.2e' % dq, 'BOHEME (Python)')
        dpsi = (r['nodes']['N02'] - r['nodes']['N41']) * 14.5037738
        add('A320 Green model', 'PTU active, Green–Yellow Δp = 461 psi', r['ptu'] and r['ptu']['active'] and round(dpsi) == 461, '%d psi, Δp without PTU %d psi' % (round(dpsi), round(r['ptu']['dpOffPsi'])), 'BOHEME')

    L, D, Q = 10, 0.01, 0.2
    m = {
        'fluid': {'model': 'custom', 'rho': rho40, 'mu': mu40},
        'hydParams': {'g': 9.80665, 'krough': 0.0015, 'dUcrit': 1e-12, 'niter': 5000, 'lambdaU': 0.6, 'kReD': 0.2, 'ReDcrit': 2320},
        'nodes': [{'id': 'S0', 'domain': 'hyd', 'tap': True, 'z': 0}, {'id': 'N01', 'domain': 'hyd', 'z': 0}],
        'components': [{'name': 'P1', 'domain': 'hyd', 'cell': 'P1 %s 19.6' % Q, 'n1': 'S0', 'n2': 'N01'}, {'name': 'R01', 'domain': 'hyd', 'cell': 'R01 %s %s' % (L, D * 1000), 'n1': 'N01', 'n2': 'S0'}],
        'sim': {'mode': 'steady'},
    }
    r = S.simulate(m)['final']['hyd']
    q = Q / 3600
    A = math.pi / 4 * D * D
    U = q / A
    p = (128 * mu40 * L * q / (math.pi * D ** 4) + 0.5 * rho40 * U * U) / 1e5
    add('Hydraulics – analytic', 'Laminar pipe: p = 128·μ·L·Q/(π·d⁴) + ρU²/2 (Hagen–Poiseuille + outlet head)', rel_err(r['nodes']['N01'], p) < 1e-9, '%.6f vs %.6f bar' % (r['nodes']['N01'], p), 'Hagen–Poiseuille')

    for kv in (0.1, 0.54):
        m = {
            'fluid': {'model': 'custom', 'rho': rho40, 'mu': mu40}, 'hydParams': {'dUcrit': 1e-12, 'niter': 5000},
            'nodes': [{'id': 'S0', 'domain': 'hyd', 'tap': True, 'z': 0}, {'id': 'N01', 'domain': 'hyd'}],
            'components': [{'name': 'P1', 'domain': 'hyd', 'cell': 'P1 1 19.6', 'n1': 'S0', 'n2': 'N01'}, {'name': 'Rk_G', 'domain': 'hyd', 'cell': 'Rk_G %s' % kv, 'n1': 'N01', 'n2': 'S0'}],
            'sim': {'mode': 'steady'},
        }
        r = S.simulate(m)['final']['hyd']
        ex = (1 / kv) ** 2
        add('Hydraulics – analytic', 'k_V valve: Δp = (Q/k_V)² bar, k_V = %s' % kv, rel_err(r['nodes']['N01'], ex) < 1e-6, '%.6f vs %.6f bar' % (r['nodes']['N01'], ex), 'k_V definition')

    m = {
        'fluid': {'model': 'custom', 'rho': 1000, 'mu': 1e-3}, 'hydParams': {'dUcrit': 1e-12, 'niter': 5000},
        'nodes': [{'id': 'S0', 'domain': 'hyd', 'tap': True, 'z': 0}, {'id': 'N01', 'domain': 'hyd'}, {'id': 'N02', 'domain': 'hyd'}],
        'components': [{'name': 'P1', 'domain': 'hyd', 'cell': 'P1 3 19.6', 'n1': 'S0', 'n2': 'N01'}, {'name': 'Rl_A', 'domain': 'hyd', 'cell': 'Rl_A 2 999', 'n1': 'N01', 'n2': 'N02'}, {'name': 'Rl_B', 'domain': 'hyd', 'cell': 'Rl_B 4 999', 'n1': 'N01', 'n2': 'N02'}, {'name': 'Rl_C', 'domain': 'hyd', 'cell': 'Rl_C 1 999', 'n1': 'N02', 'n2': 'S0'}],
        'sim': {'mode': 'steady'},
    }
    r = S.simulate(m)['final']['hyd']
    Rp = 1 / (1 / 2 + 1 / 4)
    dpp = r['nodes']['N01'] - r['nodes']['N02']
    split = r['components']['Rl_A']['q'] / r['components']['Rl_B']['q']
    add('Hydraulics – analytic', 'Linear network: parallel/series resistances (Ohm analogy)', rel_err(dpp, 3 * Rp) < 1e-6 and rel_err(split, 2) < 1e-6, 'Δp = %.6f vs %.6f bar, flow split %.6f' % (dpp, 3 * Rp, split), 'Kirchhoff')

    m = {'nodes': [{'id': 'AMB', 'domain': 'th', 'fixed': 20}, {'id': 'T1', 'domain': 'th'}], 'components': [{'name': 'G1', 'domain': 'th', 'type': 'G', 'n1': 'T1', 'n2': 'AMB', 'G': 5}, {'name': 'Q1', 'domain': 'th', 'type': 'Q', 'n1': 'T1', 'P': 150}], 'sim': {'mode': 'steady'}}
    r = S.simulate(m)['final']
    add('Thermal – analytic', 'Steady conduction: T = T_amb + P/G', rel_err(r['T']['T1'], 50) < 1e-12, '%.9f °C vs 50 °C' % r['T']['T1'], 'Fourier')

    C, G, P, Tamb = 2000, 4, 100, 20
    tau = C / G
    for dt in (5, 1, 0.1):
        m = {'nodes': [{'id': 'AMB', 'domain': 'th', 'fixed': Tamb}, {'id': 'T1', 'domain': 'th', 'C': C, 'T0': Tamb}], 'components': [{'name': 'G1', 'domain': 'th', 'type': 'G', 'n1': 'T1', 'n2': 'AMB', 'G': G}, {'name': 'Q1', 'domain': 'th', 'type': 'Q', 'n1': 'T1', 'P': P}], 'sim': {'mode': 'transient', 'dt': dt, 'tEnd': 1000, 'startSteady': False}}
        res = S.simulate(m)
        Tsim = res['final']['T']['T1']
        Tinf = Tamb + P / G
        n = int(math.floor(1000 / dt + 0.5))
        a = 1 / (1 + dt / tau)
        Tdisc = Tinf + (Tamb - Tinf) * a ** n
        Tex = Tinf + (Tamb - Tinf) * math.exp(-1000 / tau)
        if dt == 5:
            add('Thermal – analytic', 'RC transient equals exact implicit-Euler solution (dt = 5 s)', abs(Tsim - Tdisc) < 1e-9, '%.9f vs %.9f °C' % (Tsim, Tdisc), 'implicit Euler')
        lim = 0.2 if dt == 5 else (0.04 if dt == 1 else 0.004)
        add('Thermal – analytic', 'RC transient vs. analytic e^(−t/τ), dt = %s s (error must shrink with dt)' % dt, abs(Tsim - Tex) < lim, 'error %.2e K' % abs(Tsim - Tex), 'T(t) = T∞ + (T0−T∞)·e^(−t/τ)')

    m = {'nodes': [{'id': 'GND', 'domain': 'el', 'fixed': 0}, {'id': 'A', 'domain': 'el'}, {'id': 'B', 'domain': 'el'}], 'components': [{'name': 'V1', 'domain': 'el', 'type': 'V', 'n1': 'GND', 'n2': 'A', 'E': 28, 'Rint': 1e-6}, {'name': 'R1', 'domain': 'el', 'type': 'R', 'n1': 'A', 'n2': 'B', 'R': 3}, {'name': 'R2', 'domain': 'el', 'type': 'R', 'n1': 'B', 'n2': 'GND', 'R': 1}], 'sim': {'mode': 'steady'}}
    r = S.simulate(m)['final']['el']
    add('Electrical – analytic', 'Voltage divider: V_B = E·R2/(R1+R2)', rel_err(r['nodes']['B'], 7) < 1e-6, '%.9f V vs 7 V' % r['nodes']['B'], 'Ohm/Kirchhoff')

    E, Ri, P = 28, 0.2, 500
    m = {'nodes': [{'id': 'GND', 'domain': 'el', 'fixed': 0}, {'id': 'BUS', 'domain': 'el', 'V0': 28}], 'components': [{'name': 'V1', 'domain': 'el', 'type': 'V', 'n1': 'GND', 'n2': 'BUS', 'E': E, 'Rint': Ri}, {'name': 'L1', 'domain': 'el', 'type': 'LOAD', 'n1': 'BUS', 'n2': 'GND', 'P': P}], 'sim': {'mode': 'steady'}}
    r = S.simulate(m)['final']['el']
    ex = (E + math.sqrt(E * E - 4 * P * Ri)) / 2
    add('Electrical – analytic', 'Constant-power load: V = (E + √(E² − 4PR))/2', rel_err(r['nodes']['BUS'], ex) < 1e-9, '%.9f vs %.9f V' % (r['nodes']['BUS'], ex), 'quadratic solution')

    m = {'nodes': [{'id': 'GND', 'domain': 'el', 'fixed': 0}, {'id': 'BUS', 'domain': 'el', 'V0': 25}], 'components': [{'name': 'B1', 'domain': 'el', 'type': 'BAT', 'n1': 'GND', 'n2': 'BUS', 'vmin': 24, 'vmax': 24, 'Rint': 0.01, 'capacityAh': 10, 'soc0': 1}, {'name': 'R1', 'domain': 'el', 'type': 'R', 'n1': 'BUS', 'n2': 'GND', 'R': 2.39}], 'sim': {'mode': 'transient', 'dt': 60, 'tEnd': 1800}}
    res = S.simulate(m)
    I = 24 / 2.4
    ex = 1 - I * 1800 / (3600 * 10)
    add('Electrical – analytic', 'Battery SOC (Coulomb counting): SOC = SOC0 − I·t/C', rel_err(res['final']['soc']['B1'], ex) < 1e-9, '%.9f vs %.9f' % (res['final']['soc']['B1'], ex), 'charge balance')

    m = {'nodes': [{'id': 'GND', 'domain': 'el', 'fixed': 0}, {'id': 'A', 'domain': 'el'}, {'id': 'AMB', 'domain': 'th', 'fixed': 25}, {'id': 'Tr', 'domain': 'th'}], 'components': [{'name': 'V1', 'domain': 'el', 'type': 'V', 'n1': 'GND', 'n2': 'A', 'E': 10, 'Rint': 1e-9}, {'name': 'R1', 'domain': 'el', 'type': 'R', 'n1': 'A', 'n2': 'GND', 'R': 2, 'heatTo': 'Tr'}, {'name': 'G1', 'domain': 'th', 'type': 'G', 'n1': 'Tr', 'n2': 'AMB', 'G': 0.5}], 'sim': {'mode': 'steady'}}
    r = S.simulate(m)['final']
    add('Coupling', 'Electrical → thermal: T = T_amb + U²/(R·G)', rel_err(r['T']['Tr'], 25 + 100 / 2 / 0.5) < 1e-9, '%.9f vs %d °C' % (r['T']['Tr'], 125), 'Joule heating')

    m = {
        'fluid': {'model': 'skydrol', 'T': 40, 'tempNode': 'Toil'}, 'hydParams': {'dUcrit': 1e-12, 'niter': 5000},
        'nodes': [{'id': 'S0', 'domain': 'hyd', 'tap': True, 'z': 0}, {'id': 'N01', 'domain': 'hyd'}, {'id': 'AMB', 'domain': 'th', 'fixed': 20}, {'id': 'Toil', 'domain': 'th'}],
        'components': [{'name': 'P1', 'domain': 'hyd', 'cell': 'P1 2 19.6', 'n1': 'S0', 'n2': 'N01'}, {'name': 'R01', 'domain': 'hyd', 'cell': 'R01 30 6', 'n1': 'N01', 'n2': 'S0', 'heatTo': 'Toil'}, {'name': 'G1', 'domain': 'th', 'type': 'G', 'n1': 'Toil', 'n2': 'AMB', 'G': 400}],
        'sim': {'mode': 'steady'},
    }
    r = S.simulate(m)['final']
    heat = r['hyd']['components']['R01']['pow'] * 1000
    add('Coupling', 'Hydraulic losses → thermal node: heat = ΔP·Q, energy balance closed', rel_err(heat, 400 * (r['T']['Toil'] - 20)) < 1e-6, 'ΔP·Q = %.3f W, G·ΔT = %.3f W' % (heat, 400 * (r['T']['Toil'] - 20)), 'energy conservation')
    mu_used = r['hyd']['props']['mu']
    mu_at = S.FLUIDS['skydrol'].mu(r['T']['Toil'])
    add('Coupling', 'Thermal → hydraulic: viscosity consistent with converged oil temperature', rel_err(mu_used, mu_at) < 1e-6, 'T_oil = %.4f °C, μ used %.6e vs μ(T) %.6e' % (r['T']['Toil'], mu_used, mu_at), 'two-way fixed point')

    m = {
        'fluid': {'model': 'skydrol', 'T': 20}, 'hydParams': {'dUcrit': 1e-12, 'niter': 5000},
        'nodes': [{'id': 'S0', 'domain': 'hyd', 'tap': True, 'z': 0}, {'id': 'N01', 'domain': 'hyd'}, {'id': 'GND', 'domain': 'el', 'fixed': 0}, {'id': 'BUS', 'domain': 'el', 'V0': 115}],
        'components': [{'name': 'P1', 'domain': 'hyd', 'cell': 'P1 1.5 19.6', 'n1': 'S0', 'n2': 'N01'}, {'name': 'Rl_A', 'domain': 'hyd', 'cell': 'Rl_A 40 999', 'n1': 'N01', 'n2': 'S0'}, {'name': 'V1', 'domain': 'el', 'type': 'V', 'n1': 'GND', 'n2': 'BUS', 'E': 115, 'Rint': 0.05}, {'name': 'M1', 'domain': 'el', 'type': 'MOTORPUMP', 'n1': 'BUS', 'n2': 'GND', 'pump': 'P1', 'eta': 0.8}],
        'sim': {'mode': 'steady'},
    }
    r = S.simulate(m)['final']
    Ph = abs(r['hyd']['components']['P1']['pow']) * 1000
    Pe = r['el']['components']['M1']['p']
    ok = rel_err(Pe, Ph / 0.8) < 1e-9 and rel_err(r['el']['components']['V1']['i'] * r['el']['nodes']['BUS'], Pe) < 1e-6
    add('Coupling', 'Hydraulic → electrical: motor-pump draws P_el = P_hyd / η', ok, 'P_hyd = %.3f W, P_el = %.3f W' % (Ph, Pe), 'power balance')
    return R
