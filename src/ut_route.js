// /api/ut/<action>: forwards to the signed-in player's Vault. CORS is open because the game page lives on another address.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', 'cache-control': 'no-store' };
const ACTIONS = new Set(['tready', 'tlineup', 'faceget', 'faceset', 'tget', 'tcreate', 'tjoin', 'tleave', 'treport', 'tadmin', 'seasonset', 'seasonclaim', 'draftget', 'draftpick', 'devunlock', 'devgive', 'lbget', 'chalclaim', 'emailinfo', 'emailstart', 'emailcheck', 'register', 'login', 'state', 'buy', 'open', 'gamestart', 'gamefinish', 'logout', 'lineup', 'upgrade', 'kickbuy', 'ping', 'sell', 'setjersey', 'cardup', 'passclaim', 'xfequip', 'xfunequip', 'passarm', 'tradelist', 'tradeopen', 'tradeget', 'tradeset', 'tradeaccept', 'tradecancel', 'mjoin', 'mreport', 'mstake', 'mwcancel', 'mforfeit', 'mqueue', 'mpoll', 'mcancel']);
export async function utRoute(req, env) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const act = new URL(req.url).pathname.split('/').pop();
  if (req.method !== 'POST' || !ACTIONS.has(act)) return new Response('{"ok":false}', { status: 404, headers: CORS });
  const text = await req.text(); if (text.length > 12000) return new Response('{"ok":false,"err":"too big"}', { status: 413, headers: CORS });
  let b; try { b = JSON.parse(text); } catch (e) { return new Response('{"ok":false,"err":"bad request"}', { status: 400, headers: CORS }); }
  const mailbox = () => env.MM.get(env.MM.idFromName('email'));                       // the email registry (a separate instance of the matchmaker object)
  if (act === 'emailinfo') return new Response(JSON.stringify({ ok: true, required: env.EMAIL_REQUIRED === '1' }), { status: 200, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
  if (act === 'emailstart' || act === 'emailcheck') {
    const rr = await mailbox().fetch('https://m/' + (act === 'emailstart' ? 'estart' : 'echeck'), { method: 'POST', body: JSON.stringify({ email: b.email, code: b.code, ip: req.headers.get('cf-connecting-ip') || '' }) });
    return new Response(rr.body, { status: rr.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
  }
  const user = String(b.user || '').toLowerCase();
  if (!/^[a-z0-9_]{3,16}$/.test(user)) return new Response('{"ok":false,"err":"names are 3-16 letters, numbers or _"}', { status: 400, headers: CORS });
  const stub = env.VAULT.get(env.VAULT.idFromName('ut:' + user));
  if (act === 'lbget') {                                                           // leaderboards: sign in first, then read the board
    const who = await stub.fetch('https://vault/ping', { method: 'POST', body: JSON.stringify({ user, token: b.token }) });
    if (!who.ok) return new Response(who.body, { status: who.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
    const wk = (() => { const n = new Date(), t = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return 'w' + t.toISOString().slice(0, 10); })();
    const rr = await env.MM.get(env.MM.idFromName('lb')).fetch('https://m/lbget', { method: 'POST', body: JSON.stringify({ board: String(b.board || ''), user, week: wk }) });
    return new Response(rr.body, { status: rr.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
  }
  if (act === 'faceget' || act === 'faceset') {                                       // player faces: anyone signed in reads the map, only verified devs change it
    const who = await stub.fetch('https://vault/ping', { method: 'POST', body: JSON.stringify({ user, token: b.token }) });
    if (!who.ok) return new Response(who.body, { status: who.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
    if (act === 'faceset') { const dv = await stub.fetch('https://vault/i_isdev', { method: 'POST', body: JSON.stringify({ user }) }).then(x => x.json()).catch(() => ({})); if (!dv.dev) return new Response('{"ok":false,"err":"only verified devs can assign faces"}', { status: 403, headers: CORS }); }
    const rr = await env.MM.get(env.MM.idFromName('faces')).fetch('https://m/' + (act === 'faceget' ? 'fget' : 'fset'), { method: 'POST', body: JSON.stringify({ pid: b.pid, face: b.face }) });
    return new Response(rr.body, { status: rr.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
  }
  if (/^t(get|create|join|leave|report|admin|ready)$/.test(act)) {                          // tournaments: prove who they are, then hand over to the tournament object
    const who = await stub.fetch('https://vault/ping', { method: 'POST', body: JSON.stringify({ user, token: b.token }) });
    if (!who.ok) return new Response(who.body, { status: who.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
    const rr = await env.MM.get(env.MM.idFromName('tour')).fetch('https://m/' + act, { method: 'POST', body: JSON.stringify({ user, code: b.code, fee: b.fee, signupMin: b.signupMin, startDelayMin: b.startDelayMin, pf: b.pf, pa: b.pa, op: b.op, winner: b.winner }) });
    return new Response(rr.body, { status: rr.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
  }
  if (/^trade(open|get|set|accept|cancel)$/.test(act)) {                                // trading: prove who they are, then hand over to the Trade object
    const who = await stub.fetch('https://vault/ping', { method: 'POST', body: JSON.stringify({ user, token: b.token }) });
    if (!who.ok) return new Response(who.body, { status: who.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
    let tid = String(b.id || ''), body = { user, uids: b.uids, ver: b.ver, pass: b.pass };
    if (act === 'tradeopen') {
      const to = String(b.to || '').toLowerCase();
      if (!/^[a-z0-9_]{3,16}$/.test(to) || to === user) return new Response('{"ok":false,"err":"pick another player"}', { status: 400, headers: CORS });
      const ex = await env.VAULT.get(env.VAULT.idFromName('ut:' + to)).fetch('https://vault/i_exists', { method: 'POST', body: '{}' }).then(x => x.json()).catch(() => ({}));
      if (!ex.ok) return new Response('{"ok":false,"err":"no player with that name"}', { status: 404, headers: CORS });
      { const ok = await stub.fetch('https://vault/i_topen', { method: 'POST', body: JSON.stringify({ user }) }); if (!ok.ok) return new Response(ok.body, { status: ok.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) }); }
      tid = 't' + [...crypto.getRandomValues(new Uint8Array(9))].map(x => (x % 36).toString(36)).join('');
      body = { tid, a: user, b: to, user };
    }
    if (!/^[a-z0-9]{8,32}$/.test(tid)) return new Response('{"ok":false,"err":"bad trade id"}', { status: 400, headers: CORS });
    const rr = await env.TRADE.get(env.TRADE.idFromName('t:' + tid)).fetch('https://t/' + act.slice(5), { method: 'POST', body: JSON.stringify(body) });
    return new Response(rr.body, { status: rr.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
  }
  if (/^m(join|report|queue|poll|cancel|stake|wcancel|forfeit)$/.test(act)) {                               // online matches: prove who they are first, then hand over
    const who = await stub.fetch('https://vault/ping', { method: 'POST', body: JSON.stringify({ user, token: b.token }) });
    if (!who.ok) return new Response(who.body, { status: who.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
    let target;
    if (act === 'mjoin' || act === 'mreport' || act === 'mstake' || act === 'mwcancel' || act === 'mforfeit') {
      const mid = String(b.mid || ''); if (!/^[a-z0-9]{6,32}$/.test(mid)) return new Response('{"ok":false,"err":"bad match id"}', { status: 400, headers: CORS });
      target = env.MATCH.get(env.MATCH.idFromName('m:' + mid));
    } else target = env.MM.get(env.MM.idFromName('mm'));
    const rr = await target.fetch('https://m/' + act, { method: 'POST', body: JSON.stringify({ user, mid: b.mid, pf: b.pf, pa: b.pa, ry: b.ry, py: b.py, ptd: b.ptd, rtd: b.rtd, rec: b.rec, fd: b.fd, ic: b.ic, tod: b.tod, amount: b.amount, role: b.role, room: b.room }) });
    return new Response(rr.body, { status: rr.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
  }
  if (act === 'register' && env.EMAIL_REQUIRED === '1') {                              // a new account needs a verified email ONLY when the variable EMAIL_REQUIRED=1 is set in Cloudflare
    const ticket = String(b.ticket || ''), cl = await mailbox().fetch('https://m/eclaim', { method: 'POST', body: JSON.stringify({ ticket, user }) });
    if (!cl.ok) return new Response(cl.body, { status: cl.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
    const r = await stub.fetch('https://vault/register', { method: 'POST', body: JSON.stringify(Object.assign({}, b, { user, ticket: undefined })) });
    const txt = await r.text(); let ok = false; try { ok = JSON.parse(txt).ok === true; } catch (e) {}
    await mailbox().fetch('https://m/' + (ok ? 'ebind' : 'erelease'), { method: 'POST', body: JSON.stringify({ ticket, user }) });
    return new Response(txt, { status: r.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
  }
  const r = await stub.fetch('https://vault/' + act, { method: 'POST', body: JSON.stringify(Object.assign({}, b, { user })) });
  return new Response(r.body, { status: r.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
}
