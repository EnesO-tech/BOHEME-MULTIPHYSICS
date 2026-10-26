# BOHEME Multiphysics

Browser tool for **hydraulic, thermal and electrical networks** of aircraft systems – steady state and transient, fully coupled.

- **Hydraulics:** pipes (laminar/turbulent), local losses, valves, pumps, pressure-regulated pump, relief/check valve, power transfer unit (PTU) with activation logic, reservoirs with elevation.
- **Thermal:** conductances, heat sources, heat exchangers, thermal capacities.
- **Electrical:** resistors, sources, batteries with state of charge, constant-power loads, switches, motor-pumps.
- **Coupling:** hydraulic and electrical losses heat thermal nodes, the fluid temperature drives viscosity and density, motor-pumps draw the hydraulic power from the electrical network.
- **Transient:** implicit Euler for thermal capacities and battery charge, quasi-steady hydraulics, time-based events.

## Validation

The hydraulic solver is an exact port of the BOHEME solver and reproduces the Excel/VBA reference tool *hydraulic_networks v1.4*:

| Check | Result |
|---|---|
| Excel reference: 51 components × 6 quantities | rel. deviation < 1e-6 |
| Excel reference: 38 node pressures | < 1e-4 bar (Excel output rounded) |
| A320 Green model vs. BOHEME | < 1e-8 bar, identical iteration count |
| Analytic: Hagen–Poiseuille, k_V valve, Kirchhoff, Fourier, RC transient, constant-power load, Coulomb counting | exact or converging with dt |
| Coupling: Joule heating, hydraulic loss heating, viscosity feedback, motor-pump power | energy balances closed |

Run the checks in the browser (tab **Validation**) or locally:

```bash
node tests/run_tests.js
```

## Two engines – JavaScript and Python

The solver exists twice, as `js/solver.js` and as the pure-Python package `python/boheme_mp`. Both use the same algorithm; a cross-validation test checks that they agree on every value of every example (relative deviation below 1e-9, in practice about 1e-12).

In the web app, choose the engine in the side bar:

| Engine | Where it runs | Use |
|---|---|---|
| JavaScript | in the browser | fastest, default |
| Python (Pyodide) | in the browser | the Python package is loaded from this repository |
| Python server | `python -m boheme_mp serve` | solver code stays on the server |

### Python command line

```bash
cd python
python -m boheme_mp validate
python -m boheme_mp run ../examples/power_pack_mission.json --csv mission.csv --plot mission.png
python -m boheme_mp serve --port 8000
```

`run` needs no extra packages; `--plot` needs matplotlib, `serve` needs `pip install -r requirements-server.txt`.

### Tests

```bash
node tests/run_tests.js
python -m pytest -q
```

`python/tests` contains the validation suite, the JavaScript ↔ Python cross-validation and API tests.

## Run locally

Any static web server works, for example:

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

## Project structure

```
index.html              user interface
js/solver.js            solver core (no dependencies)
js/validation.js        validation suite (browser and Node)
js/app.js               user interface logic
js/view3d.js            3D network view (three.js)
python/boheme_mp/       Python engine: solver, validation, CLI, API server
python/tests/           pytest: validation, cross-validation, API
examples/               example projects
tests/run_tests.js      command-line test runner
tests/fixtures/         reference data (Excel, BOHEME)
```

## Limits

Lumped (0-D) networks; no water hammer or wave propagation; hydraulics quasi-steady per time step; fluid property correlations are approximations. Results are engineering estimates.

© 2026 Enes. All rights reserved. See LICENSE and NOTICE.md.
