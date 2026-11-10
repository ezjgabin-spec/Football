/* Ultimate Football -> Unreal bridge.
   Unreal injects this file into the game page. The game's own code keeps running every rule, menu and mode;
   this file (1) fixes the keyboard inside Unreal's browser, (2) stops the page from drawing its own 3D,
   and (3) streams the 3D scene (meshes, materials, textures, player skeletons, camera) to Unreal, which draws it.
   Messages go to window.ue.fb.asset(json) (things sent once) and window.ue.fb.frame(json) (every frame). */
(function () {
  'use strict';
  if (window.__fbue) { try { window.__fbue.hello(); } catch (e) {} return; }
  var U = window.__fbue = { ver: 6, webGfx: false, frames: 0, bytes: 0, assetBytes: 0, budget: 700000, maxInstVerts: 90000, log: [] };
  function bridge() { return window.ue && window.ue.fb; }
  function report(m) { try { var b = bridge(); if (b) b.report(String(m)); else console.log('FBUE ' + m); } catch (e) {} }
  U.report = report;
  U.stats = {};
  U.stat = function (k) { U.stats[k] = (U.stats[k] || 0) + 1; };
  U.hello = function () { report('bridge v' + U.ver + ' already loaded, frames=' + U.frames); };

  // ------------------------------------------------------------------ 1. keyboard
  // Unreal's browser delivers key events without the "code" field (KeyW, ShiftLeft...) that the game reads. Fill it in.
  var KEYMAP = { 8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'ShiftLeft', 17: 'ControlLeft', 18: 'AltLeft', 20: 'CapsLock', 27: 'Escape', 32: 'Space',
    33: 'PageUp', 34: 'PageDown', 35: 'End', 36: 'Home', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 45: 'Insert', 46: 'Delete',
    186: 'Semicolon', 187: 'Equal', 188: 'Comma', 189: 'Minus', 190: 'Period', 191: 'Slash', 192: 'Backquote', 219: 'BracketLeft', 220: 'Backslash', 221: 'BracketRight', 222: 'Quote' };
  function codeOf(k) {
    if (KEYMAP[k]) return KEYMAP[k];
    if (k >= 65 && k <= 90) return 'Key' + String.fromCharCode(k);
    if (k >= 48 && k <= 57) return 'Digit' + (k - 48);
    if (k >= 96 && k <= 105) return 'Numpad' + (k - 96);
    if (k >= 112 && k <= 123) return 'F' + (k - 111);
    return '';
  }
  function keyOf(k, shift, code) {
    if (k >= 65 && k <= 90) { var c = String.fromCharCode(k); return shift ? c : c.toLowerCase(); }
    if (k >= 48 && k <= 57) return String(k - 48);
    if (k === 32) return ' ';
    if (k === 16) return 'Shift'; if (k === 17) return 'Control'; if (k === 18) return 'Alt';
    return code || 'Unidentified';
  }
  var keySeen = 0;
  ['keydown', 'keyup'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      if (keySeen < 4 && type === 'keydown') { keySeen++; report('key event: key=' + e.key + ' code=' + e.code + ' keyCode=' + e.keyCode + ' fixed=' + (!!e.__fb)); }
      if (e.__fb || e.code) return;
      var kc = e.keyCode || e.which || 0, code = codeOf(kc);
      if (!code) return;
      e.stopImmediatePropagation();
      var key = (e.key && e.key !== 'Unidentified' && e.key !== '') ? e.key : keyOf(kc, e.shiftKey, code);
      var ev = new KeyboardEvent(type, { key: key, code: code, keyCode: kc, which: kc, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, bubbles: true, cancelable: true, composed: true });
      try { Object.defineProperty(ev, 'keyCode', { get: function () { return kc; } }); Object.defineProperty(ev, 'which', { get: function () { return kc; } }); } catch (x) {}
      ev.__fb = true;
      var ok = (e.target || document).dispatchEvent(ev);
      if (!ok) e.preventDefault();
    }, true);
  });

  // Unreal reads the keyboard itself and calls this for every key press / release (so it does not matter what has the focus).
  U.ueKeys = false;
  function editable(el) { return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)); }
  U.key = function (down, kc, shift, ctrl, alt, repeat) {
    U.ueKeys = true;
    var k = kc, code = '';
    if (kc === 160 || kc === 161) { code = kc === 160 ? 'ShiftLeft' : 'ShiftRight'; k = 16; }
    else if (kc === 162 || kc === 163) { code = kc === 162 ? 'ControlLeft' : 'ControlRight'; k = 17; }
    else if (kc === 164 || kc === 165) { code = kc === 164 ? 'AltLeft' : 'AltRight'; k = 18; }
    else code = codeOf(kc);
    if (!code || editable(document.activeElement)) return;
    var type = down ? 'keydown' : 'keyup';
    var ev = new KeyboardEvent(type, { key: keyOf(k, !!shift, code), code: code, keyCode: k, which: k, shiftKey: !!shift, ctrlKey: !!ctrl, altKey: !!alt, repeat: !!repeat, bubbles: true, cancelable: true, composed: true });
    try { Object.defineProperty(ev, 'keyCode', { get: function () { return k; } }); Object.defineProperty(ev, 'which', { get: function () { return k; } }); } catch (x) {}
    ev.__fb = true;
    if (keySeen < 4 && down) report('key from Unreal: code=' + code + ' keyCode=' + k);
    (document.getElementById('game') || document.body).dispatchEvent(ev);
  };
  function tellTyping() { try { var b = bridge(); if (b && b.typing) b.typing(editable(document.activeElement) ? '1' : '0'); } catch (e) {} }
  document.addEventListener('focusin', tellTyping, true);
  document.addEventListener('focusout', function () { setTimeout(tellTyping, 0); }, true);

  // ------------------------------------------------------------------ 2. page layout: the game fills the window, the page's own 3D canvas is hidden, Unreal shows through
  var css = document.createElement('style');
  css.id = 'fbue-css';
  css.textContent =
    'html.fbue,html.fbue body{background:transparent!important}' +
    'html.fbue .screen{background:transparent!important}' +
    'html.fbue .wrap > :not(.screen){visibility:hidden!important}' +
    'html.fbue #gl{background:transparent!important}' +
    'html.fbue.fbue-native #gl{opacity:0!important}' +
    'html.fbue-menu #game{opacity:0!important;pointer-events:none!important}' +
    '#fbue-menu{display:none;position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;font-family:Arial Black,Arial,Helvetica,sans-serif;color:#fff;background:linear-gradient(90deg,rgba(3,6,16,.92) 0%,rgba(3,6,16,.62) 34%,rgba(3,6,16,0) 60%);user-select:none}' +
    'html.fbue-menu #fbue-menu{display:block}' +
    '#fbue-menu .in{position:absolute;left:6vw;top:10vh;width:34vw}' +
    '#fbue-menu .t1{font-size:7.2vh;line-height:1;letter-spacing:.04em}' +
    '#fbue-menu .t2{font-size:7.2vh;line-height:1.1;letter-spacing:.04em;color:#ffd24a}' +
    '#fbue-menu .sub{font:700 1.7vh Arial,Helvetica,sans-serif;letter-spacing:.3em;color:#9fb4d8;margin:1.2vh 0 6vh}' +
    '#fbue-menu button{display:block;width:100%;margin:0 0 1.8vh;padding:2.1vh 2vw;font:900 3vh Arial Black,Arial,sans-serif;letter-spacing:.06em;text-align:left;color:#fff;background:rgba(18,30,60,.85);border:2px solid rgba(255,255,255,.28);border-left:8px solid #ffd24a;border-radius:6px;cursor:pointer}' +
    '#fbue-menu button:hover{background:#1f6f3a;border-color:#fff}' +
    '#fbue-menu button.small{font-size:1.9vh;padding:1.3vh 2vw;border-left-color:#6f86b8;background:rgba(18,30,60,.6)}' +
    '#fbue-menu .hint{position:absolute;left:6vw;bottom:4vh;font:700 1.6vh Arial,Helvetica,sans-serif;color:#9fb4d8;letter-spacing:.08em}';
  (document.head || document.documentElement).appendChild(css);
  document.documentElement.classList.add('fbue');
  try { document.body.classList.add('fbfs'); } catch (e) {}       // the game's own full-window layout (16:9, centred)
  function setNative(on) { U.webGfx = !on; document.documentElement.classList.toggle('fbue-native', !!on); }
  U.setNative = setNative;

  // ------------------------------------------------------------------ 2b. a plain start menu (click only) instead of the walk-around lobby
  var menu = document.createElement('div');
  menu.id = 'fbue-menu';
  menu.innerHTML = '<div class="in"><div class="t1">ULTIMATE</div><div class="t2">FOOTBALL</div><div class="sub">UNREAL EDITION</div>' +
    '<button data-a="play">PLAY GAME</button>' +
    '<button data-a="tut" class="small">TUTORIAL</button>' +
    '<button data-a="full" class="small">FULL MENU (ULTIMATE TEAM, SHOP, FRIENDS...)</button>' +
    '<button data-a="quit" class="small">QUIT</button></div>' +
    '<div class="hint">IN A GAME: WASD MOVE - SHIFT SPRINT - MOUSE AIMS AND THROWS - F9 OLD GRAPHICS - M THIS MENU</div>';
  (document.body || document.documentElement).appendChild(menu);
  var menuHold = false;
  function gameApi() { return window.BLACKTOP && window.BLACKTOP.fb; }
  menu.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button') : null; if (!b) return;
    var a = b.getAttribute('data-a'), G = gameApi();
    if (a === 'quit') { try { bridge().quit(); } catch (x) {} return; }
    menuHold = true;                                    // show the game's own screens until we are back in the lobby
    if (!G) return;
    try {
      if (a === 'play') { G.act('play'); setTimeout(function () { try { if (G.FB.scr === 'howto') G.act('howok'); } catch (x) {} }, 400); }
      else if (a === 'tut') G.act('tut');
    } catch (x2) { report('menu action failed: ' + x2); }
  });
  var wasLobby = false;
  setInterval(function () {
    var G = gameApi(), F = G && G.FB, lobby = !!(F && F.on && F.scr === 'lobby');
    if (lobby && !wasLobby && !menuFirst) menuHold = false;          // came back from a game: show the menu again
    if (lobby) menuFirst = false;
    wasLobby = lobby;
    var show = lobby && !menuHold && !document.getElementById('utAuth') && !document.getElementById('fbLoading');
    document.documentElement.classList.toggle('fbue-menu', show);
  }, 150);
  var menuFirst = true;
  window.addEventListener('keydown', function (e) { if (e.code === 'KeyM' && !editable(document.activeElement)) { var G = gameApi(); if (G && G.FB && G.FB.scr === 'lobby') menuHold = !menuHold; } }, true);

  // ------------------------------------------------------------------ 3. scene streaming
  if (typeof THREE === 'undefined') { report('THREE not found: the page keeps drawing by itself'); return; }
  var idOf = new WeakMap(), nextId = 1;
  function id(o) { var i = idOf.get(o); if (!i) { i = nextId++; idOf.set(o, i); } return i; }
  var sentGeom = new Map();      // geometry key -> {id, ver}
  var sentTex = new Map();       // texture uuid -> {id, ver, t}
  var sentMat = new Map();       // material uuid -> signature
  var sentObj = new Map();       // object id -> signature (which mesh, which materials)
  var sentXf = new Map();        // object id -> last transform sent
  var objGeo = new Map();        // object id -> {uuid, n, vol}: meshes whose geometry object is replaced over and over get one stable id
  var objMat = new Map();        // object id + slot -> {uuid, n, vol, id}
  var queue = [];                // pending asset messages (strings), sent a few per frame
  var lastTexT = 0;

  function b64(ta) {
    var u8 = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength), s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function r4(v) { return Math.round(v * 10000) / 10000; }

  // ---- textures
  var texCanvas = null;
  function texData(tx, alpha) {
    var img = tx.image; if (!img) return null;
    var w = img.width || img.videoWidth || 0, h = img.height || img.videoHeight || 0; if (!w || !h) return null;
    var MAXS = 2048, k = Math.min(1, MAXS / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    if (!texCanvas) texCanvas = document.createElement('canvas');
    texCanvas.width = cw; texCanvas.height = ch;
    var g = texCanvas.getContext('2d'); g.clearRect(0, 0, cw, ch);
    try { g.drawImage(img, 0, 0, cw, ch); } catch (e) { return null; }
    var url;
    try { url = alpha ? texCanvas.toDataURL('image/png') : texCanvas.toDataURL('image/jpeg', 0.9); } catch (e) { return null; }
    return { w: cw, h: ch, d: url.substring(url.indexOf(',') + 1), f: alpha ? 'png' : 'jpg' };
  }
  function texId(tx, alpha, now) {
    if (!tx || !tx.image) return 0;
    var rec = sentTex.get(tx.uuid);
    if (rec && (rec.ver === tx.version || now - rec.t < 400)) return rec.id;      // a canvas texture that changes is re-sent at most ~2.5 times a second
    if (rec && now - lastTexT < 120) return rec.id;
    var d = texData(tx, alpha); if (!d) return rec ? rec.id : 0;
    var tid = rec ? rec.id : nextId++;
    sentTex.set(tx.uuid, { id: tid, ver: tx.version, t: now });
    lastTexT = now;
    queue.push(JSON.stringify({ t: 'tex', id: tid, w: d.w, h: d.h, f: d.f, flip: tx.flipY ? 1 : 0, d: d.d }));
    return tid;
  }

  // ---- materials
  function matSig(m, now) {
    var c = m.color, e = m.emissive, alpha = !!(m.transparent || m.alphaTest > 0);
    var lit = !(m.isMeshBasicMaterial || m.isSpriteMaterial || m.isPointsMaterial || m.isLineBasicMaterial || m.isShaderMaterial);
    var o = { t: 'mat', id: 0,
      c: c ? [r4(c.r), r4(c.g), r4(c.b)] : [1, 1, 1],
      e: (e && lit) ? [r4(e.r * (m.emissiveIntensity === undefined ? 1 : m.emissiveIntensity)), r4(e.g * (m.emissiveIntensity === undefined ? 1 : m.emissiveIntensity)), r4(e.b * (m.emissiveIntensity === undefined ? 1 : m.emissiveIntensity))] : [0, 0, 0],
      o: r4(m.opacity === undefined ? 1 : m.opacity), tr: m.transparent ? 1 : 0, at: r4(m.alphaTest || 0), ds: m.side === 2 ? 1 : 0, lit: lit ? 1 : 0,
      ro: r4(m.roughness === undefined ? (m.isMeshPhongMaterial ? 0.45 : 0.9) : m.roughness), me: r4(m.metalness || 0),
      vc: m.vertexColors ? 1 : 0, add: m.blending === 2 ? 1 : 0, dw: m.depthWrite === false ? 0 : 1,
      map: texId(m.map, alpha, now), n: (m.name || '') };
    var t = m.map;
    if (t && t.repeat && t.offset && (t.repeat.x !== 1 || t.repeat.y !== 1 || t.offset.x !== 0 || t.offset.y !== 0)) {
      // scrolling / tiled textures: scale + offset, already converted for Unreal's top-down V
      var fl = t.flipY !== false;
      o.uvs = [r4(t.repeat.x), r4(t.repeat.y)]; o.uvo = [r4(t.offset.x), r4(fl ? 1 - t.repeat.y - t.offset.y : t.offset.y)];
    }
    return o;
  }
  function matId(m, now, oid, slot) {
    if (!m) return 0;
    var mk = oid + ':' + slot, om = objMat.get(mk);
    if (!om) { om = { uuid: m.uuid, n: 0, vol: false, id: 0 }; objMat.set(mk, om); }
    else if (om.uuid !== m.uuid) { om.uuid = m.uuid; om.n++; if (om.n >= 3 && !om.vol) { om.vol = true; om.id = nextId++; U.stat('volatile material slots'); } }
    var mid = om.vol ? om.id : id(m), key = om.vol ? 'vol|' + mk : m.uuid;
    var o = matSig(m, now); o.id = mid;
    var sig = JSON.stringify(o);
    if (sentMat.get(key) !== sig) { if (sentMat.has(key)) U.stat('m:' + m.type + ':' + (m.name || '')); sentMat.set(key, sig); queue.push(sig); }
    return mid;
  }

  // ---- geometry
  function attrF32(a, n, comps) {
    var out = new Float32Array(n * comps);
    if (a.isInterleavedBufferAttribute || a.normalized || !(a.array instanceof Float32Array) || a.itemSize < comps) {
      for (var i = 0; i < n; i++) { out[i * comps] = a.getX(i); if (comps > 1) out[i * comps + 1] = a.itemSize > 1 ? a.getY(i) : 0; if (comps > 2) out[i * comps + 2] = a.itemSize > 2 ? a.getZ(i) : 0; }
    } else if (a.itemSize === comps) out.set(a.array.subarray(0, n * comps));
    else { for (var j = 0; j < n; j++) for (var c = 0; c < comps; c++) out[j * comps + c] = a.array[j * a.itemSize + c]; }
    return out;
  }
  var _v = new THREE.Vector3(), _m3 = new THREE.Matrix3();
  function geomMsg(gid, g, mesh, uvT, flipV, tint) {
    var P = g.attributes.position, n = P.count;
    var pos = attrF32(P, n, 3), nrm;
    if (g.attributes.normal) nrm = attrF32(g.attributes.normal, n, 3);
    else { var tmp = g.clone(); tmp.computeVertexNormals(); nrm = attrF32(tmp.attributes.normal, n, 3); tmp.dispose(); }
    var skinned = !!(mesh && mesh.isSkinnedMesh && g.attributes.skinIndex && g.attributes.skinWeight);
    if (skinned) {                                             // bake the bind matrix so Unreal only needs (bone world x bone inverse) per bone
      var bm = mesh.bindMatrix; _m3.setFromMatrix4(bm);
      for (var i = 0; i < n; i++) {
        _v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(bm); pos[i * 3] = _v.x; pos[i * 3 + 1] = _v.y; pos[i * 3 + 2] = _v.z;
        _v.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).applyMatrix3(_m3).normalize(); nrm[i * 3] = _v.x; nrm[i * 3 + 1] = _v.y; nrm[i * 3 + 2] = _v.z;
      }
    }
    var msg = { t: 'geom', id: gid, n: n, p: b64(pos), nr: b64(nrm) };
    if (g.attributes.uv) {
      var uv = attrF32(g.attributes.uv, n, 2);
      for (var k = 0; k < n; k++) {
        var u = uv[k * 2], v = uv[k * 2 + 1];
        if (uvT) { u = u * uvT[0] + uvT[2]; v = v * uvT[1] + uvT[3]; }
        uv[k * 2] = u; uv[k * 2 + 1] = flipV ? 1 - v : v;     // Unreal's V runs top to bottom
      }
      msg.uv = b64(uv);
    }
    if (g.attributes.color || tint) {
      var ca = g.attributes.color, col = new Float32Array(n * 3), tr = tint ? tint.r : 1, tg = tint ? tint.g : 1, tb = tint ? tint.b : 1;
      for (var q = 0; q < n; q++) { col[q * 3] = (ca ? ca.getX(q) : 1) * tr; col[q * 3 + 1] = (ca ? ca.getY(q) : 1) * tg; col[q * 3 + 2] = (ca ? ca.getZ(q) : 1) * tb; }
      msg.c = b64(col);
    }
    var idx;
    if (g.index) { idx = new Uint32Array(g.index.count); for (var a = 0; a < idx.length; a++) idx[a] = g.index.getX(a); }
    else { idx = new Uint32Array(n - (n % 3)); for (var b = 0; b < idx.length; b++) idx[b] = b; }
    var dr = g.drawRange;
    if (dr && (dr.start > 0 || (isFinite(dr.count) && dr.count < idx.length))) idx = idx.subarray(dr.start, Math.min(idx.length, dr.start + (isFinite(dr.count) ? dr.count : idx.length)));
    msg.i = b64(idx);
    if (g.groups && g.groups.length > 1) msg.gr = g.groups.map(function (x) { return [x.start, x.count, x.materialIndex || 0]; });
    if (skinned) {
      var si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
      for (var s = 0; s < n; s++) {
        var w0 = SW.getX(s), w1 = SW.getY(s), w2 = SW.getZ(s), w3 = SW.getW(s), sum = w0 + w1 + w2 + w3 || 1;
        si[s * 4] = SI.getX(s); si[s * 4 + 1] = SI.getY(s); si[s * 4 + 2] = SI.getZ(s); si[s * 4 + 3] = SI.getW(s);
        sw[s * 4] = w0 / sum; sw[s * 4 + 1] = w1 / sum; sw[s * 4 + 2] = w2 / sum; sw[s * 4 + 3] = w3 / sum;
      }
      msg.si = b64(si); msg.sw = b64(sw); msg.nb = mesh.skeleton.bones.length;
    }
    return JSON.stringify(msg);
  }
  function posHash(P) {
    var n = P.count, st = Math.max(1, Math.floor(n / 64)), h = n;
    for (var i = 0; i < n; i += st) h = (h * 31 + Math.round((P.getX(i) * 3 + P.getY(i) * 5 + P.getZ(i) * 7) * 1000)) | 0;
    return h;
  }
  function geomId(mesh, mat0, oid) {
    var g = mesh.geometry, P = g.attributes.position; if (!P || P.count < 3) return 0;
    var uvT = null, flip = !(mat0 && mat0.map && mat0.map.flipY === false);
    var og = objGeo.get(oid);
    if (!og) { og = { uuid: g.uuid, n: 0, vol: false }; objGeo.set(oid, og); }
    else if (og.uuid !== g.uuid) { og.uuid = g.uuid; og.n++; if (og.n >= 3 && !og.vol) { og.vol = true; U.stat('volatile geometry objects'); } }
    var key, ver;
    if (og.vol && !mesh.isSkinnedMesh) { key = 'vol|' + oid; ver = posHash(P) + (g.index ? g.index.count : 0) * 13; }
    else {
      var be = mesh.isSkinnedMesh ? mesh.bindMatrix.elements : null;       // rigs cloned from one template share the geometry AND the bind matrix: one copy is enough
      key = g.uuid + (flip ? '' : '|nf') + (be ? '|s' + r4(be[0]) + ',' + r4(be[5]) + ',' + r4(be[10]) + ',' + r4(be[12]) + ',' + r4(be[13]) + ',' + r4(be[14]) + ',' + mesh.skeleton.bones.length : '');
      var pv = P.version; if (pv === undefined) pv = (P.data && P.data.version) || 0;        // interleaved attributes keep their version on the shared buffer
      var iv = g.index ? (g.index.version || 0) : 0;
      ver = pv + iv * 131 + ((g.drawRange && isFinite(g.drawRange.count)) ? g.drawRange.count * 7 + g.drawRange.start : 0);
    }
    var rec = sentGeom.get(key);
    if (rec && rec.ver === ver) return rec.id;
    var gid = rec ? rec.id : nextId++;
    sentGeom.set(key, { id: gid, ver: ver });
    if (rec) U.stat('g:' + (mesh.name || mesh.type) + ':' + P.count);
    try { queue.push(geomMsg(gid, g, mesh, uvT, flip)); } catch (e) { report('geometry export failed: ' + e); return 0; }
    return gid;
  }

  function geomIdTinted(mesh, mat0, color) {
    var g = mesh.geometry, P = g.attributes.position; if (!P || P.count < 3) return 0;
    var flip = !(mat0 && mat0.map && mat0.map.flipY === false);
    var key = 'col|' + g.uuid + '|' + color.getHexString() + (flip ? '' : '|nf');
    var rec = sentGeom.get(key);
    if (rec) return rec.id;
    var gid = nextId++;
    sentGeom.set(key, { id: gid, ver: 0 });
    try { queue.push(geomMsg(gid, g, null, null, flip, color)); } catch (e) { return 0; }
    return gid;
  }
  var instIds = new Map();
  function instId(oid, k) { var key = oid * 4096 + k, v = instIds.get(key); if (!v) { v = nextId++; instIds.set(key, v); } return v; }

  // ---- instanced meshes: baked into one mesh (world space) while they are small enough; the crowd is streamed as instances
  var _iw = new THREE.Matrix4();
  var _im = new THREE.Matrix4(), _iv = new THREE.Vector3(), _in = new THREE.Vector3(), _n3 = new THREE.Matrix3(), _ic = new THREE.Color();
  function instGeomId(mesh, mat0) {
    var g = mesh.geometry, P = g.attributes.position, cnt = mesh.count, n = P.count;
    if (!cnt || n * cnt > U.maxInstVerts) return 0;
    var key = 'inst|' + mesh.uuid, ver = mesh.instanceMatrix.version * 31 + (mesh.instanceColor ? mesh.instanceColor.version : 0) + cnt * 977;
    var rec = sentGeom.get(key), nowT = performance.now();
    if (rec && (rec.ver === ver || nowT - rec.t < 700)) return rec.id;          // a big instanced mesh that keeps changing is re-sent at most ~1.4 times a second
    var gid = rec ? rec.id : nextId++;
    sentGeom.set(key, { id: gid, ver: ver, t: nowT });
    if (rec) U.stat('i:' + cnt + 'x' + n);
    var flip = !(mat0 && mat0.map && mat0.map.flipY === false);
    var pos = new Float32Array(n * cnt * 3), nrm = new Float32Array(n * cnt * 3), col = new Float32Array(n * cnt * 3), uv = g.attributes.uv ? new Float32Array(n * cnt * 2) : null;
    var srcIdx = g.index, ic = srcIdx ? srcIdx.count : n, idx = new Uint32Array(ic * cnt), N = g.attributes.normal, UVA = g.attributes.uv, CA = g.attributes.color;
    for (var k = 0; k < cnt; k++) {
      mesh.getMatrixAt(k, _im); _n3.getNormalMatrix(_im);
      if (mesh.instanceColor) mesh.getColorAt(k, _ic); else _ic.setRGB(1, 1, 1);
      for (var i = 0; i < n; i++) {
        var o = (k * n + i) * 3;
        _iv.fromBufferAttribute(P, i).applyMatrix4(_im); pos[o] = _iv.x; pos[o + 1] = _iv.y; pos[o + 2] = _iv.z;
        if (N) { _in.fromBufferAttribute(N, i).applyMatrix3(_n3).normalize(); nrm[o] = _in.x; nrm[o + 1] = _in.y; nrm[o + 2] = _in.z; } else nrm[o + 1] = 1;
        col[o] = _ic.r * (CA ? CA.getX(i) : 1); col[o + 1] = _ic.g * (CA ? CA.getY(i) : 1); col[o + 2] = _ic.b * (CA ? CA.getZ(i) : 1);
        if (uv) { uv[(k * n + i) * 2] = UVA.getX(i); uv[(k * n + i) * 2 + 1] = flip ? 1 - UVA.getY(i) : UVA.getY(i); }
      }
      for (var j = 0; j < ic; j++) idx[k * ic + j] = (srcIdx ? srcIdx.getX(j) : j) + k * n;
    }
    var msg = { t: 'geom', id: gid, n: n * cnt, p: b64(pos), nr: b64(nrm), c: b64(col), i: b64(idx) };
    if (uv) msg.uv = b64(uv);
    queue.push(JSON.stringify(msg));
    return gid;
  }

  // ---- one frame
  var _bm = new THREE.Matrix4(), firstInfo = false;
  function m12(e, out, o) {            // three stores column-major; write the 3x4 rows
    out[o] = e[0]; out[o + 1] = e[4]; out[o + 2] = e[8]; out[o + 3] = e[12];
    out[o + 4] = e[1]; out[o + 5] = e[5]; out[o + 6] = e[9]; out[o + 7] = e[13];
    out[o + 8] = e[2]; out[o + 9] = e[6]; out[o + 10] = e[10]; out[o + 11] = e[14];
  }
  function capture(renderer, scene, camera) {
    var now = performance.now(), B = bridge();
    U.frames++;
    var vis = [], objs = [], xfIds = [], xfM = [], skList = [], skipped = 0;
    function emit(oid, gid, mids, shadow, sk, forceVC, e) {
      vis.push(oid);
      var sig = gid + '|' + mids.join(',') + '|' + shadow + (sk ? 's' : '') + (forceVC ? 'i' : '');
      if (sentObj.get(oid) !== sig) { sentObj.set(oid, sig); objs.push([oid, gid, mids, shadow, sk ? 1 : 0, forceVC ? 1 : 0]); }
      if (!sk) {
        var xs = r4(e[0]) + ',' + r4(e[1]) + ',' + r4(e[2]) + ',' + r4(e[4]) + ',' + r4(e[5]) + ',' + r4(e[6]) + ',' + r4(e[8]) + ',' + r4(e[9]) + ',' + r4(e[10]) + ',' + r4(e[12]) + ',' + r4(e[13]) + ',' + r4(e[14]);
        if (sentXf.get(oid) !== xs) { sentXf.set(oid, xs); xfIds.push(oid); xfM.push(e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]); }
      }
    }
    scene.traverseVisible(function (o) {
      if (!(o.isMesh)) { if (o.isSprite || o.isPoints || o.isLine) skipped++; return; }
      var g = o.geometry; if (!g || !g.attributes || !g.attributes.position) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material], m0 = mats[0];
      if (!m0 || m0.visible === false) return;
      var oid = id(o), gid, i;
      var mids = []; for (i = 0; i < mats.length; i++) mids.push(matId(mats[i], now, oid, i));
      var shadow = o.castShadow ? 1 : 0;
      if (o.isInstancedMesh) {
        if (o.count > 0 && o.count <= 128) {              // a few instances: each one becomes its own object (they may move every frame)
          for (var k = 0; k < o.count; k++) {
            var gk;
            if (o.instanceColor) { o.getColorAt(k, _ic); gk = geomIdTinted(o, m0, _ic); } else gk = geomId(o, m0, oid);
            if (!gk) continue;
            o.getMatrixAt(k, _im); _iw.multiplyMatrices(o.matrixWorld, _im);
            emit(instId(oid, k), gk, mids, shadow, false, !!o.instanceColor, _iw.elements);
          }
          return;
        }
        gid = instGeomId(o, m0); if (!gid) { skipped++; return; }
        emit(oid, gid, mids, shadow, false, true, o.matrixWorld.elements);
        return;
      }
      gid = geomId(o, m0, oid);
      if (!gid) return;
      var sk = !!(o.isSkinnedMesh && o.skeleton && g.attributes.skinIndex);
      emit(oid, gid, mids, shadow, sk, false, o.matrixWorld.elements);
      if (sk) skList.push(o);
    });
    // skinned meshes: (bone world matrix x bone inverse) for every bone, 12 floats each. The parts of one player share a skeleton, which is sent once.
    var skelIndex = new Map(), skels = [], skMeta = [], totalBones = 0;
    for (var s = 0; s < skList.length; s++) {
      var sm = skList[s], sk0 = sm.skeleton, bones0 = sk0.bones, inv0 = sk0.boneInverses;
      var ie = inv0.length ? inv0[inv0.length - 1].elements : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      var skKey = id(bones0[0]) + ':' + bones0.length + ':' + r4(ie[12]) + ',' + r4(ie[13]) + ',' + r4(ie[14]) + ',' + r4(ie[0]);
      var si = skelIndex.get(skKey);
      if (si === undefined) { si = skels.length; skelIndex.set(skKey, si); skels.push(sk0); totalBones += bones0.length; }
      skMeta.push(id(sm), si);
    }
    var skArr = new Float32Array(totalBones * 12), off = 0, skCounts = [];
    for (var q = 0; q < skels.length; q++) {
      var bones = skels[q].bones, inv = skels[q].boneInverses;
      skCounts.push(bones.length);
      for (var b = 0; b < bones.length; b++) { _bm.multiplyMatrices(bones[b].matrixWorld, inv[b]); m12(_bm.elements, skArr, off); off += 12; }
    }
    var ce = camera.matrixWorld.elements;
    var frame = { f: U.frames, cam: [r4(ce[12]), r4(ce[13]), r4(ce[14]), r4(-ce[8]), r4(-ce[9]), r4(-ce[10]), r4(ce[4]), r4(ce[5]), r4(ce[6]), camera.fov, camera.aspect, camera.near, camera.far],
      vis: b64(new Uint32Array(vis)), objs: objs, xi: b64(new Uint32Array(xfIds)), xm: b64(new Float32Array(xfM)), skm: skMeta, skc: skCounts, sk: b64(skArr), skip: skipped, q: queue.length };
    if (!firstInfo) { firstInfo = true; report('first frame: ' + vis.length + ' visible meshes, ' + skList.length + ' skinned, queue ' + queue.length + ' assets, three r' + THREE.REVISION); }
    if (!B) return;
    // assets first (a limited amount per frame so the game keeps running while everything loads), then the frame
    var spent = 0;
    while (queue.length && spent < U.budget) { var a = queue.shift(); spent += a.length; try { B.asset(a); } catch (x) {} }
    U.assetBytes += spent;
    var fs = JSON.stringify(frame); U.bytes += fs.length;
    try { B.frame(fs); } catch (x2) {}
  }
  U.capture = capture;

  // ---- take over the renderer: THREE calls scene.onBeforeRender(renderer, scene, camera) on every render, which hands us the renderer
  var hooked = false;
  var prevHook = THREE.Scene.prototype.onBeforeRender;
  THREE.Scene.prototype.onBeforeRender = function (renderer, scene, camera) {
    if (!hooked && renderer && typeof renderer.render === 'function' && renderer.domElement && renderer.domElement.id === 'gl') {
      hooked = true;
      var orig = renderer.render.bind(renderer);
      U.renderer = renderer; U.origRender = orig;
      renderer.render = function (sc, cam) {
        var toScreen = !renderer.getRenderTarget || renderer.getRenderTarget() === null;
        if (U.webGfx || !toScreen || !(sc && sc.isScene)) return orig(sc, cam);
        try {
          if (sc.matrixWorldAutoUpdate !== false && sc.autoUpdate !== false) sc.updateMatrixWorld();
          if (cam.parent === null) cam.updateMatrixWorld();
          capture(renderer, sc, cam);
        } catch (e) { if (U.log.length < 5) { U.log.push(String(e)); report('capture error: ' + e + ' ' + (e && e.stack ? e.stack.split('\n')[1] : '')); } }
      };
      setNative(true);
      report('renderer hooked: Unreal draws the 3D from now on');
    }
    if (prevHook) return prevHook.apply(this, arguments);
  };
  // F9 switches between Unreal graphics and the page's own graphics (for comparing / if something is missing)
  window.addEventListener('keydown', function (e) { if (e.code === 'F9' || e.keyCode === 120) { setNative(U.webGfx); report('graphics: ' + (U.webGfx ? 'web page' : 'Unreal')); } }, true);
  try { var B0 = bridge(); if (B0) B0.asset(JSON.stringify({ t: 'reset', ver: U.ver })); } catch (e) {}
  report('bridge v' + U.ver + ' loaded, three r' + THREE.REVISION + ', window ' + innerWidth + 'x' + innerHeight);
})();
