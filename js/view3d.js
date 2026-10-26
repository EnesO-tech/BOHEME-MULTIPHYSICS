(function () {
  'use strict';
  const COL = { hyd: 0x4fc3f7, th: 0xff8a50, el: 0xffd740 };
  const COL_COUPLE = 0x888888;
  const COL_BG = 0x0d1020;
  const R_NODE = 0.22;
  const R_TAP = 0.18;
  let scene, camera, renderer, controls, nodeGroup, edgeGroup, coupleGroup, labelLayer;
  let labels = [];
  let raycaster, pointer, hoveredMesh = null, tooltip;
  let built = false, active = false;

  function init() {
    const host = document.getElementById('view3d');
    if (!host) return;
    if (!window.THREE) { host.innerHTML = '<div style="padding:40px;color:#8d98b8">The 3D library (three.js) could not be loaded. Check your internet connection or content blocker and reload the page.</div>'; return; }
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COL_BG);
    camera = new THREE.PerspectiveCamera(50, 1, 0.01, 500);
    camera.position.set(0, 0, 18);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    host.appendChild(renderer.domElement);
    if (THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
    }
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dl = new THREE.DirectionalLight(0xffffff, 0.7);
    dl.position.set(5, 10, 7);
    scene.add(dl);
    nodeGroup = new THREE.Group(); scene.add(nodeGroup);
    edgeGroup = new THREE.Group(); scene.add(edgeGroup);
    coupleGroup = new THREE.Group(); scene.add(coupleGroup);
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2(-9, -9);
    tooltip = document.createElement('div');
    tooltip.style.cssText = 'position:absolute;top:0;left:0;background:rgba(13,16,32,.92);color:#dfe5f5;border:1px solid #4fc3f7;border-radius:6px;padding:6px 10px;font-size:12px;pointer-events:none;display:none;white-space:pre-line;z-index:10;max-width:300px;';
    host.appendChild(tooltip);
    labelLayer = document.createElement('div');
    labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    host.appendChild(labelLayer);
    host.addEventListener('pointermove', e => {
      const r = host.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      tooltip.style.left = (e.clientX - r.left + 14) + 'px';
      tooltip.style.top = (e.clientY - r.top + 14) + 'px';
    });
    host.addEventListener('pointerleave', () => { pointer.set(-9, -9); tooltip.style.display = 'none'; });
    resize();
    window.addEventListener('resize', resize);
    (function loop() { requestAnimationFrame(loop); if (!active) return; tick(); renderer.render(scene, camera); })();
    document.getElementById('v3layout').addEventListener('change', () => rebuild());
    document.getElementById('v3labels').addEventListener('change', () => updateLabels());
    document.getElementById('v3coupling').addEventListener('change', () => { coupleGroup.visible = document.getElementById('v3coupling').checked; });
    built = true;
  }

  function resize() {
    const host = document.getElementById('view3d');
    if (!host || !renderer) return;
    const w = host.clientWidth, h = host.clientHeight || 600;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function tick() {
    if (controls) controls.update();
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(nodeGroup.children, false);
    if (hits.length && hits[0].object.userData.id) {
      const m = hits[0].object;
      if (hoveredMesh !== m) {
        if (hoveredMesh) hoveredMesh.scale.set(1, 1, 1);
        hoveredMesh = m;
        m.scale.set(1.4, 1.4, 1.4);
        tooltip.textContent = m.userData.tip || m.userData.id;
        tooltip.style.display = 'block';
      }
    } else {
      if (hoveredMesh) { hoveredMesh.scale.set(1, 1, 1); hoveredMesh = null; }
      tooltip.style.display = 'none';
    }
    placeLabels();
  }

  let _v = null;
  function placeLabels() {
    const host = document.getElementById('view3d');
    if (!host) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!_v) _v = new THREE.Vector3();
    const camPos = camera.position;
    for (const L of labels) {
      if (!L.visible) { L.el.style.display = 'none'; continue; }
      _v.copy(L.pos).project(camera);
      if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) { L.el.style.display = 'none'; continue; }
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      const d = camPos.distanceTo(L.pos);
      const op = d > 40 ? 0.25 : d > 20 ? 0.6 : 1;
      L.el.style.display = 'block';
      L.el.style.opacity = op;
      L.el.style.transform = 'translate(-50%,-100%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    }
  }

  function addLabel(text, pos, color, kind, key) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;white-space:pre;text-align:center;font:600 ' + (kind === 'node' ? 12 : 10.5) + 'px Segoe UI,Arial,sans-serif;color:' + color + ';text-shadow:0 0 3px #0d1020,0 0 3px #0d1020,0 0 2px #0d1020;line-height:1.25;will-change:transform;';
    el.textContent = text;
    labelLayer.appendChild(el);
    const L = { el, pos: pos.clone(), kind, key, visible: true, text };
    labels.push(L);
    return L;
  }

  function getModel() { return window.BMPApp && window.BMPApp.model; }
  function getResult() { return window.BMPApp && window.BMPApp.last && window.BMPApp.last.final; }

  function layout(model, mode) {
    const nodes = model.nodes || [];
    const comps = model.components || [];
    const pos = {};
    const doms = ['hyd', 'th', 'el'].filter(d => nodes.some(n => n.domain === d));
    const domOff = {};
    doms.forEach((d, i) => { domOff[d] = (i - (doms.length - 1) / 2) * 6; });
    if (mode === 'circular') {
      doms.forEach(d => {
        const ns = nodes.filter(n => n.domain === d);
        const r = Math.max(2, ns.length * 0.6);
        ns.forEach((n, i) => {
          const a = 2 * Math.PI * i / ns.length;
          pos[n.id] = { x: domOff[d] + Math.cos(a) * r, y: Math.sin(a) * r, z: 0, d: n.domain };
        });
      });
      return pos;
    }
    nodes.forEach((n, i) => {
      const a = 2 * Math.PI * i / Math.max(nodes.length, 1);
      const r = 2 + Math.random() * 2;
      pos[n.id] = { x: domOff[n.domain] + Math.cos(a) * r + (Math.random() - 0.5), y: Math.sin(a) * r + (Math.random() - 0.5), z: (Math.random() - 0.5) * 2, d: n.domain };
    });
    const edges = comps.filter(c => c.n1 && c.n2 && pos[c.n1] && pos[c.n2] && c.n1 !== c.n2);
    const L0 = 2.5;
    for (let it = 0; it < 300; it++) {
      const f = {};
      nodes.forEach(n => { f[n.id] = { x: 0, y: 0, z: 0 }; });
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = pos[nodes[i].id], b = pos[nodes[j].id];
          let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
          const r = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 0.3);
          const k = 8 / (r * r);
          dx /= r; dy /= r; dz /= r;
          f[nodes[i].id].x += dx * k * 0.05; f[nodes[i].id].y += dy * k * 0.05; f[nodes[i].id].z += dz * k * 0.05;
          f[nodes[j].id].x -= dx * k * 0.05; f[nodes[j].id].y -= dy * k * 0.05; f[nodes[j].id].z -= dz * k * 0.05;
        }
      }
      edges.forEach(e => {
        const a = pos[e.n1], b = pos[e.n2];
        let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const k = (r - L0) * 0.03;
        dx /= r; dy /= r; dz /= r;
        f[e.n1].x += dx * k; f[e.n1].y += dy * k; f[e.n1].z += dz * k;
        f[e.n2].x -= dx * k; f[e.n2].y -= dy * k; f[e.n2].z -= dz * k;
      });
      nodes.forEach(n => {
        const dx = domOff[n.domain] - pos[n.id].x;
        f[n.id].x += dx * 0.02;
      });
      const clamp = 0.3;
      nodes.forEach(n => {
        const p = pos[n.id], fi = f[n.id];
        p.x += Math.max(-clamp, Math.min(clamp, fi.x));
        p.y += Math.max(-clamp, Math.min(clamp, fi.y));
        p.z += Math.max(-clamp, Math.min(clamp, fi.z));
      });
    }
    return pos;
  }

  function clearGroup(g) {
    while (g.children.length) {
      const c = g.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }
    }
  }

  function rebuild() {
    const model = getModel();
    if (!model || !scene) return;
    clearGroup(nodeGroup); clearGroup(edgeGroup); clearGroup(coupleGroup);
    labels.forEach(L => L.el.remove()); labels = [];
    const mode = document.getElementById('v3layout').value;
    const pos = layout(model, mode);
    const nodes = model.nodes || [];
    const comps = model.components || [];
    const geo = new THREE.SphereGeometry(R_NODE, 32, 24);
    const tapGeo = new THREE.BoxGeometry(R_TAP * 2, R_TAP * 2, R_TAP * 2);
    nodes.forEach(n => {
      const col = COL[n.domain] || 0xaaaaaa;
      const mat = new THREE.MeshPhongMaterial({ color: col, shininess: 60 });
      const isTap = n.tap || Number.isFinite(n.fixed);
      const mesh = new THREE.Mesh(isTap ? tapGeo : geo, mat);
      const p = pos[n.id];
      if (p) mesh.position.set(p.x, p.y, p.z);
      mesh.userData = { id: n.id, domain: n.domain, tap: isTap };
      nodeGroup.add(mesh);
    });
    const colStr = d => '#' + (COL[d] || 0xaaaaaa).toString(16).padStart(6, '0');
    comps.forEach(c => {
      if (!c.n1 || !c.n2 || !pos[c.n1] || !pos[c.n2]) return;
      const a = pos[c.n1], b = pos[c.n2];
      const pts = [new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const col = COL[c.domain] || 0xaaaaaa;
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: col, linewidth: 2, transparent: true, opacity: 0.75 }));
      line.userData = { name: c.name, domain: c.domain };
      edgeGroup.add(line);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
      addLabel(c.name, new THREE.Vector3(mx, my + 0.12, mz), colStr(c.domain), 'comp', c.name);
    });
    comps.forEach(c => {
      if (c.heatTo && pos[c.heatTo]) {
        const mid = midOf(c, pos);
        if (!mid) return;
        const b = pos[c.heatTo];
        const pts = [new THREE.Vector3(mid.x, mid.y, mid.z), new THREE.Vector3(b.x, b.y, b.z)];
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: 0xff8a50, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.5 }));
        line.computeLineDistances();
        coupleGroup.add(line);
      }
      if (c.type === 'MOTORPUMP' && c.pump) {
        const pumpComp = comps.find(x => x.name === c.pump);
        if (pumpComp) {
          const midA = midOf(c, pos), midB = midOf(pumpComp, pos);
          if (midA && midB) {
            const pts = [new THREE.Vector3(midA.x, midA.y, midA.z), new THREE.Vector3(midB.x, midB.y, midB.z)];
            const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
            const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: 0xffd740, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.5 }));
            line.computeLineDistances();
            coupleGroup.add(line);
          }
        }
      }
    });
    nodes.forEach(n => {
      const p = pos[n.id];
      if (!p) return;
      addLabel(n.id, new THREE.Vector3(p.x, p.y + R_NODE + 0.08, p.z), '#ffffff', 'node', n.id);
    });
    coupleGroup.visible = document.getElementById('v3coupling').checked;
    updateLabels();
    fitCamera(pos);
    const info = document.getElementById('v3info');
    if (info) info.textContent = nodes.length + ' nodes · ' + comps.length + ' components';
  }

  function midOf(c, pos) {
    const a = pos[c.n1], b = pos[c.n2];
    if (!a || !b) return a || b || null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  }

  function fitCamera(pos) {
    const pts = Object.values(pos);
    if (!pts.length) return;
    let cx = 0, cy = 0, cz = 0;
    pts.forEach(p => { cx += p.x; cy += p.y; cz += p.z; });
    cx /= pts.length; cy /= pts.length; cz /= pts.length;
    let maxR = 1;
    pts.forEach(p => { maxR = Math.max(maxR, Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2)); });
    const dist = maxR / Math.tan((camera.fov / 2) * Math.PI / 180) * 1.3;
    camera.position.set(cx, cy, cz + Math.max(dist, 6));
    if (controls) { controls.target.set(cx, cy, cz); controls.update(); }
  }

  function updateLabels() {
    const mode = document.getElementById('v3labels').value;
    const res = getResult();
    const fmt = (v, u) => Number.isFinite(v) ? (Math.abs(v) >= 1e5 || (Math.abs(v) > 0 && Math.abs(v) < 0.01) ? v.toExponential(2) : v.toFixed(2)) + ' ' + u : '';
    labels.forEach(L => {
      const model = getModel();
      let val = '';
      if (L.kind === 'node') {
        const n = model && model.nodes.find(x => x.id === L.key);
        if (res && n) {
          if (n.domain === 'hyd' && res.hyd) val = fmt(res.hyd.nodes[L.key], 'bar');
          else if (n.domain === 'th' && res.T) val = fmt(res.T[L.key], '°C');
          else if (n.domain === 'el' && res.el) val = fmt(res.el.nodes[L.key], 'V');
        }
      } else if (res) {
        if (res.hyd && res.hyd.components[L.key]) val = fmt(res.hyd.components[L.key].q, 'm³/h');
        else if (res.el && res.el.components[L.key]) val = fmt(res.el.components[L.key].p, 'W');
        else if (res.th && res.th.components[L.key]) val = fmt(res.th.components[L.key].q, 'W');
      }
      let text = L.key;
      if (mode === 'value' && val) text = val;
      else if (mode === 'both' && val) text = L.key + '\n' + val;
      L.visible = mode !== 'off';
      if (L.text !== text) { L.text = text; L.el.textContent = text; }
    });
    nodeGroup.children.forEach(m => {
      const id = m.userData.id;
      const model = getModel();
      const n = model && model.nodes.find(x => x.id === id);
      let tip = id;
      if (res && n) {
        tip += '\ndomain: ' + n.domain;
        if (n.domain === 'hyd' && res.hyd) tip += '\np = ' + fmt(res.hyd.nodes[id], 'bar');
        if (n.domain === 'th' && res.T) tip += '\nT = ' + fmt(res.T[id], '°C');
        if (n.domain === 'el' && res.el) tip += '\nV = ' + fmt(res.el.nodes[id], 'V');
        if (m.userData.tap) tip += '\n(boundary / tap)';
      }
      m.userData.tip = tip;
    });
  }

  function onTabActivate(tab) {
    active = (tab === 'view3d');
    if (labelLayer) labelLayer.style.display = active ? 'block' : 'none';
    if (!active) return;
    if (!built) init();
    if (!built) return;
    resize();
    rebuild();
  }

  function onSolveComplete() {
    if (active) updateLabels();
  }

  window.View3D = { rebuild, updateLabels, onTabActivate, onSolveComplete };
})();
