import copy
import json
import math

PA = 1e5
SH = 3600.0
MM = 1000.0
_MISSING = object()


def num(v):
    if v is _MISSING:
        return float('nan')
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s == '':
        return 0.0
    try:
        return float(s)
    except ValueError:
        return float('nan')


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def finite(x):
    return isinstance(x, float) and math.isfinite(x) or (isinstance(x, int) and not isinstance(x, bool))


def or_default(v, d):
    x = num(v)
    return x if (x == x and x != 0) else d


def is_off(v):
    return v is False or v == 'off'


def gauss(A, b):
    n = len(b)
    M = [list(A[i]) + [b[i]] for i in range(n)]
    for k in range(n):
        p = k
        mx = abs(M[k][k])
        for i in range(k + 1, n):
            v = abs(M[i][k])
            if v > mx:
                mx = v
                p = i
        if not (mx > 1e-300):
            return None
        if p != k:
            M[k], M[p] = M[p], M[k]
        piv = M[k][k]
        Mk = M[k]
        for i in range(k + 1, n):
            Mi = M[i]
            f = Mi[k] / piv
            if f == 0:
                continue
            M[i] = Mi[:k] + [mi - f * mk for mi, mk in zip(Mi[k:], Mk[k:])]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        s = M[i][n]
        Mi = M[i]
        for j in range(i + 1, n):
            s -= Mi[j] * x[j]
        x[i] = s / Mi[i]
    return x


class _Fluid:
    def __init__(self, label, rho, mu, cp):
        self.label = label
        self.rho = rho
        self.mu = mu
        self.cp = cp


FLUIDS = {
    'skydrol': _Fluid('Skydrol LD-4 (BOHEME/Excel formula)',
                      lambda T: 1025 * math.exp(-0.00083 * T),
                      lambda T: 5.17e-5 * math.exp(1084 / (T + 273.15 - 110)),
                      lambda T: 1750),
    'water': _Fluid('Water (approximation 5–90 °C)',
                    lambda T: 1000 * (1 - (T - 4) ** 2 / 180000),
                    lambda T: 2.414e-5 * 10 ** (247.8 / (T + 273.15 - 140)),
                    lambda T: 4186),
    'glycol50': _Fluid('Water–glycol 50/50 (approximation)',
                       lambda T: 1082 - 0.5 * T,
                       lambda T: 3.2e-3 * math.exp(-0.026 * (T - 20)) + 3e-4,
                       lambda T: 3300),
}


def hyd_kind(name):
    u = str(name).upper()
    for k in ('RZ', 'RK', 'RR', 'RL'):
        if u.startswith(k):
            return k
    for k in ('UCP', 'UPR', 'UCV', 'UPT', 'UPM'):
        if u.startswith(k):
            return k
    if u.startswith('R'):
        return 'R'
    if u.startswith('P'):
        return 'P'
    if u.startswith('U'):
        return 'U'
    return None


def num_tokens(cell):
    t = str(cell).strip().split()
    nums = []
    for tok in t[1:]:
        v = num(str(tok).replace(',', '.', 1))
        if not math.isfinite(v):
            break
        nums.append(v)
    return (t[0] if t else ''), nums


class HydComp:
    pass


def parse_hyd_component(src, par):
    name, nums = num_tokens(src.get('cell') or src.get('name'))
    kind = hyd_kind(name)
    if not kind:
        raise ValueError('Unknown hydraulic component type "' + name + '".')
    if kind == 'RR':
        raise ValueError('Pressure regulator Rr is not supported (' + name + ').')
    need = {'R': 2, 'RZ': 2, 'RK': 1, 'RL': 2, 'P': 2, 'UCP': 3, 'UPR': 3, 'UCV': 3, 'UPM': 3, 'U': 3, 'UPT': 2}[kind]
    if len(nums) < need:
        raise ValueError('Component "' + name + '" needs ' + str(need) + ' numeric parameters.')
    c = HydComp()
    c.name = name
    c.kind = kind
    c.n1 = src.get('n1')
    c.n2 = src.get('n2')
    c.U = 1.0
    c.q = 0.0
    c.Ptot1 = 0.0
    c.Ptot2 = 0.0
    c.Fwd = True
    c.Qsc = 0.0
    c.Rd = 0.0
    c.Dpoc = 0.0
    c.Diam = 0.0
    c.PipeLen = 0.0
    c.Zeta = 0.0
    c.Kv = 0.0
    c.heatTo = src.get('heatTo') or ''
    c.partner = None
    c.isPtuPump = False
    c.Rd0 = None
    c.EtaV = c.EtaHm = c.DispRatio = c.Pset = c.Qmax = None
    if kind == 'R':
        c.PipeLen = nums[0]; c.Diam = nums[1] / MM
    elif kind == 'RZ':
        c.Zeta = nums[0]; c.Diam = nums[1] / MM
    elif kind == 'RK':
        c.Kv = nums[0]
    elif kind == 'RL':
        c.Rd = nums[0] * PA * SH; c.Diam = nums[1] / MM
    elif kind == 'P':
        c.Qsc = nums[0] / SH; c.Diam = nums[1] / MM
    elif kind == 'UCP':
        c.Qsc = nums[0] / SH; c.Dpoc = nums[1] * PA; c.Diam = nums[2] / MM; c.Rd = -c.Dpoc / c.Qsc
    elif kind == 'UPR':
        c.Dpoc = nums[0] * PA; c.Rd = nums[1] * PA * SH; c.Diam = nums[2] / MM; c.Qsc = -c.Dpoc / c.Rd
    elif kind == 'UCV':
        c.Dpoc = nums[0] * PA; c.Rd = nums[1] * PA * SH; c.Diam = nums[2] / MM; c.Qsc = -c.Dpoc / c.Rd
    elif kind == 'UPM':
        c.Pset = nums[0] * PA; c.Qmax = nums[1] / SH; c.Qsc = c.Qmax; c.Diam = nums[2] / MM
    elif kind == 'U':
        c.Dpoc = nums[0] * PA; c.Qsc = nums[1] / SH; c.Diam = nums[2] / MM; c.Rd = -c.Dpoc / c.Qsc
    elif kind == 'UPT':
        c.isPtuPump = name[-1:].lower() == 'b'
        if c.isPtuPump:
            if len(nums) >= 4:
                c.EtaV, c.EtaHm, c.DispRatio, c.Diam = nums[0], nums[1], nums[2], nums[3] / MM
            else:
                c.EtaV, c.EtaHm, c.DispRatio, c.Diam = 1.0, 1.0, 1.0, nums[0] / MM
        else:
            if len(nums) >= 4:
                c.EtaV, c.EtaHm, c.Rd, c.Diam = nums[0], nums[1], nums[2] * PA * SH, nums[3] / MM
            else:
                c.EtaV, c.EtaHm, c.Rd, c.Diam = 1.0, nums[0], nums[1] * PA * SH, nums[2] / MM
            c.Rd0 = c.Rd
    if kind == 'RK':
        c.Area = c.Kv / math.sqrt(2) * (1 / SH) * math.sqrt(par['rho'] / PA)
        c.Kd = 0.0
    else:
        c.Area = math.pi / 4 * c.Diam * c.Diam
        c.Kd = (par['krough'] / MM) / c.Diam if c.Diam != 0 else 0.0
    return c


def sig_of(net):
    a = ';'.join(str(c.get('name')) + '|' + str(c.get('n1')) + '|' + str(c.get('n2')) + '|' + (str(c.get('cell') or '').split() or [''])[0] for c in net.get('components', []))
    b = ','.join(str(n.get('id')) + ':' + ('T' if n.get('tap') else '') + _js_str(n.get('z') or 0) for n in net.get('nodes', []))
    return a + '#' + b


def _js_str(v):
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def solve_hydraulic(net, par, opt=None):
    opt = opt or {}
    nodes = [n for n in net.get('nodes', []) if (n.get('domain') or 'hyd') == 'hyd']
    node_by_id = {n['id']: n for n in nodes}
    internal = [n for n in nodes if not n.get('tap')]
    idx = {n['id']: i for i, n in enumerate(internal)}
    N = len(internal)
    rho, mu, g, lam = par['rho'], par['mu'], par['g'], par['lambdaU']
    state = opt.get('state')
    if state and state.get('comps') is not None and state.get('sig') == sig_of(net):
        comps = state['comps']
        for c in comps:
            src = next(x for x in net['components'] if x.get('name') == c.srcName)
            f = parse_hyd_component(src, par)
            for k in ('Qsc', 'Dpoc', 'Diam', 'PipeLen', 'Zeta', 'Kv', 'Area', 'Kd', 'EtaV', 'EtaHm', 'DispRatio', 'Pset', 'Qmax', 'heatTo'):
                v = getattr(f, k, None)
                if v is not None:
                    setattr(c, k, v)
            if c.kind in ('RL', 'UPR', 'UCV', 'U', 'UCP'):
                c.Rd = f.Rd
            if c.kind == 'UPT' and not c.isPtuPump:
                c.Rd0 = f.Rd0
            if c.kind == 'UPM' and state.get('upmQ') and c.name in state['upmQ']:
                c.Qsc = state['upmQ'][c.name]
    else:
        comps = []
        for src in net['components']:
            c = parse_hyd_component(src, par)
            c.srcName = src.get('name')
            comps.append(c)
    for c in comps:
        for side in ('n1', 'n2'):
            if getattr(c, side) not in node_by_id:
                raise ValueError('Component ' + c.name + ' refers to unknown node "' + str(getattr(c, side)) + '".')
        c.i1 = idx.get(c.n1, -1)
        c.i2 = idx.get(c.n2, -1)
        c.Z1 = num(node_by_id[c.n1].get('z')) or 0.0
        c.Z2 = num(node_by_id[c.n2].get('z')) or 0.0
        if c.Z1 != c.Z1:
            c.Z1 = 0.0
        if c.Z2 != c.Z2:
            c.Z2 = 0.0
    ptu = {}
    for c in comps:
        if c.kind == 'UPT':
            suf = c.name[3:]
            nr = suf[:-1]
            side = suf[-1:].lower()
            ptu.setdefault(nr, {})[side] = c
    for nr, sides in ptu.items():
        if 'a' in sides and 'b' in sides:
            sides['a'].partner = sides['b']
            sides['b'].partner = sides['a']
    if N == 0:
        raise ValueError('No internal hydraulic node.')
    X = [0.0] * N

    def tap_z(c, side):
        if side == 2:
            return c.Z2 if c.Z2 > 0 else c.Z1
        return c.Z1 if c.Z1 > 0 else c.Z2

    def is_res(k):
        return k != 'UPM' and (k[0] == 'R' or k[0] == 'U')

    def is_src(k):
        return k == 'P' or k == 'UPM' or k[0] == 'U'

    log10 = math.log10

    def resistance(c, it):
        if c.kind == 'UCV':
            if it > 1 and (c.Ptot1 - c.Ptot2) <= c.Dpoc:
                c.Fwd = False
        elif c.kind == 'RZ':
            c.Rd = rho / 2 * c.U / c.Area * c.Zeta
        elif c.kind == 'RK':
            c.Rd = c.U * PA * SH * SH * c.Area / (c.Kv * c.Kv)
        elif c.kind == 'R':
            Rlam = 128 / math.pi * c.PipeLen / (c.Diam ** 4) * mu
            Re = c.U * c.Diam * rho / mu
            lamb = 0.0
            if c.U > 0:
                if par.get('zanke'):
                    ReL = 1 if Re <= 1 else Re
                    lamb = (-2 * log10(2.7 * (log10(ReL) ** 1.2) / Re + c.Kd / 3.71)) ** -2
                else:
                    lamb = 0.25 / (log10(c.Kd / 3.7 + 5.74 / (Re ** 0.9)) ** 2)
            Rturb = rho / 2 * c.U / c.Area * lamb * c.PipeLen / c.Diam
            lo = par['ReDcrit'] * (1 - par['kReD'])
            hi = par['ReDcrit'] * (1 + par['kReD'])
            if lo < Re < hi:
                wf = (Re - lo) / (hi - lo)
                w = 0.5 * (math.sin((wf - 0.5) * math.pi) + 1)
                c.Rd = (1 - w) * Rlam + w * Rturb
            elif Re >= hi:
                c.Rd = Rturb
            else:
                c.Rd = Rlam

    it = 0
    dUres = 1.0
    max_it = num(par.get('niter', _MISSING))
    max_it = int(max_it) if (max_it == max_it and max_it != 0) else 999
    tolP = 1e-6
    while True:
        it += 1
        for c in comps:
            if c.kind == 'UPT' and c.isPtuPump and c.partner is not None:
                m = c.partner
                if par.get('ptuOff'):
                    c.Qsc = 0.0
                    m.Rd = 1e15
                    continue
                Qa = abs(m.q)
                c.Qsc = Qa * c.DispRatio * m.EtaV * c.EtaV
                if it <= 1 or Qa < 1e-12:
                    continue
                Qb = abs(c.q)
                DPb = abs(c.Ptot1 - c.Ptot2)
                eta = m.EtaV * m.EtaHm * c.EtaV * c.EtaHm
                Rn = m.Rd0 + DPb * Qb / (eta * Qa * Qa)
                if abs(Rn - m.Rd) < tolP * m.Rd:
                    continue
                m.Rd = 0.1 * Rn + 0.9 * m.Rd
        if it > 1:
            for c in comps:
                if c.kind != 'UPM':
                    continue
                if c.i2 >= 0:
                    Pist = X[c.i2]
                elif c.i1 >= 0:
                    Pist = X[c.i1]
                else:
                    continue
                if abs(Pist - c.Pset) < tolP * c.Pset:
                    continue
                Qn = c.Qsc * (c.Pset / Pist) if Pist > 0 else c.Qmax
                Qn = max(0.0, min(Qn, c.Qmax))
                c.Qsc = 0.3 * Qn + 0.7 * c.Qsc
        A = [[0.0] * N for _ in range(N)]
        b = [0.0] * N
        for c in comps:
            c.Fwd = True
            if is_res(c.kind):
                resistance(c, it)
            if not c.Fwd:
                continue
            if is_res(c.kind) and not (c.kind == 'UPT' and c.isPtuPump):
                gc = 1 / (c.Rd / PA / SH)
                if c.i1 >= 0:
                    A[c.i1][c.i1] += gc
                if c.i2 >= 0:
                    A[c.i2][c.i2] += gc
                if c.i1 >= 0 and c.i2 >= 0:
                    A[c.i1][c.i2] -= gc
                    A[c.i2][c.i1] -= gc
                if c.i1 >= 0 and c.i2 < 0:
                    z = tap_z(c, 2)
                    head = rho * g * z if (c.q < 0 or c.kind == 'RK') else rho * g * z + 0.5 * rho * c.U * c.U
                    b[c.i1] += head / (c.Rd / PA / SH) / PA
                if c.i2 >= 0 and c.i1 < 0:
                    z = tap_z(c, 1)
                    head = rho * g * z if (c.q > 0 or c.kind == 'RK') else rho * g * z + 0.5 * rho * c.U * c.U
                    b[c.i2] += head / (c.Rd / PA / SH) / PA
            if is_src(c.kind):
                if c.i1 >= 0:
                    b[c.i1] -= c.Qsc * SH
                if c.i2 >= 0:
                    b[c.i2] += c.Qsc * SH
        xb = gauss(A, b)
        if xb is None:
            raise ValueError('Hydraulic coefficient matrix is singular – check that every node is connected and that the network has a tap/reservoir.')
        for i in range(N):
            X[i] = xb[i] * PA
        dUsum = 0.0
        for c in comps:
            if c.kind in ('P', 'UPM') or (c.kind == 'UPT' and c.isPtuPump):
                c.q = c.Qsc
            elif c.i2 < 0 and c.i1 >= 0:
                z = tap_z(c, 2)
                numr = c.Rd * c.Qsc + X[c.i1] - rho * g * z
                c.q = numr / c.Rd if (c.q < 0 or c.kind == 'RK') else numr / (0.5 * rho * c.U / c.Area + c.Rd)
            elif c.i1 < 0 and c.i2 >= 0:
                z = tap_z(c, 1)
                numr = c.Rd * c.Qsc + rho * g * z - X[c.i2]
                c.q = numr / c.Rd if (c.q > 0 or c.kind == 'RK') else numr / (0.5 * rho * c.U / c.Area + c.Rd)
            elif c.i1 >= 0 and c.i2 >= 0:
                c.q = c.Qsc + (X[c.i1] - X[c.i2]) / c.Rd
            if c.kind[0] == 'U' and not c.Fwd:
                c.q = 0.0
            prev = c.U
            c.U = abs(c.q / c.Area) if c.Area != 0 else 0.0
            c.U = abs(lam * c.U + (1 - lam) * prev)
            dUsum += abs(c.U - prev)
            if c.i2 < 0 and c.i1 >= 0:
                z = tap_z(c, 2)
                c.Ptot2 = rho * g * z if (c.q < 0 or c.kind == 'RK') else rho * g * z + 0.5 * rho * c.U * c.U
                c.Ptot1 = X[c.i1]
            elif c.i1 < 0 and c.i2 >= 0:
                z = tap_z(c, 1)
                c.Ptot1 = rho * g * z if (c.q > 0 or c.kind == 'RK') else rho * g * z + 0.5 * rho * c.U * c.U
                c.Ptot2 = X[c.i2]
            elif c.i1 >= 0 and c.i2 >= 0:
                c.Ptot1 = X[c.i1]
                c.Ptot2 = X[c.i2]
        dUres = dUsum / len(comps) if comps else 0.0
        if dUres <= par['dUcrit'] or it >= max_it:
            break
    res_c = {}
    for c in comps:
        dp = c.Ptot1 - c.Ptot2
        res_c[c.name] = {
            'kind': c.kind, 'n1': c.n1, 'n2': c.n2,
            'q': c.q * SH, 'dp': dp / PA, 'u': 0.0 if c.kind == 'RK' else c.U,
            're': 0.0 if c.kind == 'RK' else c.U * c.Diam * rho / mu,
            'qdyn': 0.0 if c.kind == 'RK' else 0.5 * rho * c.U * c.U / PA,
            'pow': dp * c.q / 1000, 'open': c.Fwd, 'heatTo': c.heatTo or ''
        }
    res_n = {}
    for i, n in enumerate(internal):
        res_n[n['id']] = X[i] / PA
    for n in nodes:
        if n.get('tap'):
            zz = num(n.get('z'))
            res_n[n['id']] = rho * g * (zz if zz == zz else 0.0) / PA
    upmQ = {c.name: c.Qsc for c in comps if c.kind == 'UPM'}
    return {'iterations': it, 'residual': dUres, 'converged': dUres <= par['dUcrit'], 'components': res_c, 'nodes': res_n,
            'state': {'comps': comps, 'sig': sig_of(net), 'upmQ': upmQ}}


def solve_hydraulic_with_ptu_logic(net, par, opt=None):
    ptu_cfg = net.get('ptu') or {}
    on = bool(net.get('ptu')) and ptu_cfg.get('logic') is not False
    thr_raw = num(ptu_cfg.get('thresholdPsi', _MISSING)) if net.get('ptu') else float('nan')
    thr = thr_raw if math.isfinite(thr_raw) else 500.0
    base = solve_hydraulic(net, dict(par, ptuOff=False), opt)
    pairs = []
    keys = list(base['components'].keys())
    for k in keys:
        c = base['components'][k]
        if c['kind'] == 'UPT' and k[-1:].lower() == 'b':
            a = k[:-1] + 'a'
            A = next((x for x in keys if x.lower() == a.lower()), None)
            if A:
                pairs.append((A, k))
    info = {'enabled': on, 'present': len(pairs) > 0, 'active': len(pairs) > 0, 'dpOffPsi': None, 'thresholdPsi': thr}
    if not on or not pairs:
        base['ptu'] = info
        return base
    off = solve_hydraulic(net, dict(par, ptuOff=True))
    off_comps = {c.name: c for c in off['state']['comps']}
    dp = float('inf')
    for a, b in pairs:
        ca, cb = off_comps[a], off_comps[b]
        dp = min(dp, max(ca.Ptot1, ca.Ptot2) - max(cb.Ptot1, cb.Ptot2))
    info['dpOffPsi'] = dp / PA * 14.5037738
    info['active'] = info['dpOffPsi'] >= thr
    r = base if info['active'] else off
    r['ptu'] = info
    return r


def linear_network(domain, nodes, elems):
    free = [n for n in nodes if not is_num(n.get('fixed'))]
    idx = {n['id']: i for i, n in enumerate(free)}
    fixed_val = {n['id']: n['fixed'] for n in nodes if is_num(n.get('fixed'))}
    N = len(free)
    A = [[0.0] * N for _ in range(N)]
    b = [0.0] * N

    def pot(i):
        return fixed_val.get(i)

    def stamp_g(a, c, gval):
        ia = idx.get(a, -1)
        ic = idx.get(c, -1)
        if ia >= 0:
            A[ia][ia] += gval
        if ic >= 0:
            A[ic][ic] += gval
        if ia >= 0 and ic >= 0:
            A[ia][ic] -= gval
            A[ic][ia] -= gval
        if ia >= 0 and ic < 0 and pot(c) is not None:
            b[ia] += gval * pot(c)
        if ic >= 0 and ia < 0 and pot(a) is not None:
            b[ic] += gval * pot(a)

    def inject(i, val):
        if i in idx:
            b[idx[i]] += val

    for e in elems:
        e(stamp_g, inject)
    for n in free:
        if n.get('cdt'):
            i = idx[n['id']]
            A[i][i] += n['cdt']
            b[i] += n['cdt'] * n['prev']
    for i in range(N):
        if A[i][i] == 0:
            A[i][i] = 1e-12
    x = gauss(A, b) if N else []
    if x is None:
        raise ValueError('The ' + domain + ' network matrix is singular – every node needs a path to a fixed node.')
    out = {}
    for n in nodes:
        out[n['id']] = fixed_val[n['id']] if n['id'] in fixed_val else x[idx[n['id']]]
    return out


def apply_events(model, t):
    m = copy.deepcopy(model)
    ev = [e for e in (model.get('events') or []) if e and e.get('comp') and e.get('field')]
    for c in m['components']:
        for e in [e for e in ev if e['comp'] == c.get('name')]:
            if num(e.get('t')) <= t + 1e-12:
                raw = e.get('value')
                nv = num(raw)
                val = raw if nv != nv else nv
                if e['field'] == 'cell':
                    c['cell'] = str(raw)
                else:
                    c[e['field']] = val
    return m


def fluid_at(model, Tf):
    f = model.get('fluid') or {'model': 'skydrol', 'T': -40}
    if f.get('model') == 'custom':
        return {'rho': num(f.get('rho', _MISSING)), 'mu': num(f.get('mu', _MISSING)), 'cp': or_default(f.get('cp', _MISSING), 2000)}
    F = FLUIDS.get(f.get('model'), FLUIDS['skydrol'])
    return {'rho': F.rho(Tf), 'mu': F.mu(Tf), 'cp': F.cp(Tf)}


def _p(par, key, default):
    v = par.get(key, _MISSING)
    return num(default if v is _MISSING else v)


def solve_coupled(model, t, dt, state, opts=None):
    opts = opts or {}
    m = apply_events(model, t)
    hyd_nodes = [n for n in m['nodes'] if n.get('domain') == 'hyd']
    th_nodes = [n for n in m['nodes'] if n.get('domain') == 'th']
    el_nodes = [n for n in m['nodes'] if n.get('domain') == 'el']
    off_pumps = {c.get('pump') for c in m['components'] if c.get('domain') == 'el' and c.get('type') == 'MOTORPUMP' and is_off(c.get('on'))}
    hyd_comps = []
    for c in m['components']:
        if c.get('domain') != 'hyd':
            continue
        if c.get('name') in off_pumps:
            tk = str(c.get('cell')).strip().split()
            k = hyd_kind(tk[0]) if tk else None
            if k == 'P' and len(tk) > 1:
                tk[1] = '0'
            elif k == 'UPM' and len(tk) > 2:
                tk[2] = '0'
            c = dict(c, cell=' '.join(tk))
        hyd_comps.append(c)
    th_comps = [c for c in m['components'] if c.get('domain') == 'th']
    el_comps = [c for c in m['components'] if c.get('domain') == 'el']
    fl = m.get('fluid') or {'model': 'skydrol', 'T': -40}
    transient = dt > 0
    T = dict(state.get('T') or {})
    for n in th_nodes:
        if n['id'] not in T:
            if is_num(n.get('fixed')):
                T[n['id']] = n['fixed']
            else:
                t0 = num(n.get('T0', _MISSING))
                T[n['id']] = t0 if math.isfinite(t0) else 20
    soc = dict(state.get('soc') or {})
    for c in el_comps:
        if c.get('type') == 'BAT' and c['name'] not in soc:
            soc[c['name']] = num(c['soc0'] if 'soc0' in c else 1)
    V = dict(state.get('V') or {})
    hyd = el = th = None
    temp_node = fl.get('tempNode')
    Tfluid = T[temp_node] if (temp_node and temp_node in T) else num(fl.get('T', _MISSING))
    couple_err = 0.0
    max_couple = opts.get('maxCouple') or 60
    hyd_state = state.get('hydState')
    couple_it = 0
    for couple_it in range(1, max_couple + 1):
        props = fluid_at(m, Tfluid)
        if hyd_nodes and hyd_comps:
            hp = m.get('hydParams') or {}
            g_raw = num(hp.get('g', _MISSING))
            par = dict(hp)
            par.update({'rho': props['rho'], 'mu': props['mu'], 'g': g_raw if (g_raw == g_raw and g_raw != 0) else 9.80665})
            par['krough'] = _p(hp, 'krough', 0.0015)
            par['dUcrit'] = _p(hp, 'dUcrit', 1e-7)
            par['niter'] = _p(hp, 'niter', 999)
            par['lambdaU'] = _p(hp, 'lambdaU', 0.6)
            par['kReD'] = _p(hp, 'kReD', 0.2)
            par['ReDcrit'] = _p(hp, 'ReDcrit', 2320)
            par['zanke'] = bool(hp.get('zanke'))
            hnet = {'nodes': hyd_nodes, 'components': [{'name': c.get('name'), 'cell': c.get('cell'), 'n1': c.get('n1'), 'n2': c.get('n2'), 'heatTo': c.get('heatTo')} for c in hyd_comps], 'ptu': m.get('ptu')}
            hyd = solve_hydraulic_with_ptu_logic(hnet, par, {'state': hyd_state if opts.get('warm') else None})
            hyd['props'] = props
            hyd_state = hyd['state']

        def hyd_pow(name):
            if hyd and name in hyd['components']:
                return abs(hyd['components'][name]['pow']) * 1000
            return 0.0

        Vit = dict(V)
        for n in el_nodes:
            if n['id'] not in Vit:
                if is_num(n.get('fixed')):
                    Vit[n['id']] = n['fixed']
                else:
                    v0 = num(n.get('V0', _MISSING))
                    Vit[n['id']] = v0 if (v0 == v0 and v0 != 0) else 0

        def bat_ocv(c):
            s = max(0.0, min(1.0, soc[c['name']]))
            return num(c.get('vmin', _MISSING)) + (num(c.get('vmax', _MISSING)) - num(c.get('vmin', _MISSING))) * s

        def load_power(c):
            if c.get('type') == 'MOTORPUMP':
                eta = or_default(c.get('eta', _MISSING), 1)
                return 0.0 if is_off(c.get('on')) else hyd_pow(c.get('pump')) / eta
            if c.get('type') == 'LOAD':
                if is_off(c.get('on')):
                    return 0.0
                p = num(c.get('P', _MISSING))
                return p if (p == p) else 0.0
            return 0.0

        if el_nodes and el_comps:
            el_it = 0
            for el_it in range(1, 201):
                def make(c, Vs):
                    def stamp(G, J):
                        v1 = Vs.get(c['n1']) or 0
                        v2 = Vs.get(c['n2']) or 0
                        typ = c.get('type')
                        if typ == 'R':
                            G(c['n1'], c['n2'], 1 / num(c.get('R', _MISSING)))
                        elif typ == 'SW':
                            G(c['n1'], c['n2'], 1e-9 if is_off(c.get('on')) else 1 / or_default(c.get('Ron', _MISSING), 1e-4))
                        elif typ in ('V', 'BAT'):
                            E = num(c.get('E', _MISSING)) if typ == 'V' else bat_ocv(c)
                            r = or_default(c.get('Rint', _MISSING), 1e-3)
                            G(c['n1'], c['n2'], 1 / r)
                            J(c['n2'], E / r)
                            J(c['n1'], -E / r)
                        elif typ == 'I':
                            J(c['n2'], num(c.get('I', _MISSING)))
                            J(c['n1'], -num(c.get('I', _MISSING)))
                        elif typ in ('LOAD', 'MOTORPUMP'):
                            P = load_power(c)
                            v = v1 - v2
                            if P > 0:
                                vv = v if abs(v) > 1e-6 else or_default(c.get('Vnom', _MISSING), 28)
                                G(c['n1'], c['n2'], P / (vv * vv))
                            else:
                                G(c['n1'], c['n2'], 1e-12)
                    return stamp
                elems = [make(c, Vit) for c in el_comps]
                res = linear_network('electrical', el_nodes, elems)
                d = 0.0
                for k in res:
                    d = max(d, abs(res[k] - (Vit.get(k) or 0)))
                Vit = res
                if d < 1e-9:
                    break
            comps = {}
            for c in el_comps:
                v = (Vit.get(c['n1']) or 0) - (Vit.get(c['n2']) or 0)
                i = p = heat = 0.0
                typ = c.get('type')
                if typ == 'R':
                    i = v / num(c.get('R', _MISSING)); p = v * i; heat = p
                elif typ == 'SW':
                    gsw = 1e-9 if is_off(c.get('on')) else 1 / or_default(c.get('Ron', _MISSING), 1e-4)
                    i = v * gsw; p = v * i; heat = p
                elif typ in ('V', 'BAT'):
                    E = num(c.get('E', _MISSING)) if typ == 'V' else bat_ocv(c)
                    r = or_default(c.get('Rint', _MISSING), 1e-3)
                    vt = (Vit.get(c['n2']) or 0) - (Vit.get(c['n1']) or 0)
                    i = (E - vt) / r; p = vt * i; heat = i * i * r
                elif typ == 'I':
                    i = num(c.get('I', _MISSING)); p = -v * i
                elif typ in ('LOAD', 'MOTORPUMP'):
                    P = load_power(c)
                    i = P / v if abs(v) > 1e-9 else 0.0
                    p = P
                    eta = or_default(c.get('eta', _MISSING), 1)
                    heat = P * (1 - eta) if typ == 'MOTORPUMP' else P * (1 - or_default(c.get('eff', _MISSING), 0))
                entry = {'type': typ, 'n1': c['n1'], 'n2': c['n2'], 'v': v, 'i': i, 'p': p, 'heat': heat, 'heatTo': c.get('heatTo') or ''}
                if typ == 'BAT':
                    entry['soc'] = soc[c['name']]
                comps[c['name']] = entry
            el = {'nodes': Vit, 'components': comps, 'iterations': el_it}
        heat_in = {}

        def add_heat(node, w):
            if node:
                heat_in[node] = heat_in.get(node, 0) + w

        if hyd:
            for c in hyd_comps:
                if c.get('heatTo'):
                    r = hyd['components'].get(c.get('name'))
                    if r and r['kind'][0] == 'R':
                        add_heat(c['heatTo'], max(0.0, r['pow'] * 1000))
                    elif r and r['kind'][0] == 'U' and r['kind'] != 'UPM' and r['kind'] != 'UPT':
                        add_heat(c['heatTo'], max(0.0, r['pow'] * 1000))
        if el:
            for c in el_comps:
                if c.get('heatTo') and c['name'] in el['components']:
                    add_heat(c['heatTo'], max(0.0, el['components'][c['name']]['heat']))
        if th_nodes:
            nodes_th = []
            for n in th_nodes:
                o = {'id': n['id'], 'fixed': n['fixed'] if is_num(n.get('fixed')) else float('nan')}
                Cv = num(n.get('C', _MISSING))
                if transient and Cv > 0 and not is_num(n.get('fixed')):
                    o['cdt'] = Cv / dt
                    prevT = state.get('T') or {}
                    o['prev'] = prevT[n['id']] if n['id'] in prevT else T[n['id']]
                nodes_th.append(o)

            def make_th(c):
                def stamp(G, J):
                    typ = c.get('type')
                    if typ == 'G':
                        G(c['n1'], c.get('n2'), num(c.get('G', _MISSING)))
                    elif typ == 'Q':
                        J(c['n1'], 0.0 if is_off(c.get('on')) else num(c.get('P', _MISSING)))
                    elif typ == 'HX':
                        mdot = num(c.get('mdot', _MISSING))
                        cp = or_default(c.get('cp', _MISSING), 4186)
                        eps = num(c.get('eff', _MISSING))
                        G(c['n1'], c.get('n2'), eps * mdot * cp)
                return stamp

            elems = [make_th(c) for c in th_comps]

            def heat_stamp(G, J):
                for k2 in heat_in:
                    J(k2, heat_in[k2])
            elems.append(heat_stamp)
            Tn = linear_network('thermal', nodes_th, elems)
            couple_err = 0.0
            for k2 in Tn:
                couple_err = max(couple_err, abs(Tn[k2] - T[k2]))
            T = Tn
            flows = {}
            for c in th_comps:
                typ = c.get('type')
                if typ in ('G', 'HX'):
                    gg = num(c.get('G', _MISSING)) if typ == 'G' else num(c.get('eff', _MISSING)) * num(c.get('mdot', _MISSING)) * or_default(c.get('cp', _MISSING), 4186)
                    flows[c['name']] = {'type': typ, 'n1': c['n1'], 'n2': c.get('n2'), 'q': gg * ((T.get(c['n1']) or 0) - (T.get(c.get('n2')) or 0))}
                elif typ == 'Q':
                    flows[c['name']] = {'type': 'Q', 'n1': c['n1'], 'q': 0.0 if is_off(c.get('on')) else num(c.get('P', _MISSING))}
            th = {'nodes': T, 'components': flows, 'heatIn': heat_in}
        Tnew = T[temp_node] if (temp_node and temp_node in T) else num(fl.get('T', _MISSING))
        dTf = abs(Tnew - Tfluid)
        Tfluid = Tnew
        V = el['nodes'] if el else V
        need_iter = bool(temp_node and hyd_comps) or any(c.get('type') == 'MOTORPUMP' for c in el_comps)
        if not need_iter:
            break
        if couple_it > 1 and dTf < 1e-7 and couple_err < 1e-7:
            break
    if transient and el:
        for c in el_comps:
            if c.get('type') == 'BAT':
                i = el['components'][c['name']]['i']
                soc[c['name']] = soc[c['name']] - i * dt / (3600 * num(c.get('capacityAh', _MISSING)))
    return {'t': t, 'hyd': hyd, 'el': el, 'th': th, 'T': T, 'V': V, 'soc': soc, 'Tfluid': Tfluid, 'coupleIt': couple_it, 'hydState': hyd_state}


def validate_model(model):
    errs = []
    ids = set()
    for n in model.get('nodes') or []:
        if not n.get('id'):
            errs.append('A node has no id.')
        if n.get('id') in ids:
            errs.append('Duplicate node id "' + str(n.get('id')) + '".')
        ids.add(n.get('id'))
        if n.get('domain') not in ('hyd', 'th', 'el'):
            errs.append('Node "' + str(n.get('id')) + '" has an unknown domain.')
    names = set()
    for c in model.get('components') or []:
        if not c.get('name'):
            errs.append('A component has no name.')
        if c.get('name') in names:
            errs.append('Duplicate component name "' + str(c.get('name')) + '".')
        names.add(c.get('name'))
        nodes_of = [c.get('n1')] if (c.get('domain') == 'th' and c.get('type') == 'Q') else [c.get('n1'), c.get('n2')]
        for nid in nodes_of:
            if nid not in ids:
                errs.append('Component "' + str(c.get('name')) + '" refers to unknown node "' + str(nid) + '".')
        dn = [n.get('domain') for n in (model.get('nodes') or []) if n.get('id') in nodes_of]
        if any(d != c.get('domain') for d in dn):
            errs.append('Component "' + str(c.get('name')) + '" connects nodes of another domain.')
        if c.get('heatTo') and not any(n.get('id') == c['heatTo'] and n.get('domain') == 'th' for n in (model.get('nodes') or [])):
            errs.append('Component "' + str(c.get('name')) + '": heatTo "' + str(c['heatTo']) + '" is not a thermal node.')
        if c.get('type') == 'MOTORPUMP' and not any(x.get('name') == c.get('pump') and x.get('domain') == 'hyd' for x in (model.get('components') or [])):
            errs.append('Motor-pump "' + str(c.get('name')) + '" refers to unknown hydraulic pump "' + str(c.get('pump')) + '".')
    f = model.get('fluid') or {}
    if f.get('tempNode') and not any(n.get('id') == f['tempNode'] and n.get('domain') == 'th' for n in (model.get('nodes') or [])):
        errs.append('Fluid temperature node "' + str(f['tempNode']) + '" is not a thermal node.')
    return errs


def simulate(model, on_step=None):
    errs = validate_model(model)
    if errs:
        raise ValueError('\n'.join(errs))
    sim = model.get('sim') or {}
    if sim.get('mode') != 'transient':
        r = solve_coupled(model, 0, 0, {}, {'warm': False})
        return {'mode': 'steady', 'steps': [r], 'final': r}
    dt = or_default(sim.get('dt', _MISSING), 1)
    t_end = or_default(sim.get('tEnd', _MISSING), 60)
    n_steps = int(math.floor(t_end / dt + 0.5))
    if n_steps > 20000:
        raise ValueError('Too many time steps (max. 20000).')
    init = solve_coupled(model, 0, 0, {}, {'warm': False})
    state = {'T': init['T'], 'V': init['V'], 'soc': init['soc'], 'hydState': init['hydState']}
    if sim.get('startSteady') is not True:
        T0 = {}
        for n in model['nodes']:
            if n.get('domain') == 'th':
                if is_num(n.get('fixed')):
                    T0[n['id']] = n['fixed']
                else:
                    t0 = num(n.get('T0', _MISSING))
                    T0[n['id']] = t0 if math.isfinite(t0) else 20
        state['T'] = T0
    first = dict(init)
    first['t'] = 0
    first['T'] = state['T']
    steps = [first]
    for k in range(1, n_steps + 1):
        t = k * dt
        r = solve_coupled(model, t, dt, state, {'warm': True})
        state = {'T': r['T'], 'V': r['V'], 'soc': r['soc'], 'hydState': r['hydState']}
        steps.append(r)
        if on_step and k % 25 == 0:
            on_step(k / n_steps)
    return {'mode': 'transient', 'steps': steps, 'final': steps[-1], 'dt': dt, 'tEnd': t_end}


def _clean(o):
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items() if k not in ('state', 'hydState')}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, float) and not math.isfinite(o):
        return None
    return o


def to_jsonable(result):
    return _clean(result)


def simulate_json(model_json):
    model = json.loads(model_json) if isinstance(model_json, str) else model_json
    try:
        return json.dumps({'ok': True, 'result': to_jsonable(simulate(model))})
    except Exception as e:
        return json.dumps({'ok': False, 'error': str(e)})
