// Player-to-player trades. One Trade object per trade. Both players build an offer, and BOTH must type their account password and press accept
// on the SAME version of the two offers. Any change to either offer wipes both accepts. The swap itself holds both sides' cards in escrow first,
// so a card can never be duplicated or lost: it is either still with its owner or in escrow, and delivery is idempotent.
import { DurableObject } from 'cloudflare:workers';
import { TRADE } from './ut_config.js';

const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const iv = async (env, user, act, body) => { const r = await env.VAULT.get(env.VAULT.idFromName('ut:' + user)).fetch('https://vault/' + act, { method: 'POST', body: JSON.stringify(Object.assign({ user }, body || {})) }); const o = await r.json().catch(() => ({ ok: false })); o.status = r.status; return o; };

export class Trade extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = env; this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS tr (id INTEGER PRIMARY KEY CHECK (id=1), tid TEXT, a TEXT, b TEXT, oa TEXT, ob TEXT, acca INTEGER, accb INTEGER, ver INTEGER, status TEXT, note TEXT, pend TEXT, created INTEGER)');
  }
  row() { return this.sql.exec('SELECT * FROM tr WHERE id=1').toArray()[0] || null; }
  side(t, user) { return user === t.a ? 'a' : user === t.b ? 'b' : null; }
  view(t, user) {
    const me = this.side(t, user), th = me === 'a' ? 'b' : 'a';
    return { ok: true, id: t.tid, status: t.status, note: t.note || '', ver: t.ver, partner: t[th], mine: JSON.parse(t['o' + me]), theirs: JSON.parse(t['o' + th]), iAccepted: !!t['acc' + me], theyAccepted: !!t['acc' + th] };
  }
  async setStatus(t, status, note) {
    this.sql.exec('UPDATE tr SET status=?, note=? WHERE id=1', status, note || '');
    for (const [u, o] of [[t.a, t.b], [t.b, t.a]]) await iv(this.env, u, 'i_tlink', { tid: t.tid, other: o, status });
  }
  async fetch(req) {
    const b = await req.json(), act = new URL(req.url).pathname.split('/').pop(); let t = this.row();
    if (act === 'open') {
      if (t) return j({ ok: false, err: 'exists' }, 409);
      this.sql.exec("INSERT INTO tr (id,tid,a,b,oa,ob,acca,accb,ver,status,note,pend,created) VALUES (1,?,?,?,'[]','[]',0,0,1,'open','','',?)", b.tid, b.a, b.b, Date.now());
      await iv(this.env, b.a, 'i_tlink', { tid: b.tid, other: b.b, status: 'open' }); await iv(this.env, b.b, 'i_tlink', { tid: b.tid, other: b.a, status: 'invited' });
      return j(this.view(this.row(), b.a));
    }
    if (!t) return j({ ok: false, err: 'no such trade' }, 404);
    if (!this.side(t, b.user)) return j({ ok: false, err: 'not your trade' }, 403);
    if (t.status === 'committing') await this.finish(t);                                            // a delivery was interrupted: finish it
    t = this.row();
    if (t.status === 'open' && Date.now() - t.created > TRADE.expireMinutes * 60000) { await this.setStatus(t, 'expired', 'trade expired'); t = this.row(); }
    if (act === 'tradeget' || act === 'get') return j(this.view(t, b.user));
    if (t.status !== 'open') return j({ ...this.view(t, b.user), ok: false, err: 'this trade is ' + t.status }, 409);
    const me = this.side(t, b.user);
    if (act === 'cancel') { await this.setStatus(t, 'cancelled', b.user + ' cancelled'); return j(this.view(this.row(), b.user)); }
    if (act === 'set') {
      const r = await iv(this.env, b.user, 'i_thas', { uids: Array.isArray(b.uids) ? b.uids.slice(0, TRADE.maxCards) : [] });
      this.sql.exec('UPDATE tr SET o' + me + '=?, acca=0, accb=0, ver=ver+1, note=? WHERE id=1', JSON.stringify(r.cards || []), '');   // any change wipes BOTH accepts
      return j(this.view(this.row(), b.user));
    }
    if (act === 'accept') {
      if (+b.ver !== t.ver) return j({ ...this.view(t, b.user), ok: false, err: 'the trade changed - look again, then accept' }, 409);
      if (JSON.parse(t.oa).length + JSON.parse(t.ob).length < 1) return j({ ok: false, err: 'nobody is offering anything' }, 400);
      const v = await iv(this.env, b.user, 'i_verify', { pass: b.pass });                           // the player must type the password for THIS accept
      if (!v.ok) return j({ ok: false, err: v.err || 'wrong password' }, v.status || 401);
      this.sql.exec('UPDATE tr SET acc' + me + '=1 WHERE id=1'); t = this.row();
      if (t.acca && t.accb) return await this.execute(t, b.user);
      return j(this.view(t, b.user));
    }
    return j({ ok: false, err: 'unknown' }, 404);
  }
  async execute(t, user) {
    const ua = JSON.parse(t.oa).map(c => c.uid), ub = JSON.parse(t.ob).map(c => c.uid);
    const reopen = async (why) => { this.sql.exec("UPDATE tr SET acca=0, accb=0, ver=ver+1, note=? WHERE id=1", why); return j({ ...this.view(this.row(), user), ok: false, err: why }, 409); };
    const A = ua.length ? await iv(this.env, t.a, 'i_tlock', { tid: t.tid, uids: ua }) : { ok: true, cards: [] };
    if (!A.ok) return await reopen(t.a + ' no longer has every card in the offer');
    const B = ub.length ? await iv(this.env, t.b, 'i_tlock', { tid: t.tid, uids: ub }) : { ok: true, cards: [] };
    if (!B.ok) { await iv(this.env, t.a, 'i_tabort', { tid: t.tid }); return await reopen(t.b + ' no longer has every card in the offer'); }
    this.sql.exec("UPDATE tr SET status='committing', pend=? WHERE id=1", JSON.stringify({ toA: B.cards, toB: A.cards }));   // from here on the swap can only be finished, never undone
    await this.finish(this.row());
    return j(this.view(this.row(), user));
  }
  async finish(t) {
    const p = JSON.parse(t.pend || '{}'); if (!p.toA) return;
    const x = await iv(this.env, t.a, 'i_tcommit', { tid: t.tid, get: p.toA }), y = await iv(this.env, t.b, 'i_tcommit', { tid: t.tid, get: p.toB });
    if (x.ok && y.ok) { this.sql.exec("UPDATE tr SET pend='' WHERE id=1"); await this.setStatus(this.row(), 'done', 'trade complete'); }
  }
}
