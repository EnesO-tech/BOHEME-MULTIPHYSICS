import argparse
import csv
import json
import os
import sys
import time

from . import __version__
from .solver import simulate, to_jsonable
from . import validation

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def _load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _signals(step):
    sig = []
    if step.get('hyd'):
        for k in step['hyd']['nodes']:
            sig.append(('p ' + k + ' [bar]', lambda s, k=k: s['hyd']['nodes'].get(k) if s.get('hyd') else None))
        for k in step['hyd']['components']:
            sig.append(('Q ' + k + ' [m3/h]', lambda s, k=k: s['hyd']['components'][k]['q'] if s.get('hyd') and k in s['hyd']['components'] else None))
    for k in (step.get('T') or {}):
        sig.append(('T ' + k + ' [degC]', lambda s, k=k: (s.get('T') or {}).get(k)))
    if step.get('el'):
        for k in step['el']['nodes']:
            sig.append(('V ' + k + ' [V]', lambda s, k=k: s['el']['nodes'].get(k) if s.get('el') else None))
        for k in step['el']['components']:
            sig.append(('P ' + k + ' [W]', lambda s, k=k: s['el']['components'][k]['p'] if s.get('el') and k in s['el']['components'] else None))
    for k in (step.get('soc') or {}):
        sig.append(('SOC ' + k + ' [-]', lambda s, k=k: (s.get('soc') or {}).get(k)))
    return sig


def cmd_run(a):
    model = _load(a.model)
    t0 = time.perf_counter()
    res = simulate(model)
    ms = (time.perf_counter() - t0) * 1000
    f = res['final']
    print('%s · %s · %.0f ms' % (model.get('title', a.model), res['mode'], ms))
    if f.get('hyd'):
        h = f['hyd']
        print('  hydraulics: %s, %d iterations, residual %.2e' % ('converged' if h['converged'] else 'NOT converged', h['iterations'], h['residual']))
        if h.get('ptu') and h['ptu'].get('present'):
            p = h['ptu']
            print('  PTU: %s' % (('active' if p['active'] else 'inactive') + (' (dp without PTU %.0f psi)' % p['dpOffPsi'] if p.get('dpOffPsi') is not None else '')))
        for k, v in list(h['nodes'].items())[: a.show]:
            print('    p %-6s %12.4f bar' % (k, v))
    for k, v in list((f.get('T') or {}).items())[: a.show]:
        print('    T %-6s %12.3f degC' % (k, v))
    if f.get('el'):
        for k, v in list(f['el']['nodes'].items())[: a.show]:
            print('    V %-6s %12.3f V' % (k, v))
    for k, v in (f.get('soc') or {}).items():
        print('    SOC %-4s %10.2f %%' % (k, v * 100))
    if a.out:
        with open(a.out, 'w', encoding='utf-8') as fo:
            json.dump(to_jsonable(res), fo, indent=1)
        print('results written to', a.out)
    if a.csv:
        sig = _signals(res['final'])
        with open(a.csv, 'w', newline='', encoding='utf-8') as fo:
            w = csv.writer(fo)
            w.writerow(['t [s]'] + [s[0] for s in sig])
            for st in res['steps']:
                row = [st['t']]
                for _, g in sig:
                    try:
                        v = g(st)
                    except Exception:
                        v = None
                    row.append('' if v is None else v)
                w.writerow(row)
        print('time series written to', a.csv)
    if a.plot:
        try:
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
        except ImportError:
            print('matplotlib is not installed: pip install matplotlib')
            return 1
        sig = [s for s in _signals(res['final']) if any(x in s[0] for x in a.signals.split(','))] if a.signals else _signals(res['final'])[:6]
        ts = [st['t'] for st in res['steps']]
        fig, ax = plt.subplots(figsize=(10, 5))
        for name, g in sig:
            ys = []
            for st in res['steps']:
                try:
                    ys.append(g(st))
                except Exception:
                    ys.append(None)
            ax.plot(ts, [float('nan') if y is None else y for y in ys], label=name)
        ax.set_xlabel('time [s]')
        ax.grid(alpha=0.3)
        ax.legend(fontsize=8)
        ax.set_title(model.get('title', ''))
        fig.tight_layout()
        fig.savefig(a.plot, dpi=150)
        print('plot written to', a.plot)
    return 0


def cmd_validate(a):
    fx_dir = os.path.join(ROOT, 'tests', 'fixtures')
    fixtures = {'excel': _load(os.path.join(fx_dir, 'excel_reference.json')), 'a320': _load(os.path.join(fx_dir, 'a320_green.json'))}
    t0 = time.perf_counter()
    res = validation.run(fixtures)
    group = ''
    fail = 0
    for r in res:
        if r['group'] != group:
            group = r['group']
            print('\n' + group)
        print(('  PASS  ' if r['ok'] else '  FAIL  ') + r['name'] + '  [' + r['detail'] + ']')
        fail += 0 if r['ok'] else 1
    print('\n%d/%d checks passed in %.2f s (Python engine)' % (len(res) - fail, len(res), time.perf_counter() - t0))
    return 1 if fail else 0


def cmd_serve(a):
    try:
        import uvicorn
        from .server import app
    except ImportError:
        print('The server needs extra packages: pip install fastapi uvicorn')
        return 1
    uvicorn.run(app, host=a.host, port=a.port)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog='boheme_mp', description='BOHEME Multiphysics – hydraulic, thermal and electrical network solver (Python engine %s)' % __version__)
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('run', help='simulate a project file')
    r.add_argument('model')
    r.add_argument('--out', help='write full results as JSON')
    r.add_argument('--csv', help='write the time series as CSV')
    r.add_argument('--plot', help='write a PNG plot (needs matplotlib)')
    r.add_argument('--signals', help='comma-separated filter for the plot, e.g. "T TOIL,SOC"')
    r.add_argument('--show', type=int, default=8, help='number of node values to print per domain')
    r.set_defaults(fn=cmd_run)
    v = sub.add_parser('validate', help='run the validation suite')
    v.set_defaults(fn=cmd_validate)
    s = sub.add_parser('serve', help='start the HTTP API (needs fastapi and uvicorn)')
    s.add_argument('--host', default='127.0.0.1')
    s.add_argument('--port', type=int, default=8000)
    s.set_defaults(fn=cmd_serve)
    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == '__main__':
    sys.exit(main())
