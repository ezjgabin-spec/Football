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
      const s = await ivault(this.env, b.user, 'i_snap', { tour: /^tr/.test(String(b.mid || '')) });   // a tournament game: your LTD player plays
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


// ---- TOURNAMENTS (this object used with the name 'tour'). One tournament at a time; anyone with the start code opens one.
const T_NOW = () => Date.now();
function seedOrder(P){ let o = [1]; while (o.length < P) { const n = o.length * 2; o = o.flatMap(s => [s, n + 1 - s]); } return o; }
export const tourMethods = {
  tInit() { if (this._tinit) return; this._tinit = true;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS tmeta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS tent (tid TEXT NOT NULL, user TEXT NOT NULL, ts INTEGER NOT NULL, seed INTEGER, wins INTEGER, pf INTEGER, ltd TEXT, place INTEGER, PRIMARY KEY (tid, user));
      CREATE TABLE IF NOT EXISTS tgame (tid TEXT NOT NULL, rnd INTEGER NOT NULL, slot INTEGER NOT NULL, a TEXT, b TEXT, w TEXT, sa INTEGER, sb INTEGER, ra TEXT, rb TEXT, ready INTEGER, PRIMARY KEY (tid, rnd, slot));
      CREATE TABLE IF NOT EXISTS thist (a TEXT NOT NULL, b TEXT NOT NULL, w TEXT NOT NULL, ts INTEGER NOT NULL);`); },
  tm(k, v) { if (v === undefined) { const r = this.sql.exec('SELECT v FROM tmeta WHERE k=?', k).toArray()[0]; return r ? r.v : null; } this.sql.exec('INSERT INTO tmeta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, String(v)); },
  tCur() { const tid = this.tm('tid'); if (!tid) return null; return { tid, state: this.tm('state'), fee: +this.tm('fee') || 0, signupEnd: +this.tm('signupEnd') || 0, startAt: +this.tm('startAt') || 0, by: this.tm('by'), rounds: +this.tm('rounds') || 0, size: +this.tm('size') || 0 }; },
  async tFetch(act, b) {
    this.tInit(); const now = T_NOW(), me = String(b.user || '');
    await this.tAdvance(now);
    if (act === 'tcreate') {
      if (String(b.code || '') !== TOUR.code) return j({ ok: false, err: 'wrong tournament code' }, 403);
      const T = this.tCur(); if (T && T.state !== 'done' && T.state !== 'cancelled') return j({ ok: false, err: 'a tournament is already on' }, 409);
      const fee = Math.max(0, Math.min(TOUR.maxFee, Math.floor(+b.fee || 0))), sm = Math.max(TOUR.signupMin[0], Math.min(TOUR.signupMin[1], Math.floor(+b.signupMin || 10))), sd = Math.max(TOUR.startDelayMin[0], Math.min(TOUR.startDelayMin[1], Math.floor(+b.startDelayMin || 1)));
      const tid = 't' + now.toString(36);
      this.tm('tid', tid); this.tm('state', 'signup'); this.tm('fee', fee); this.tm('signupEnd', now + sm * 60000); this.tm('startAt', now + (sm + sd) * 60000); this.tm('by', me); this.tm('rounds', 0); this.tm('size', 0);
      return j({ ok: true, ...this.tView(me) });
    }
    const T = this.tCur();
    if (act === 'tget') return j({ ok: true, ...this.tView(me) });
    if (!T) return j({ ok: false, err: 'no tournament right now' }, 409);
    if (act === 'tjoin') {
      if (T.state !== 'signup') return j({ ok: false, err: 'sign-up is closed' }, 409);
      if (this.sql.exec('SELECT 1 FROM tent WHERE tid=? AND user=?', T.tid, me).toArray().length) return j({ ok: true, ...this.tView(me) });
      const f = await ivault(this.env, me, 'i_tfee', { fee: T.fee, tid: T.tid }); if (!f.ok) return j({ ok: false, err: f.err || 'could not pay the entry fee' }, 402);
      const l = await ivault(this.env, me, 'i_tltd', { tid: T.tid });
      this.sql.exec('INSERT INTO tent (tid,user,ts,ltd) VALUES (?,?,?,?)', T.tid, me, now, l && l.card ? l.card.pid : '');
      return j({ ok: true, ltd: l && l.card, ...this.tView(me), state: f.state || null });
    }
    if (act === 'tleave') {
      if (T.state !== 'signup') return j({ ok: false, err: 'the bracket is already set' }, 409);
      if (!this.sql.exec('SELECT 1 FROM tent WHERE tid=? AND user=?', T.tid, me).toArray().length) return j({ ok: true, ...this.tView(me) });
      this.sql.exec('DELETE FROM tent WHERE tid=? AND user=?', T.tid, me); await ivault(this.env, me, 'i_trefund', { fee: T.fee, tid: T.tid }); await ivault(this.env, me, 'i_tdrop', { tid: T.tid });
      return j({ ok: true, ...this.tView(me) });
    }
    if (act === 'treport') {
      if (T.state !== 'running') return j({ ok: false, err: 'not running' }, 409);
      const g = this.sql.exec('SELECT * FROM tgame WHERE tid=? AND w IS NULL AND a IS NOT NULL AND b IS NOT NULL AND (a=? OR b=?)', T.tid, me, me).toArray()[0]; if (!g) return j({ ok: false, err: 'you have no game to report' }, 409);
      const pf = Math.floor(+b.pf), pa = Math.floor(+b.pa); if (!(pf >= 0 && pf <= 200 && pa >= 0 && pa <= 200) || pf === pa) return j({ ok: false, err: 'bad score (tournament games need a winner)' }, 400);
      const rep = JSON.stringify({ pf, pa, ts: now }), col = g.a === me ? 'ra' : 'rb'; this.sql.exec('UPDATE tgame SET ' + col + '=? WHERE tid=? AND rnd=? AND slot=?', rep, T.tid, g.rnd, g.slot);
      await this.tAdvance(T_NOW()); return j({ ok: true, ...this.tView(me) });
    }
    if (act === 'tadmin') {                                   // the code holder can cancel, or settle a disputed / abandoned game
      if (String(b.code || '') !== TOUR.code) return j({ ok: false, err: 'wrong tournament code' }, 403);
      if (b.op === 'cancel') { for (const e of this.sql.exec('SELECT user FROM tent WHERE tid=?', T.tid).toArray()) { await ivault(this.env, e.user, 'i_trefund', { fee: T.fee, tid: T.tid }); await ivault(this.env, e.user, 'i_tdrop', { tid: T.tid }); } this.tm('state', 'cancelled'); return j({ ok: true, ...this.tView(me) }); }
      if (b.op === 'win') { const g = this.sql.exec('SELECT * FROM tgame WHERE tid=? AND w IS NULL AND (a=? OR b=?)', T.tid, String(b.winner || ''), String(b.winner || '')).toArray()[0]; if (!g) return j({ ok: false, err: 'no open game for that player' }, 409); this.tSet(T, g, String(b.winner), null, null); await this.tAdvance(T_NOW()); return j({ ok: true, ...this.tView(me) }); }
      if (b.op === 'startnow' && T.state === 'signup') { this.tm('signupEnd', now); this.tm('startAt', now); await this.tAdvance(T_NOW()); return j({ ok: true, ...this.tView(me) }); }
      return j({ ok: false, err: 'unknown admin op' }, 400);
    }
    return j({ ok: false, err: 'unknown' }, 404);
  },
  tView(me) {
    const T = this.tCur(), now = T_NOW(); if (!T) return { tour: null, now };
    const ents = this.sql.exec('SELECT user, seed, wins, pf, place FROM tent WHERE tid=? ORDER BY COALESCE(seed, 999), ts', T.tid).toArray();
    const games = this.sql.exec('SELECT rnd, slot, a, b, w, sa, sb, ready FROM tgame WHERE tid=? ORDER BY rnd, slot', T.tid).toArray();
    const mine = games.find(g => !g.w && g.a && g.b && (g.a === me || g.b === me));
    const myLtd = (this.sql.exec('SELECT ltd FROM tent WHERE tid=? AND user=?', T.tid, me).toArray()[0] || {}).ltd || null;
    return { tour: { tid: T.tid, state: T.state, fee: T.fee, signupEnd: T.signupEnd, startAt: T.startAt, by: T.by, rounds: T.rounds, size: T.size, entrants: ents, games, prize: TOUR.prize,
      me: { entered: ents.some(e => e.user === me), ltd: myLtd, game: mine ? { rnd: mine.rnd, slot: mine.slot, opp: mine.a === me ? mine.b : mine.a, host: mine.a === me, gid: T.tid + 'r' + mine.rnd + 's' + mine.slot } : null } }, now };
  },
  tSet(T, g, w, sa, sb) {
    this.sql.exec('UPDATE tgame SET w=?, sa=?, sb=? WHERE tid=? AND rnd=? AND slot=?', w, sa, sb, T.tid, g.rnd, g.slot);
    if (g.a && g.b) this.sql.exec('INSERT INTO thist (a,b,w,ts) VALUES (?,?,?,?)', g.a, g.b, w, T_NOW());
    if (g.rnd < T.rounds && !(g.rnd === T.rounds && g.slot === 1)) {                               // the winner moves on
      const ns = g.slot >> 1, col = (g.slot % 2 === 0) ? 'a' : 'b';
      this.sql.exec('INSERT INTO tgame (tid,rnd,slot) VALUES (?,?,?) ON CONFLICT DO NOTHING', T.tid, g.rnd + 1, ns);
      this.sql.exec('UPDATE tgame SET ' + col + '=? WHERE tid=? AND rnd=? AND slot=?', w, T.tid, g.rnd + 1, ns);
      if (g.rnd + 1 === T.rounds && T.rounds >= 2 && g.a && g.b) {                                 // a semi-final loser goes to the third-place game
        const loser = w === g.a ? g.b : g.a; this.sql.exec('INSERT INTO tgame (tid,rnd,slot) VALUES (?,?,1) ON CONFLICT DO NOTHING', T.tid, T.rounds);
        this.sql.exec('UPDATE tgame SET ' + col + '=? WHERE tid=? AND rnd=? AND slot=1', loser, T.tid, T.rounds); }
    }
  },
  async tBuild(T, now) {                                       // seed the field, place byes, open round 1
    const ents = this.sql.exec('SELECT user, ts FROM tent WHERE tid=?', T.tid).toArray();
    if (ents.length < 2) { for (const e of ents) { await ivault(this.env, e.user, 'i_trefund', { fee: T.fee, tid: T.tid }); await ivault(this.env, e.user, 'i_tdrop', { tid: T.tid }); } this.tm('state', 'cancelled'); this.tm('why', 'not enough players'); return; }
    for (const e of ents) { const r = await ivault(this.env, e.user, 'i_tstats', {}).catch(() => null); const st = (r && r.stats) || {}; e.wins = st.wins | 0; e.pf = st.pf | 0; }
    const H = this.sql.exec('SELECT a, b, w FROM thist').toArray();
    const byWins = {}; ents.forEach(e => { (byWins[e.wins] = byWins[e.wins] || []).push(e); });
    Object.values(byWins).forEach(grp => { const names = new Set(grp.map(e => e.user)); grp.forEach(e => { e.h2h = H.filter(h => h.w === e.user && names.has(h.a) && names.has(h.b)).length; }); });
    ents.sort((x, y) => y.wins - x.wins || y.h2h - x.h2h || y.pf - x.pf || x.ts - y.ts);   // total wins, then head-to-head among the tied, then points scored
    ents.forEach((e, i) => this.sql.exec('UPDATE tent SET seed=?, wins=?, pf=? WHERE tid=? AND user=?', i + 1, e.wins, e.pf, T.tid, e.user));
    let P = 1; while (P < ents.length) P *= 2; const R = Math.log2(P), order = seedOrder(P), who = s => (s <= ents.length ? ents[s - 1].user : null);
    this.tm('rounds', R); this.tm('size', P); this.tm('state', 'running'); const T2 = this.tCur();
    for (let i = 0; i < P / 2; i++) { const a = who(order[2 * i]), b = who(order[2 * i + 1]); this.sql.exec('INSERT INTO tgame (tid,rnd,slot,a,b,ready) VALUES (?,?,?,?,?,?)', T.tid, 1, i, a, b, now);
      if (!a || !b) this.tSet(T2, { rnd: 1, slot: i, a, b }, a || b, null, null); }        // a bye: the top seeds go straight through
  },
  async tAdvance(now) {
    const T = this.tCur(); if (!T) return;
    if (T.state === 'signup' && now >= T.startAt) { await this.tBuild(T, now); }
    const T2 = this.tCur(); if (!T2 || T2.state !== 'running') return;
    for (const g of this.sql.exec('SELECT * FROM tgame WHERE tid=? AND w IS NULL AND a IS NOT NULL AND b IS NOT NULL', T2.tid).toArray()) {
      if (!g.ready) this.sql.exec('UPDATE tgame SET ready=? WHERE tid=? AND rnd=? AND slot=?', now, T2.tid, g.rnd, g.slot);
      const ra = g.ra ? JSON.parse(g.ra) : null, rb = g.rb ? JSON.parse(g.rb) : null;
      if (ra && rb) { if (ra.pf === rb.pa && ra.pa === rb.pf) this.tSet(T2, g, ra.pf > ra.pa ? g.a : g.b, ra.pf, ra.pa); continue; }   // both agree: it counts (a dispute waits for the code holder)
      const one = ra || rb; if (one && now - one.ts > TOUR.noShowMinutes * 60000) { const aView = ra ? ra : { pf: rb.pa, pa: rb.pf }; this.tSet(T2, g, aView.pf > aView.pa ? g.a : g.b, aView.pf, aView.pa); }
    }
    // finished? (the final and, when there is one, the third-place game)
    const fin = this.sql.exec('SELECT * FROM tgame WHERE tid=? AND rnd=? AND slot=0', T2.tid, T2.rounds).toArray()[0], third = this.sql.exec('SELECT * FROM tgame WHERE tid=? AND rnd=? AND slot=1', T2.tid, T2.rounds).toArray()[0];
    if (!fin || !fin.w || (third && !third.w)) return;
    const place = {}; place[fin.w] = 1; const ru = fin.w === fin.a ? fin.b : fin.a; if (ru) place[ru] = 2;
    if (third && third.w) place[third.w] = 3; else if (T2.rounds >= 2) { const semis = this.sql.exec('SELECT * FROM tgame WHERE tid=? AND rnd=?', T2.tid, T2.rounds - 1).toArray(); const l = semis.map(g => g.w === g.a ? g.b : g.a).filter(Boolean); if (l.length === 1) place[l[0]] = 3; }
    this.tm('state', 'done');
    for (const e of this.sql.exec('SELECT user FROM tent WHERE tid=?', T2.tid).toArray()) {
      const pl = place[e.user] || 0; this.sql.exec('UPDATE tent SET place=? WHERE tid=? AND user=?', pl || null, T2.tid, e.user);
      await ivault(this.env, e.user, 'i_tdrop', { tid: T2.tid });                                                        // everyone gives the LTD card back
      if (pl && TOUR.prize[pl]) await ivault(this.env, e.user, 'i_tprize', { tid: T2.tid, place: pl, prize: TOUR.prize[pl] });
    }
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
    const b = await req.json(), act = new URL(req.url).pathname.split('/').pop(), now = Date.now();
    if (/^e(start|check|claim|release|bind)$/.test(act)) return this.email(b, act, now);
    if (act === 'lbadd' || act === 'lbget') return this.lb(b, act);
    if (/^t(get|create|join|leave|report|admin)$/.test(act)) return this.tFetch(act, b);
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
