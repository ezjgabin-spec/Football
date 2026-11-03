// Online Ultimate Team matches. One Match object per match id. It loads both players' saved teams FROM THE SERVER
// (never from the browser), and only pays out when both players report the same final score.
import { DurableObject } from 'cloudflare:workers';
import { MATCH, WAGER } from './ut_config.js';

const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
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
      const s = await ivault(this.env, b.user, 'i_snap');
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
      const r = await ivault(this.env, b.user, 'i_wlock', { mid: String(b.mid), amount: amt });
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
        await ivault(this.env, r.user, 'i_pay', Object.assign({ mid: String(b.mid), pf: r.pf, pa: r.pa, wager: W.both, oy: (o.ry || 0) + (o.py || 0), tda: theirs.ptd || 0, rtda: theirs.rtd || 0 }, mine));
        if (r.stake > 0) { const res = W.both ? (r.pf > r.pa ? 'win' : r.pf < r.pa ? 'lose' : 'refund') : 'refund'; const w = await ivault(this.env, r.user, 'i_wsettle', { mid: String(b.mid), result: res }); this.sql.exec("INSERT OR REPLACE INTO mm (k,v) VALUES (?,?)", 'wn:' + r.user, String(w.net || 0)); }
      }
    }
    const mine = await ivault(this.env, b.user, 'i_pay', { mid: String(b.mid), pf: a.pf, pa: a.pa, peek: true });
    const wn = this.sql.exec("SELECT v FROM mm WHERE k=?", 'wn:' + b.user).toArray()[0];
    return j({ ok: true, status: 'settled', paid: mine.paid, xp: mine.xp || 0, why: mine.why === 'already paid' ? '' : mine.why, wagered: W.both, wagerNet: wn ? +wn.v : 0, ...mine.stateOut });
  }
}

// Matchmaking: a tiny queue. The first player waits, the second is paired with them and both get the same room code.
export class Matchmaker extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS q (user TEXT PRIMARY KEY, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pair (user TEXT PRIMARY KEY, code TEXT NOT NULL, role TEXT NOT NULL, opp TEXT NOT NULL, ts INTEGER NOT NULL);`); }
  async fetch(req) {
    const b = await req.json(), act = new URL(req.url).pathname.split('/').pop(), now = Date.now();
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
