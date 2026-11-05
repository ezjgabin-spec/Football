// Online Ultimate Team matches. One Match object per match id. It loads both players' saved teams FROM THE SERVER
// (never from the browser), and only pays out when both players report the same final score.
import { DurableObject } from 'cloudflare:workers';
import { MATCH, WAGER, TOUR } from './ut_config.js';
import { sha, normEmail, sendMail } from './email.js';

const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const DISPOSABLE_BLOCK = d => /(^|\.)(mailinator|guerrillamail|10minutemail|tempmail|temp-mail|yopmail|trashmail|sharklasers|getnada|dispostable|maildrop|throwawaymail|fakeinbox|mailnesia|mintemail|emailondeck)\./.test(d + '.');
const vault = (env, user) => env.VAULT.get(env.VAULT.idFromName('ut:' + user));
const ivault = async (env, user, act, body) => { const r = await vault(env, user).fetch('https://vault/' + act, { method: 'POST', body: JSON.stringify(Object.assign({ user }, body || {})) }); return r.json(); };

export class Match extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.env = env; this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS mp (user TEXT PRIMARY KEY, snap TEXT NOT NULL, joined INTEGER NOT NULL, pf INTEGER, pa INTEGER, rep INTEGER);
      CREATE TABLE IF NOT EXISTS mm (k TEXT PRIMARY KEY, v TEXT);`);
    for (const col of ['role TEXT', 'room TEXT', 'ry INTEGER', 'py INTEGER', 'st TEXT', 'stake INTEGER']) { try { this.sql.exec('ALTER TABLE mp ADD COLUMN ' + col); } catch (e) {} } }
  rows() { return this.sql.exec('SELECT * FROM mp ORDER BY joined').toArray(); }
  async fetch(req) {
    const b = await req.json(), act = new URL(req.url).pathname.split('/').pop();
    if (act === 'mjoin') return this.join(b);
    if (act === 'mreport') return this.report(b);
    if (act === 'mstake') return this.stake(b);
    if (act === 'mwcancel') return this.wcancel(b);
    if (act === 'mforfeit') return this.forfeit(b);
    if (act === 'teams') return j({ ok: true, players: this.rows().map(r => ({ user: r.user, role: r.role, room: r.room, snap: JSON.parse(r.snap) })) });
    return j({ ok: false, err: 'unknown' }, 404);
  }
  async join(b) {
    const rows = this.rows(), mine = rows.find(r => r.user === b.user);
    if (!mine && rows.length >= 2) return j({ ok: false, err: 'match is full' }, 409);
    if (!mine) {
      const tm = /^tr(.+?)r\d+s\d+$/.exec(String(b.mid || '')), s = await ivault(this.env, b.user, 'i_snap', { tour: !!tm, tid: tm ? tm[1] : '' });   // a tournament game: your tournament lineup + this tournament's LTD player
      const role = b.role === 'host' || b.role === 'guest' ? b.role : '', room = String(b.room || '').slice(0, 40);
      if (role && rows.some(r => r.role === role)) return j({ ok: false, err: 'that side is taken' }, 409);
      this.sql.exec('INSERT INTO mp (user, snap, joined, role, room) VALUES (?,?,?,?,?)', b.user, JSON.stringify(s.snap), Date.now(), role, room);
    }
    return j({ ok: true, ...this.view(b.user) });
  }
  view(user) {
    const rows = this.rows(), me = rows.find(r => r.user === user), opp = rows.find(r => r.user !== user);
    return { me: me ? JSON.parse(me.snap) : null, opp: opp ? JSON.parse(opp.snap) : null, oppUser: opp ? opp.user : null };
  }
  wagerState() { const r = this.rows(); return { both: r.length === 2 && r.every(x => x.stake > 0), amount: (r.find(x => x.stake > 0) || {}).stake || 0 }; }
  async stake(b) {
    const rows = this.rows(), me = rows.find(r => r.user === b.user); if (!me) return j({ ok: false, err: 'not in this match' }, 403);
    if (rows.some(r => r.rep)) return j({ ok: false, err: 'the game is already over' }, 409);
    const amt = Math.floor(+b.amount), opp = rows.find(r => r.user !== b.user);
    if (!me.stake) {
      if (!(amt >= WAGER.min && amt <= WAGER.max)) return j({ ok: false, err: 'wager must be ' + WAGER.min + '-' + WAGER.max }, 400);
      if (opp && opp.stake && opp.stake !== amt) return j({ ok: false, err: 'the wager is ' + opp.stake }, 409);
      const r = await ivault(this.env, b.user, 'i_wlock', { mid: String(b.mid), amount: amt, opp: opp ? opp.user : '' });
      if (!r.ok) return j({ ok: false, err: r.err || 'could not hold the wager', short: !!r.short }, 402);
      this.sql.exec('UPDATE mp SET stake=? WHERE user=?', amt, b.user);
    }
    const w = this.wagerState(); return j({ ok: true, status: w.both ? 'locked' : 'waiting', amount: w.amount });
  }
  async wcancel(b) {          // the other player never matched the wager: everybody gets their stake back
    const rows = this.rows(); if (!rows.some(r => r.user === b.user)) return j({ ok: false, err: 'not in this match' }, 403);
    if (this.wagerState().both) return j({ ok: false, err: 'both players already staked' }, 409);
    for (const r of rows) if (r.stake > 0) { await ivault(this.env, r.user, 'i_wsettle', { mid: String(b.mid), result: 'refund' }); this.sql.exec('UPDATE mp SET stake=0 WHERE user=?', r.user); }
    return j({ ok: true });
  }
  async forfeit(b) {          // leaving a wagered game is a loss
    const rows = this.rows(), me = rows.find(r => r.user === b.user), opp = rows.find(r => r.user !== b.user);
    if (!me || !opp || !this.wagerState().both || this.sql.exec("SELECT v FROM mm WHERE k='paid'").toArray()[0]) return j({ ok: true, noop: true });
    this.sql.exec("INSERT INTO mm (k,v) VALUES ('paid','1')");
    await ivault(this.env, me.user, 'i_wsettle', { mid: String(b.mid), result: 'lose' }); await ivault(this.env, opp.user, 'i_wsettle', { mid: String(b.mid), result: 'win' });
    return j({ ok: true, forfeited: true });
  }
  async report(b) {
    const rows = this.rows(), me = rows.find(r => r.user === b.user);
    if (!me) return j({ ok: false, err: 'not in this match' }, 403);
    const pf = Math.floor(+b.pf), pa = Math.floor(+b.pa);
    if (!(pf >= 0 && pf <= 200 && pa >= 0 && pa <= 200)) return j({ ok: false, err: 'bad score' }, 400);
    const cl = (x, m) => Math.max(0, Math.min(m, Math.floor(+x) || 0)), st = { ry: cl(b.ry, 1500), py: cl(b.py, 1500), ptd: cl(b.ptd, 60), rtd: cl(b.rtd, 60), rec: cl(b.rec, 200), fd: cl(b.fd, 200), ic: cl(b.ic, 60), tod: cl(b.tod, 60) };
    if (!me.rep) this.sql.exec('UPDATE mp SET pf=?, pa=?, ry=?, py=?, st=?, rep=1 WHERE user=?', pf, pa, st.ry, st.py, JSON.stringify(st), b.user);   // the first report is final
    const all = this.rows(), opp = all.find(r => r.user !== b.user);
    if (!opp || !opp.rep) return j({ ok: true, status: 'waiting' });
    const a = all.find(r => r.user === b.user);
    if (a.pf !== opp.pa || a.pa !== opp.pf) return j({ ok: true, status: 'disputed' });                  // the two players disagree: nobody is paid
    const secs = (Date.now() - Math.max(...all.map(r => r.joined))) / 1000, W = this.wagerState();
    const paid = this.sql.exec("SELECT v FROM mm WHERE k='paid'").toArray()[0];
    if (!paid) {
      if (all.length < 2 || secs < MATCH.minSeconds) return j({ ok: true, status: 'too short' });
      this.sql.exec("INSERT INTO mm (k,v) VALUES ('paid','1')");
      for (const r of all) {
        const o = all.find(x => x.user !== r.user), mine = JSON.parse(r.st || '{}'), theirs = JSON.parse(o.st || '{}');
        // each player's score uses his OWN reported offense plus the OTHER player's offense as "yards / touchdowns allowed"
        await ivault(this.env, r.user, 'i_pay', Object.assign({ mid: String(b.mid), opp: o.user, pf: r.pf, pa: r.pa, wager: W.both, oy: (o.ry || 0) + (o.py || 0), tda: theirs.ptd || 0, rtda: theirs.rtd || 0 }, mine));
        if (r.stake > 0) { const res = W.both ? (r.pf > r.pa ? 'win' : r.pf < r.pa ? 'lose' : 'refund') : 'refund'; const w = await ivault(this.env, r.user, 'i_wsettle', { mid: String(b.mid), result: res }); this.sql.exec("INSERT OR REPLACE INTO mm (k,v) VALUES (?,?)", 'wn:' + r.user, String(w.net || 0)); }
      }
    }
    const mine = await ivault(this.env, b.user, 'i_pay', { mid: String(b.mid), pf: a.pf, pa: a.pa, peek: true });
    const wn = this.sql.exec("SELECT v FROM mm WHERE k=?", 'wn:' + b.user).toArray()[0];
    return j({ ok: true, status: 'settled', paid: mine.paid, xp: mine.xp || 0, why: mine.why === 'already paid' ? '' : mine.why, wagered: W.both, wagerNet: wn ? +wn.v : 0, ...mine.stateOut });
  }
}


// ---- WEDNESDAY NIGHT FOOTBALL (this object used with the name 'tour'): a fully automatic weekly tournament.
// Every transition (sign-up closes, bracket built, a round opens, check-in deadlines, results, the next week) is decided here, on the server,
// by whichever comes first: a player request, the object's alarm, or the Worker's cron tick. Every step is idempotent and runs one at a time (a lock).
const T_NOW = () => Date.now();
function seedOrder(P){ let o = [1]; while (o.length < P) { const n = o.length * 2; o = o.flatMap(s => [s, n + 1 - s]); } return o; }
function nyParts(ms){ const f = new Intl.DateTimeFormat('en-US', { timeZone: TOUR.wnf.tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value; return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(o.weekday) }; }
function nyToUtc(y, m, d, h, mi){                    // a New York wall-clock time -> the real instant (two passes settle the daylight-saving offset)
  let t = Date.UTC(y, m - 1, d, h, mi); for (let k = 0; k < 3; k++) { const p = nyParts(t), wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi); t += Date.UTC(y, m - 1, d, h, mi) - wall; } return t; }
function nextWnf(after){                              // the first Wednesday 8:00 PM (New York) strictly after `after`
  const W = TOUR.wnf; for (let k = 0; k < 9; k++) { const p = nyParts(after + k * 86400000); if (p.wd !== W.dow) continue; const t = nyToUtc(p.y, p.m, p.d, W.hour, W.minute); if (t > after) return t; }
  return after + 7 * 86400000; }
function wnfTid(at){ const p = nyParts(at); return 'w' + p.y + String(p.m).padStart(2, '0') + String(p.d).padStart(2, '0'); }
export const tourMethods = {
  tInit() { if (this._tinit) return; this._tinit = true;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS tmeta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS tent (tid TEXT NOT NULL, user TEXT NOT NULL, ts INTEGER NOT NULL, seed INTEGER, wins INTEGER, pf INTEGER, ltd TEXT, place INTEGER, PRIMARY KEY (tid, user));
      CREATE TABLE IF NOT EXISTS tgame (tid TEXT NOT NULL, rnd INTEGER NOT NULL, slot INTEGER NOT NULL, a TEXT, b TEXT, w TEXT, sa INTEGER, sb INTEGER, ra TEXT, rb TEXT, ready INTEGER, PRIMARY KEY (tid, rnd, slot));
      CREATE TABLE IF NOT EXISTS thist (a TEXT NOT NULL, b TEXT NOT NULL, w TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tchamp (tid TEXT PRIMARY KEY, user TEXT NOT NULL, ts INTEGER NOT NULL);`);
    for (const c of ['st TEXT', 'ck INTEGER', 'rda INTEGER', 'rdb INTEGER', 'started INTEGER', 'how TEXT', 'done INTEGER']) { try { this.sql.exec('ALTER TABLE tgame ADD COLUMN ' + c); } catch (e) {} }
    for (const c of ['fee INTEGER', 'dropped INTEGER', 'prized INTEGER', 'out INTEGER']) { try { this.sql.exec('ALTER TABLE tent ADD COLUMN ' + c); } catch (e) {} } },
  tm(k, v) { if (v === undefined) { const r = this.sql.exec('SELECT v FROM tmeta WHERE k=?', k).toArray()[0]; return r ? r.v : null; } this.sql.exec('INSERT INTO tmeta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, String(v)); },
  tCur() { const tid = this.tm('tid'); if (!tid) return null; return { tid, state: this.tm('state'), fee: +this.tm('fee') || 0, startAt: +this.tm('startAt') || 0, round: +this.tm('round') || 0, rounds: +this.tm('rounds') || 0, size: +this.tm('size') || 0, ended: +this.tm('ended') || 0, why: this.tm('why') || '' }; },
  tBump() { this.tm('ver', (+this.tm('ver') || 0) + 1); this._changed = true; },
  tLock(fn) { const run = (this._tq || Promise.resolve()).then(fn, fn); this._tq = run.catch(() => {}); return run; },   // one step at a time: no double brackets, no double prizes
  async tFetch(act, b) { this.tInit(); return this.tLock(() => this.tHandle(act, b)); },
  async alarm() { const has = this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='tmeta'").toArray().length; if (!has) return; this.tInit(); await this.tLock(() => this.tTick()); },
  async tTick() { this._changed = false; await this.tAdvance(T_NOW()); await this.tAfter(); },
  async tAfter() { if (this._changed) this.tNotify(); await this.tSchedule(); },
  async tHandle(act, b) {
    this._changed = false; const now = T_NOW(), me = String(b.user || ''); await this.tAdvance(now);
    const done = (o, code) => this.tAfter().then(() => j(o, code));
    if (act === 'ttick') return done({ ok: true });
    if (act === 'tget') return done({ ok: true, ...this.tView(me) });
    const T = this.tCur();
    if (act === 'tcreate' || act === 'tadmin') {                // the owner's tools (the start code): entry fee, start now / at a time, cancel, settle, skip check-in
      if (String(b.code || '') !== TOUR.code) return done({ ok: false, err: 'wrong tournament code' }, 403);
      if (!T) return done({ ok: false, err: 'no tournament' }, 409);
      const op = act === 'tcreate' ? 'setup' : String(b.op || '');
      if (op === 'setup' && T.state === 'signup') { this.tm('fee', Math.max(0, Math.min(TOUR.maxFee, Math.floor(+b.fee || 0)))); if (b.startDelayMin != null && b.startDelayMin !== '') this.tm('startAt', now + Math.max(TOUR.startDelayMin[0], Math.min(TOUR.startDelayMin[1], Math.floor(+b.startDelayMin))) * 60000); this.tBump(); }
      else if (op === 'startnow' && T.state === 'signup') { this.tm('startAt', now); this.tBump(); }
      else if (op === 'cancel' && (T.state === 'signup' || T.state === 'running')) { await this.tCancel(T, 'cancelled by the owner'); }
      else if (op === 'next' && (T.state === 'done' || T.state === 'cancelled')) { this.tm('ended', 1); await this.tSettle(T); this.tEnsure(now); }   // skip the 30-minute result screen
      else if (op === 'skip' && T.state === 'running') { this.sql.exec("UPDATE tgame SET ck=? WHERE tid=? AND st='checkin'", now, T.tid); this.tBump(); }
      else if (op === 'win' && T.state === 'running') { const g = this.sql.exec("SELECT * FROM tgame WHERE tid=? AND done IS NULL AND (a=? OR b=?)", T.tid, String(b.winner || ''), String(b.winner || '')).toArray()[0]; if (!g) return done({ ok: false, err: 'no open game for that player' }, 409); this.tResolve(T, g, String(b.winner), null, null, 'owner'); }
      else return done({ ok: false, err: 'that does not apply right now' }, 409);
      await this.tAdvance(T_NOW()); return done({ ok: true, ...this.tView(me) });
    }
    if (!T) return done({ ok: false, err: 'no tournament right now' }, 409);
    if (act === 'tjoin') {
      if (T.state !== 'signup' || now >= T.startAt) return done({ ok: false, err: 'sign-up is closed - see you next Wednesday' }, 409);
      if (this.sql.exec('SELECT 1 FROM tent WHERE tid=? AND user=?', T.tid, me).toArray().length) { const l = await ivault(this.env, me, 'i_tltd', { tid: T.tid }).catch(() => null); return done({ ok: true, ltd: l && l.card, already: true, ...this.tView(me) }); }
      const f = await ivault(this.env, me, 'i_tfee', { fee: T.fee, tid: T.tid }); if (!f.ok) return done({ ok: false, err: f.err || 'could not pay the entry fee' }, 402);
      this.sql.exec('INSERT INTO tent (tid,user,ts,fee) VALUES (?,?,?,?) ON CONFLICT DO NOTHING', T.tid, me, now, T.fee);
      const l = await ivault(this.env, me, 'i_tltd', { tid: T.tid }).catch(() => null);           // exactly one free Season LTD pack per tournament (the vault keys it by tournament)
      if (l && l.card) this.sql.exec('UPDATE tent SET ltd=? WHERE tid=? AND user=?', l.card.pid, T.tid, me);
      this.tBump(); return done({ ok: true, ltd: l && l.card, ...this.tView(me) });
    }
    if (act === 'tleave') {
      if (T.state !== 'signup') return done({ ok: false, err: 'the bracket is already set' }, 409);
      const e = this.sql.exec('SELECT fee FROM tent WHERE tid=? AND user=?', T.tid, me).toArray()[0]; if (!e) return done({ ok: true, ...this.tView(me) });
      this.sql.exec('DELETE FROM tent WHERE tid=? AND user=?', T.tid, me); await ivault(this.env, me, 'i_trefund', { fee: e.fee || 0, tid: T.tid }).catch(() => {}); await ivault(this.env, me, 'i_tdrop', { tid: T.tid }).catch(() => {});
      this.tBump(); return done({ ok: true, ...this.tView(me) });
    }
    if (act === 'tready') {
      if (T.state !== 'running') return done({ ok: false, err: 'not running' }, 409);
      const g = this.sql.exec("SELECT * FROM tgame WHERE tid=? AND rnd=? AND st='checkin' AND (a=? OR b=?)", T.tid, T.round, me, me).toArray()[0];
      if (!g) return done({ ok: false, err: 'you have no check-in right now' }, 409);
      if (now >= g.ck) return done({ ok: false, err: 'the check-in window closed' }, 409);
      const col = g.a === me ? 'rda' : 'rdb'; if (!g[col]) { this.sql.exec('UPDATE tgame SET ' + col + '=? WHERE tid=? AND rnd=? AND slot=?', now, T.tid, g.rnd, g.slot); this.tBump(); }
      await this.tAdvance(T_NOW()); return done({ ok: true, ...this.tView(me) });
    }
    if (act === 'treport') {
      if (T.state !== 'running') return done({ ok: false, err: 'not running' }, 409);
      const g = this.sql.exec("SELECT * FROM tgame WHERE tid=? AND st='live' AND (a=? OR b=?)", T.tid, me, me).toArray()[0]; if (!g) return done({ ok: false, err: 'you have no game to report' }, 409);
      const pf = Math.floor(+b.pf), pa = Math.floor(+b.pa); if (!(pf >= 0 && pf <= 200 && pa >= 0 && pa <= 200) || pf === pa) return done({ ok: false, err: 'bad score (tournament games need a winner)' }, 400);
      const col = g.a === me ? 'ra' : 'rb'; if (!g[col]) { this.sql.exec('UPDATE tgame SET ' + col + '=? WHERE tid=? AND rnd=? AND slot=?', JSON.stringify({ pf, pa, ts: now }), T.tid, g.rnd, g.slot); this.tBump(); }   // the first report from each player is final
      await this.tAdvance(T_NOW()); return done({ ok: true, ...this.tView(me) });
    }
    return done({ ok: false, err: 'unknown' }, 404);
  },
  tEnsure(now) {                                       // there is always a next Wednesday on the board
    const T = this.tCur(); if (T && (T.state === 'signup' || T.state === 'running')) return;
    if (T && this.sql.exec('SELECT 1 FROM tent WHERE tid=? AND (dropped IS NULL OR (place IS NOT NULL AND prized IS NULL))', T.tid).toArray().length) return;   // finish paying out and collecting LTD cards first
    if (T && now - T.ended < 30 * 60000) return;                                              // the result stays up for 30 minutes (the champion's moment)
    const startAt = nextWnf(Math.max(now, T ? T.startAt + 3600000 : 0)); let tid = wnfTid(startAt); if (T && T.tid.indexOf(tid) === 0) tid = tid + 'x' + (now % 1679616).toString(36);
    if (T) this.tm('lasttid', T.tid);
    this.tm('tid', tid); this.tm('state', 'signup'); this.tm('fee', 0); this.tm('startAt', startAt); this.tm('round', 0); this.tm('rounds', 0); this.tm('size', 0); this.tm('ended', 0); this.tm('why', ''); this.tBump();
  },
  async tCancel(T, why) {
    this.tm('state', 'cancelled'); this.tm('why', why); this.tm('ended', T_NOW()); this.tBump();
    for (const e of this.sql.exec('SELECT user, fee FROM tent WHERE tid=?', T.tid).toArray()) { await ivault(this.env, e.user, 'i_trefund', { fee: e.fee || 0, tid: T.tid, once: true }).catch(() => {}); }
    this.sql.exec('UPDATE tent SET place=NULL, prized=1 WHERE tid=?', T.tid);                  // nothing to pay; LTD cards still get taken back by the settle step
  },
  async tBuild(T, now) {                              // 8:00 PM: seed everyone, place the byes, open round 1
    const ents = this.sql.exec('SELECT user, ts FROM tent WHERE tid=?', T.tid).toArray();
    if (ents.length < 2) { await this.tCancel(T, ents.length ? 'only one player signed up - refunded' : 'nobody signed up'); return; }
    for (const e of ents) { const r = await ivault(this.env, e.user, 'i_tstats', {}).catch(() => null); const st = (r && r.stats) || {}; e.wins = st.wins | 0; e.pf = st.pf | 0; }
    const H = this.sql.exec('SELECT a, b, w FROM thist').toArray(), byWins = {}; ents.forEach(e => { (byWins[e.wins] = byWins[e.wins] || []).push(e); });
    Object.values(byWins).forEach(grp => { const names = new Set(grp.map(e => e.user)); grp.forEach(e => { e.h2h = H.filter(h => h.w === e.user && names.has(h.a) && names.has(h.b)).length; }); });
    ents.sort((x, y) => y.wins - x.wins || y.h2h - x.h2h || y.pf - x.pf || x.ts - y.ts || (x.user < y.user ? -1 : 1));   // total wins, head-to-head, points scored, then sign-up order: deterministic
    ents.forEach((e, i) => this.sql.exec('UPDATE tent SET seed=?, wins=?, pf=? WHERE tid=? AND user=?', i + 1, e.wins, e.pf, T.tid, e.user));
    let P = 1; while (P < ents.length) P *= 2; const R = Math.max(1, Math.log2(P)), order = seedOrder(P), who = s => (s <= ents.length ? ents[s - 1].user : null);
    this.sql.exec('DELETE FROM tgame WHERE tid=?', T.tid);
    for (let i = 0; i < P / 2; i++) this.sql.exec('INSERT INTO tgame (tid,rnd,slot,a,b,st) VALUES (?,?,?,?,?,?)', T.tid, 1, i, who(order[2 * i]), who(order[2 * i + 1]), 'wait');
    for (let r = 2; r <= R; r++) for (let i = 0; i < P >> r; i++) this.sql.exec('INSERT INTO tgame (tid,rnd,slot,st) VALUES (?,?,?,?)', T.tid, r, i, 'wait');
    if (R >= 2) this.sql.exec('INSERT INTO tgame (tid,rnd,slot,st) VALUES (?,?,?,?)', T.tid, R, 1, 'wait');             // the third-place game, played alongside the final
    this.tm('rounds', R); this.tm('size', P); this.tm('state', 'running'); this.tm('round', 0); this.tBump();
    this.tOpenRound(this.tCur(), 1, now);
  },
  tOpenRound(T, r, now) {                             // a new round: byes go through at once, everyone else gets a 5-minute check-in
    this.tm('round', r); this.tBump(); const ck = now + TOUR.checkInMinutes * 60000;
    for (const g of this.sql.exec('SELECT * FROM tgame WHERE tid=? AND rnd=? ORDER BY slot', T.tid, r).toArray()) {
      if (g.done) continue;
      if (g.a && g.b) this.sql.exec("UPDATE tgame SET st='checkin', ck=?, ready=? WHERE tid=? AND rnd=? AND slot=?", ck, now, T.tid, r, g.slot);
      else if (g.a || g.b) this.tResolve(T, g, g.a || g.b, null, null, 'bye');
      else this.tResolve(T, g, null, null, null, 'void');
    }
  },
  tResolve(T, g, w, sa, sb, how) {                    // a game is decided (once): record it, move the winner up, the semi-final loser to the 3rd-place game
    const cur = this.sql.exec('SELECT done FROM tgame WHERE tid=? AND rnd=? AND slot=?', T.tid, g.rnd, g.slot).toArray()[0]; if (!cur || cur.done) return;
    this.sql.exec("UPDATE tgame SET w=?, sa=?, sb=?, st='done', how=?, done=? WHERE tid=? AND rnd=? AND slot=?", w, sa, sb, how, T_NOW(), T.tid, g.rnd, g.slot); this.tBump();
    if (how === 'play' && g.a && g.b && w) this.sql.exec('INSERT INTO thist (a,b,w,ts) VALUES (?,?,?,?)', g.a, g.b, w, T_NOW());
    [g.a, g.b].forEach(u => { if (u && u !== w) this.sql.exec('UPDATE tent SET out=? WHERE tid=? AND user=?', g.rnd, T.tid, u); });
    const R = T.rounds; if (g.rnd >= R) return;
    const ns = g.slot >> 1, col = (g.slot % 2 === 0) ? 'a' : 'b';
    if (w) this.sql.exec('UPDATE tgame SET ' + col + '=? WHERE tid=? AND rnd=? AND slot=?', w, T.tid, g.rnd + 1, ns);
    if (g.rnd + 1 === R && R >= 2 && g.a && g.b && w && (how === 'play' || how === 'ff' || how === 'dispute' || how === 'owner' || how === 'noshow')) {
      const loser = w === g.a ? g.b : g.a; this.sql.exec('UPDATE tgame SET ' + col + '=? WHERE tid=? AND rnd=? AND slot=1', loser, T.tid, R); }
  },
  async tAdvance(now) {
    this.tEnsure(now);
    let T = this.tCur(); if (!T) return;
    if (T.state === 'signup' && now >= T.startAt) { await this.tBuild(T, now); T = this.tCur(); }
    for (let guard = 0; guard < 40 && T && T.state === 'running'; guard++) {
      const games = this.sql.exec('SELECT * FROM tgame WHERE tid=? AND rnd=? ORDER BY slot', T.tid, T.round).toArray();
      for (const g of games) {
        if (g.done) continue;
        if (g.st === 'checkin') {
          if (g.rda && g.rdb) { this.sql.exec("UPDATE tgame SET st='live', started=? WHERE tid=? AND rnd=? AND slot=?", now, T.tid, g.rnd, g.slot); this.tBump(); continue; }   // both ready: the game starts
          if (now >= g.ck) { if (g.rda || g.rdb) this.tResolve(T, g, g.rda ? g.a : g.b, null, null, 'ff'); else this.tResolve(T, g, null, null, null, 'dff'); }   // one showed: he advances; nobody: both out
          continue;
        }
        if (g.st === 'live') {
          const ra = g.ra ? JSON.parse(g.ra) : null, rb = g.rb ? JSON.parse(g.rb) : null;
          if (ra && rb) { const agree = ra.pf === rb.pa && ra.pa === rb.pf, v = agree ? ra : ra;     // they disagree: the host's report stands (the host runs the game)
            this.tResolve(T, g, v.pf > v.pa ? g.a : g.b, v.pf, v.pa, agree ? 'play' : 'dispute'); continue; }
          const one = ra || rb; if (one && now - one.ts > TOUR.noShowMinutes * 60000) { const v = ra || { pf: rb.pa, pa: rb.pf }; this.tResolve(T, g, v.pf > v.pa ? g.a : g.b, v.pf, v.pa, 'noshow'); continue; }
          if (!one && g.started && now - g.started > TOUR.gameMaxMinutes * 60000) this.tResolve(T, g, null, null, null, 'nores');
        }
      }
      const open = this.sql.exec('SELECT COUNT(*) c FROM tgame WHERE tid=? AND rnd=? AND done IS NULL', T.tid, T.round).toArray()[0].c;
      if (open) break;
      if (T.round < T.rounds) { this.tOpenRound(T, T.round + 1, now); T = this.tCur(); continue; }
      this.tFinish(T, now); T = this.tCur();
    }
    if (T && (T.state === 'done' || T.state === 'cancelled')) await this.tSettle(T);
  },
  tFinish(T, now) {                                    // the championship is over: places, champion, history
    const fin = this.sql.exec('SELECT * FROM tgame WHERE tid=? AND rnd=? AND slot=0', T.tid, T.rounds).toArray()[0], third = this.sql.exec('SELECT * FROM tgame WHERE tid=? AND rnd=? AND slot=1', T.tid, T.rounds).toArray()[0];
    const place = {}; if (fin && fin.w) { place[fin.w] = 1; const ru = fin.w === fin.a ? fin.b : fin.a; if (ru && fin.how !== 'dff') place[ru] = 2; }
    if (third && third.w) place[third.w] = 3;
    for (const u in place) this.sql.exec('UPDATE tent SET place=? WHERE tid=? AND user=?', place[u], T.tid, u);
    this.sql.exec('UPDATE tent SET prized=1 WHERE tid=? AND place IS NULL', T.tid);
    if (fin && fin.w) this.sql.exec('INSERT INTO tchamp (tid,user,ts) VALUES (?,?,?) ON CONFLICT DO NOTHING', T.tid, fin.w, now);
    this.tm('state', 'done'); this.tm('ended', now); this.tm('why', fin && fin.w ? '' : 'no champion (nobody showed up for the final)'); this.tBump();
  },
  async tSettle(T) {                                   // prizes once (the vault also refuses a second payout), LTD cards back from everyone - retried until all done
    for (const e of this.sql.exec('SELECT user, place, prized FROM tent WHERE tid=? AND place IS NOT NULL AND prized IS NULL', T.tid).toArray()) {
      const pz = TOUR.prize[e.place]; const r = pz ? await ivault(this.env, e.user, 'i_tprize', { tid: T.tid, place: e.place, prize: pz }).catch(() => null) : { ok: true };
      if (r && r.ok) { this.sql.exec('UPDATE tent SET prized=1 WHERE tid=? AND user=?', T.tid, e.user); this.tBump(); } }
    for (const e of this.sql.exec('SELECT user FROM tent WHERE tid=? AND dropped IS NULL', T.tid).toArray()) {
      const r = await ivault(this.env, e.user, 'i_tdrop', { tid: T.tid }).catch(() => null); if (r && r.ok) this.sql.exec('UPDATE tent SET dropped=1 WHERE tid=? AND user=?', T.tid, e.user); }
    this.tEnsure(T_NOW());
  },
  async tSchedule() {                                  // wake up at the next thing that can change on its own (the cron tick is the backup)
    const T = this.tCur(); if (!T) return; const now = T_NOW(); let at = null; const soon = t => { if (t && (at === null || t < at)) at = t; };
    if (T.state === 'signup') soon(T.startAt);
    if (T.state === 'running') for (const g of this.sql.exec('SELECT * FROM tgame WHERE tid=? AND rnd=? AND done IS NULL', T.tid, T.round).toArray()) {
      if (g.st === 'checkin') soon(g.ck);
      if (g.st === 'live') { const ra = g.ra ? JSON.parse(g.ra) : null, rb = g.rb ? JSON.parse(g.rb) : null, one = ra || rb; if (one && !(ra && rb)) soon(one.ts + TOUR.noShowMinutes * 60000); else if (!one && g.started) soon(g.started + TOUR.gameMaxMinutes * 60000); } }
    if (T.state === 'done' || T.state === 'cancelled') soon(T.ended + 30 * 60000 + 1000);
    if ((T.state === 'done' || T.state === 'cancelled') && this.sql.exec('SELECT 1 FROM tent WHERE tid=? AND (dropped IS NULL OR (place IS NOT NULL AND prized IS NULL))', T.tid).toArray().length) soon(now + 60000);
    if (at !== null) { try { await this.ctx.storage.setAlarm(Math.max(now + 500, at + 250)); } catch (e) {} }
  },
  tNotify() { const msg = JSON.stringify({ k: 'tour', ver: +this.tm('ver') || 0 }); try { for (const ws of this.ctx.getWebSockets('tour')) { try { ws.send(msg); } catch (e) {} } } catch (e) {} },
  tSocket(req) { const pair = new WebSocketPair(); this.ctx.acceptWebSocket(pair[1], ['tour']); try { pair[1].send(JSON.stringify({ k: 'tour', ver: +this.tm('ver') || 0 })); } catch (e) {} return new Response(null, { status: 101, webSocket: pair[0] }); },
  webSocketMessage(ws, m) { if (m === 'ping') { try { ws.send('pong'); } catch (e) {} } },
  webSocketClose(ws) { try { ws.close(); } catch (e) {} },
  tView(me) {
    const T = this.tCur(), now = T_NOW(), view = { now, tour: null };
    const champs = this.sql.exec('SELECT tid, user, ts FROM tchamp ORDER BY ts DESC LIMIT 8').toArray(), titles = this.sql.exec('SELECT user, COUNT(*) n FROM tchamp GROUP BY user ORDER BY n DESC, MIN(ts) LIMIT 10').toArray();
    const lt = this.tm('lasttid'), last = lt ? { tid: lt, places: this.sql.exec('SELECT user, place FROM tent WHERE tid=? AND place IS NOT NULL ORDER BY place', lt).toArray() } : null;
    if (!T) return Object.assign(view, { champs, titles, last });
    const ents = this.sql.exec('SELECT user, seed, wins, pf, place, out FROM tent WHERE tid=? ORDER BY COALESCE(seed, 999), ts', T.tid).toArray();
    const games = this.sql.exec('SELECT rnd, slot, a, b, w, sa, sb, st, ck, rda, rdb, how FROM tgame WHERE tid=? ORDER BY rnd, slot', T.tid).toArray().map(g => Object.assign(g, { rda: g.rda ? 1 : 0, rdb: g.rdb ? 1 : 0 }));
    const mine = games.find(g => !g.w && g.st !== 'done' && g.rnd === T.round && (g.a === me || g.b === me) && g.a && g.b), ent = ents.find(e => e.user === me);
    const myLtd = (this.sql.exec('SELECT ltd FROM tent WHERE tid=? AND user=?', T.tid, me).toArray()[0] || {}).ltd || null;
    view.tour = { tid: T.tid, state: T.state, fee: T.fee, startAt: T.startAt, round: T.round, rounds: T.rounds, size: T.size, ended: T.ended, why: T.why, ver: +this.tm('ver') || 0, entrants: ents, games, prize: TOUR.prize, checkInMinutes: TOUR.checkInMinutes,
      me: { entered: !!ent, ltd: myLtd, seed: ent ? ent.seed : null, out: ent ? ent.out : null, place: ent ? ent.place : null,
        game: mine ? { rnd: mine.rnd, slot: mine.slot, opp: mine.a === me ? mine.b : mine.a, host: mine.a === me, st: mine.st, ck: mine.ck, readyMe: mine.a === me ? mine.rda : mine.rdb, readyOpp: mine.a === me ? mine.rdb : mine.rda, gid: T.tid + 'r' + mine.rnd + 's' + mine.slot } : null } };
    return Object.assign(view, { champs, titles, last });
  }
};

// Matchmaking: a tiny queue. The first player waits, the second is paired with them and both get the same room code.
export class Matchmaker extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.env = env; this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS q (user TEXT PRIMARY KEY, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pair (user TEXT PRIMARY KEY, code TEXT NOT NULL, role TEXT NOT NULL, opp TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ecode (h TEXT PRIMARY KEY, ch TEXT NOT NULL, exp INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS eacct (h TEXT PRIMARY KEY, user TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS eticket (t TEXT PRIMARY KEY, h TEXT NOT NULL, exp INTEGER NOT NULL, used_by TEXT);
      CREATE TABLE IF NOT EXISTS erate (k TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lbs (user TEXT NOT NULL, per TEXT NOT NULL, k TEXT NOT NULL, v INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user, per, k));`); }
  // ---- leaderboards (this object used with the name 'lb'): online wins (verified by both players), and solo touchdowns (self-reported)
  lb(b, act) {
    const inc = (user, per, k, n) => { if (n > 0) this.sql.exec('INSERT INTO lbs (user,per,k,v) VALUES (?,?,?,?) ON CONFLICT(user,per,k) DO UPDATE SET v=v+?', user, per, k, n, n); };
    if (act === 'lbadd') {
      const u = String(b.user || '').slice(0, 20), w = String(b.week || ''); if (!u || !/^w\d{4}-\d\d-\d\d$/.test(w)) return j({ ok: false }, 400);
      for (const per of [w, 'all']) { if (b.vs) { inc(u, per, 'og', 1); if (b.win) inc(u, per, 'ow', 1); } else { inc(u, per, 'sg', 1); if (b.win) inc(u, per, 'sw', 1); inc(u, per, 'std', Math.min(60, b.td | 0)); } }
      this.sql.exec("DELETE FROM lbs WHERE per<>'all' AND per < ?", new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10).replace(/^/, 'w'));
      return j({ ok: true });
    }
    const BOARDS = { ow_week: ['ow', 'week'], ow_all: ['ow', 'all'], std_week: ['std', 'week'] }, d = BOARDS[b.board]; if (!d) return j({ ok: false, err: 'no such board' }, 400);
    const per = d[1] === 'all' ? 'all' : String(b.week || ''), me = String(b.user || '');
    const top = this.sql.exec('SELECT user, v FROM lbs WHERE per=? AND k=? AND v>0 ORDER BY v DESC, user LIMIT 10', per, d[0]).toArray();
    const mine = this.sql.exec('SELECT v FROM lbs WHERE per=? AND k=? AND user=?', per, d[0], me).toArray()[0];
    const rank = mine && mine.v > 0 ? 1 + this.sql.exec('SELECT COUNT(*) c FROM lbs WHERE per=? AND k=? AND (v>? OR (v=? AND user<?))', per, d[0], mine.v, mine.v, me).toArray()[0].c : 0;
    return j({ ok: true, board: b.board, top, me: { rank, v: mine ? mine.v : 0 } });
  }
  // ---- email sign-up (this object is used with the name 'email', separate from the matchmaking queue 'mm')
  async email(b, act, now) {
    const PEP = this.env.EMAIL_PEPPER || 'ut-email-v1';
    this.sql.exec('DELETE FROM erate WHERE ts<?', now - 86400000); this.sql.exec('DELETE FROM ecode WHERE exp<?', now); this.sql.exec('DELETE FROM eticket WHERE exp<?', now);
    if (act === 'estart' || act === 'echeck') {
      const ne = normEmail(b.email); if (!ne) return j({ ok: false, err: 'enter a real email address' }, 400);
      if (DISPOSABLE_BLOCK(ne.domain)) return j({ ok: false, err: 'use your real email, not a throwaway one' }, 400);
      const h = await sha(ne.n + '|' + PEP);
      if (this.sql.exec('SELECT 1 FROM eacct WHERE h=?', h).toArray().length) return j({ ok: false, err: 'that email already has an account' }, 409);
      if (act === 'estart') {
        const ip = String(b.ip || 'x'), cnt = (k, since) => this.sql.exec('SELECT COUNT(*) c FROM erate WHERE k=? AND ts>?', k, since).toArray()[0].c;
        const old = this.sql.exec('SELECT sent FROM ecode WHERE h=?', h).toArray()[0]; if (old && now - old.sent < 30000) return j({ ok: false, err: 'wait 30 seconds before asking for another code' }, 429);
        if (cnt('e:' + h, now - 3600000) >= 5) return j({ ok: false, err: 'too many codes for that email - try again in an hour' }, 429);
        if (cnt('i:' + ip, now - 3600000) >= 15 || cnt('i:' + ip, now - 86400000) >= 60) return j({ ok: false, err: 'too many sign-up tries from this network - try again later' }, 429);
        const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
        const m = await sendMail(this.env, String(b.email).trim(), code); if (!m.ok) return j({ ok: false, err: m.err || 'could not send the email' }, m.err && /not set up/.test(m.err) ? 503 : 502);
        this.sql.exec('INSERT OR REPLACE INTO ecode (h,ch,exp,tries,sent) VALUES (?,?,?,0,?)', h, await sha(code + '|' + h), now + 600000, now);
        this.sql.exec('INSERT INTO erate (k,ts) VALUES (?,?),(?,?)', 'e:' + h, now, 'i:' + ip, now);
        return j(m.dev ? { ok: true, devCode: m.dev } : { ok: true });
      }
      const row = this.sql.exec('SELECT * FROM ecode WHERE h=?', h).toArray()[0]; if (!row) return j({ ok: false, err: 'that code expired - ask for a new one' }, 410);
      if (row.tries >= 5) { this.sql.exec('DELETE FROM ecode WHERE h=?', h); return j({ ok: false, err: 'too many wrong tries - ask for a new code' }, 429); }
      if (row.ch !== await sha(String(b.code || '').replace(/\D/g, '') + '|' + h)) { this.sql.exec('UPDATE ecode SET tries=tries+1 WHERE h=?', h); return j({ ok: false, err: 'wrong code' }, 400); }
      this.sql.exec('DELETE FROM ecode WHERE h=?', h);
      const t = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
      this.sql.exec('INSERT INTO eticket (t,h,exp,used_by) VALUES (?,?,?,NULL)', t, h, now + 1800000);
      return j({ ok: true, ticket: t });
    }
    const t = String(b.ticket || ''), row = this.sql.exec('SELECT * FROM eticket WHERE t=?', t).toArray()[0];
    if (act === 'eclaim') {
      if (!row) return j({ ok: false, err: 'verify your email first (the code may have expired)' }, 403);
      if (this.sql.exec('SELECT 1 FROM eacct WHERE h=?', row.h).toArray().length) return j({ ok: false, err: 'that email already has an account' }, 409);
      if (row.used_by && row.used_by !== b.user) return j({ ok: false, err: 'that verification was already used' }, 409);
      this.sql.exec('UPDATE eticket SET used_by=? WHERE t=?', b.user, t); return j({ ok: true });
    }
    if (act === 'erelease') { if (row && row.used_by === b.user) this.sql.exec('UPDATE eticket SET used_by=NULL WHERE t=?', t); return j({ ok: true }); }
    if (act === 'ebind') { if (row && row.used_by === b.user) { this.sql.exec('INSERT OR REPLACE INTO eacct (h,user,ts) VALUES (?,?,?)', row.h, b.user, now); this.sql.exec('DELETE FROM eticket WHERE t=?', t); } return j({ ok: true }); }
    return j({ ok: false, err: 'unknown' }, 404);
  }
  async fetch(req) {
    if (req.headers.get('Upgrade') === 'websocket') { this.tInit(); return this.tSocket(req); }       // the live tournament feed
    const b = await req.json(), act = new URL(req.url).pathname.split('/').pop(), now = Date.now();
    if (/^e(start|check|claim|release|bind)$/.test(act)) return this.email(b, act, now);
    if (act === 'lbadd' || act === 'lbget') return this.lb(b, act);
    if (/^t(get|create|join|leave|report|admin|ready|tick)$/.test(act)) return this.tFetch(act, b);
    if (act === 'fget' || act === 'fset') {                          // player faces (this object used with the name 'faces'): player id -> one of the 100 faces
      this.sql.exec('CREATE TABLE IF NOT EXISTS fmap (pid TEXT PRIMARY KEY, face INTEGER NOT NULL)');
      if (act === 'fset') { const pid = String(b.pid || '').slice(0, 40), face = Math.floor(+b.face); if (!/^[A-Za-z0-9_:-]{3,40}$/.test(pid)) return j({ ok: false, err: 'bad player id' }, 400);
        if (face < 0) this.sql.exec('DELETE FROM fmap WHERE pid=?', pid); else if (face <= 99) this.sql.exec('INSERT INTO fmap (pid, face) VALUES (?,?) ON CONFLICT(pid) DO UPDATE SET face=excluded.face', pid, face); else return j({ ok: false, err: 'faces are 0-99' }, 400); }
      const map = {}; this.sql.exec('SELECT pid, face FROM fmap').toArray().forEach(r => { map[r.pid] = r.face; }); return j({ ok: true, map });
    }
    this.sql.exec('DELETE FROM q WHERE ts<?', now - MATCH.queueSeconds * 1000);
    this.sql.exec('DELETE FROM pair WHERE ts<?', now - 120000);
    if (act === 'mcancel') { this.sql.exec('DELETE FROM q WHERE user=?', b.user); return j({ ok: true }); }
    const pr = this.sql.exec('SELECT * FROM pair WHERE user=?', b.user).toArray()[0];
    if (pr) { this.sql.exec('DELETE FROM pair WHERE user=?', b.user); return j({ ok: true, paired: true, code: pr.code, role: pr.role, opp: pr.opp }); }
    if (act === 'mqueue' || act === 'mpoll') {
      const other = this.sql.exec('SELECT * FROM q WHERE user<>? ORDER BY ts LIMIT 1', b.user).toArray()[0];
      if (other && act === 'mqueue') {
        this.sql.exec('DELETE FROM q WHERE user IN (?,?)', other.user, b.user);
        const code = 'm' + [...crypto.getRandomValues(new Uint8Array(4))].map(x => (x % 26 + 10).toString(36)).join('');   // matches the party code rules (letters/numbers)
        this.sql.exec('INSERT OR REPLACE INTO pair (user,code,role,opp,ts) VALUES (?,?,?,?,?)', other.user, code, 'host', b.user, now);
        return j({ ok: true, paired: true, code, role: 'guest', opp: other.user });
      }
      this.sql.exec('INSERT OR REPLACE INTO q (user, ts) VALUES (?,?)', b.user, now);
      return j({ ok: true, paired: false });
    }
    return j({ ok: false, err: 'unknown' }, 404);
  }
}
Object.assign(Matchmaker.prototype, tourMethods);   // the tournament methods live on the same object (name 'tour')
