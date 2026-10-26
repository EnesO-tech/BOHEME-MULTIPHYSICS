const path = require('path');
const fs = require('fs');
const S = require('../js/solver.js');
const V = require('../js/validation.js');
const fx = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
const t0 = Date.now();
const res = V.run(S, { excel: fx('excel_reference.json'), a320: fx('a320_green.json') });
let fail = 0, group = '';
for (const r of res) {
  if (r.group !== group) { group = r.group; console.log('\n' + group); }
  console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + '  [' + r.detail + ']');
  if (!r.ok) fail++;
}
console.log('\n' + (res.length - fail) + '/' + res.length + ' checks passed in ' + ((Date.now() - t0) / 1000).toFixed(2) + ' s');
process.exit(fail ? 1 : 0);
