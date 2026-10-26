const fs = require('fs');
const path = require('path');
const S = require('../js/solver.js');
const strip = o => JSON.parse(JSON.stringify(o, (k, v) => (k === 'state' || k === 'hydState') ? undefined : v));
const out = {};
for (const f of ['power_pack_mission.json', 'a320_green.json', 'excel_reference.json']) {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', f), 'utf8'));
  out[f] = strip(S.simulate(m));
}
fs.writeFileSync(path.join(__dirname, 'fixtures', 'js_results.json'), JSON.stringify(out));
console.log('JS results exported:', Object.keys(out).join(', '));
