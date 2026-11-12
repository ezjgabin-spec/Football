// One Vault per account (a Durable Object with its own SQLite). Everything that matters - balance, cards,
// packs, rewards - lives here and is only changed by this code. A Durable Object runs one request at a time,
// so two requests can never spend the same coins or open the same pack twice.
import { DurableObject } from 'cloudflare:workers';
import { UT, LINES, KICKERS, MATCH, SELL, STARTER, TRADE, UPGRADE, WAGER, PASS, XF, CHALLENGES, SEASON, DRAFT, DEV, TOUR } from './ut_config.js';
import { PLAYERS } from './ut_players.js';
const TEAMS = new Set(Object.values(PLAYERS).map(p => p.team).filter(Boolean));
import { CATALOG } from './ut_catalog.js';

const enc = new TextEncoder();
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
const rnd = n => { const a = new Uint32Array(1), lim = Math.floor(0x100000000 / n) * n; do { crypto.getRandomValues(a); } while (a[0] >= lim); return a[0] % n; };   // unbiased
const uid = () => hex(crypto.getRandomValues(new Uint8Array(8)));
const today = () => new Date().toISOString().slice(0, 10);
async function pbkdf2(pass, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)));
}
async function sha(s) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))); }
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

function pickWeighted(w) {
  const keys = Object.keys(w), tot = keys.reduce((s, k) => s + Math.round(w[k] * 1000), 0); let r = rnd(tot);
  for (const k of keys) { r -= Math.round(w[k] * 1000); if (r < 0) return k; }
  return keys[keys.length - 1];
}
const TIER_ORDER = ['S', 'A', 'B', 'C', 'D'];
function eligible(tier, pos) { return CATALOG.filter(p => p[1] === tier && (!pos || p[2] === pos) && !UT.excludedPositions.includes(p[2]) && !UT.blockedIds.includes(p[0]) && !p[0].startsWith(KICKERS.shopPrefix)); }
export function rollCard(pack, pos) {
  let tier = pickWeighted(pack.tierWeights), pool = eligible(tier, pos);
  if (tier === 'S' && rnd(100) < 40) { const lg = eligible('LG', pos); if (lg.length) { tier = 'LG'; pool = lg; } }   // LEGEND cards: 4 in 10 of the S-tier pulls
  for (let i = TIER_ORDER.indexOf(tier); !pool.length && i < TIER_ORDER.length - 1;) pool = eligible(TIER_ORDER[++i], pos);   // an empty tier falls back downward
  const p = pool[rnd(pool.length)];
  return { pid: p[0], tier: p[1], rarity: pickWeighted(pack.rarityWeights || UT.rarityWeights) };
}

// what a pack actually contains: the odds roll (standard / premium / elite / position), the one fixed kicker, or the starter set
function rollStarter() {
  const tiers = [...Array(STARTER.B).fill('B'), ...Array(STARTER.C).fill('C')]; while (tiers.length < STARTER.slots.length) tiers.push('D');
  for (let i = tiers.length - 1; i > 0; i--) { const k = rnd(i + 1); [tiers[i], tiers[k]] = [tiers[k], tiers[i]]; }
  const used = new Set(), out = [];
  STARTER.slots.forEach((pos, i) => { let pool = eligible(tiers[i], pos).filter(p => !used.has(p[0])); if (!pool.length) pool = eligible(tiers[i], pos); const p = pool[rnd(pool.length)]; used.add(p[0]); out.push({ pid: p[0], rarity: 'Common', pos }); });
  return out;
}
export function rollPack(pack) {
  if (pack.fixed) return pack.fixed.map(pid => ({ pid, rarity: 'Common' }));
  if (pack.starter) return rollStarter();
  const out = []; for (let i = 0; i < pack.cards; i++) out.push(rollCard(pack, pack.pos)); return out;
}

// the coin formula, in one place. st = {ry, py, oy} (own rushing yards, own passing yards, the opponent's total yards)
export function coinsFor(R, st, won, tie, early) {
  const cl = (x, m) => Math.max(0, Math.min(m || 1500, Math.floor(+x) || 0)), E = R.events || {};
  const ry = cl(st && st.ry), py = cl(st && st.py), oy = early ? 0 : cl(st && st.oy);       // leaving early: just the yards you made (the opponent's yards do not count against you)
  const ev = cl(st && st.ptd, 60) * (E.ptd || 0) + cl(st && st.rtd, 60) * (E.rtd || 0) + cl(st && st.rec, 200) * (E.rec || 0) + cl(st && st.fd, 200) * (E.fd || 0)
    + cl(st && st.ic, 60) * (E.ic || 0) + cl(st && st.tod, 60) * (E.tod || 0) + cl(st && st.tda, 60) * (E.tda || 0) + cl(st && st.rtda, 60) * (E.rtda || 0);
  const perf = (R.yardRate === undefined ? 1 : R.yardRate) * (R.rushWeight * ry + py - oy) + ev;      // yards pay only a small fraction (yardRate) of a coin; touchdowns and the finish bonus are the real money
  if (early) return Math.min(Math.round(Math.max(0, perf)), R.perGameCap);                 // no completion bonus, no win bonus
  let t = R.playBase + Math.max(0, perf);                                                    // completing a game is the floor: you can never go below playBase
  if (won && !tie) t *= R.winMult;
  return Math.min(Math.round(t), R.perGameCap);
}
export function upgradeCost(tier, rarity) { const i = UPGRADE.order.indexOf(rarity); if (i < 0 || i >= UPGRADE.order.length - 1) return 0; return Math.round((UPGRADE.tierBase[tier] || UPGRADE.tierBase.F) * UPGRADE.stepMult[i]); }
export const sellValue = (tier, rarity) => Math.round((SELL.base[tier] || SELL.base.F) * (SELL.rarityMult[rarity] || 1));

export class Vault extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = env; this.sql = ctx.storage.sql; this.hits = [];
    this.sql.exec(`CREATE TABLE IF NOT EXISTS acct (id INTEGER PRIMARY KEY CHECK (id=1), user TEXT, salt TEXT, hash TEXT, coins INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0, lockUntil INTEGER NOT NULL DEFAULT 0, created INTEGER);
      CREATE TABLE IF NOT EXISTS cards (uid TEXT PRIMARY KEY, pid TEXT NOT NULL, rarity TEXT NOT NULL, got INTEGER NOT NULL, src TEXT);
      CREATE TABLE IF NOT EXISTS packs (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, got INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, delta INTEGER NOT NULL, bal INTEGER NOT NULL, why TEXT);
      CREATE TABLE IF NOT EXISTS sessions (h TEXT PRIMARY KEY, exp INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS games (gid TEXT PRIMARY KEY, mode TEXT, start INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS stats (id INTEGER PRIMARY KEY CHECK (id=1), wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, ties INTEGER NOT NULL DEFAULT 0, pf INTEGER NOT NULL DEFAULT 0, pa INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS paidmatch (mid TEXT PRIMARY KEY, coins INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS wagers (mid TEXT PRIMARY KEY, amount INTEGER NOT NULL, got INTEGER NOT NULL, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pass (id INTEGER PRIMARY KEY CHECK (id=1), xp INTEGER NOT NULL DEFAULT 0, claimed TEXT NOT NULL DEFAULT '[]', coin2 INTEGER NOT NULL DEFAULT 0, xp2 INTEGER NOT NULL DEFAULT 0, armc INTEGER NOT NULL DEFAULT 0, armx INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS escrow (uid TEXT PRIMARY KEY, tid TEXT NOT NULL, pid TEXT NOT NULL, rarity TEXT NOT NULL, got INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, other TEXT NOT NULL, status TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lines (slot TEXT PRIMARY KEY, level INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lineup (slot TEXT PRIMARY KEY, uid TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS xfactor (uid TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS chal (per TEXT NOT NULL, id TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, claimed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (per, id));
      CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, coins INTEGER NOT NULL DEFAULT 0, games INTEGER NOT NULL DEFAULT 0);`);
    try { this.sql.exec('ALTER TABLE paidmatch ADD COLUMN xp INTEGER NOT NULL DEFAULT 0'); } catch (e) {}      // accounts made before the season pass
  }
  acct() { return this.sql.exec('SELECT * FROM acct WHERE id=1').toArray()[0] || null; }
  throttle() { const n = Date.now(); this.hits = this.hits.filter(t => n - t < 60000); if (this.hits.length >= 90) return true; this.hits.push(n); return false; }
  ledger(delta, why) { const bal = this.acct().coins; this.sql.exec('INSERT INTO ledger (ts,delta,bal,why) VALUES (?,?,?,?)', Date.now(), delta, bal, why); }
  async newSession() {
    const tok = hex(crypto.getRandomValues(new Uint8Array(32))), exp = Date.now() + UT.sessionDays * 86400000;
    this.sql.exec('DELETE FROM sessions WHERE exp<?', Date.now());
    this.sql.exec('INSERT INTO sessions (h,exp) VALUES (?,?)', await sha(tok), exp);
    this.sql.exec('DELETE FROM sessions WHERE h NOT IN (SELECT h FROM sessions ORDER BY exp DESC LIMIT 6)');
    return tok;
  }
  async authed(tok) { if (typeof tok !== 'string' || tok.length !== 64) return false; const r = this.sql.exec('SELECT exp FROM sessions WHERE h=?', await sha(tok)).toArray()[0]; return !!r && r.exp > Date.now() && !!this.acct(); }
  publicCfg() {
    const packs = {}; for (const k in UT.packs) { const p = UT.packs[k]; packs[k] = { label: p.label, noBuy: !!p.noBuy, price: p.price, cards: p.cards, tierWeights: p.tierWeights, rarityWeights: p.rarityWeights || UT.rarityWeights }; }
    return { ver: 's106', packs, maxBuyAtOnce: UT.maxBuyAtOnce, rarityWeights: UT.rarityWeights, rewards: UT.rewards, sell: SELL, upgrade: UPGRADE, pass: PASS, kicker: { price: KICKERS.shopPrice, prefix: KICKERS.shopPrefix }, lines: { startLevel: LINES.startLevel, maxLevel: LINES.maxLevel, baseCost: LINES.baseCost, perLevel: LINES.perLevel } };
  }
  metaGet(k) { const r = this.sql.exec('SELECT v FROM meta WHERE k=?', k).toArray()[0]; return r ? r.v : ''; }
  metaSet(k, val) { this.sql.exec('INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, val); }
  ensureStarter() {            // every account gets ONE free starter pack (new accounts, and old ones that never built a team)
    if (this.metaGet('starter')) return; this.metaSet('starter', '1');
    if (this.sql.exec('SELECT COUNT(*) c FROM cards').toArray()[0].c <= 1) { this.sql.exec('INSERT INTO packs (kind,got) VALUES (?,?)', 'starter', Date.now()); for (let i = 0; i < 3; i++) this.sql.exec('INSERT INTO packs (kind,got) VALUES (?,?)', 'elite', Date.now()); this.ledger(0, 'welcome gift: 3 elite packs'); }   // a brand-new account: the starter pack plus 3 elite packs
  }
  recoverEscrow() {            // cards held for a trade that never finished come back after the trade expires
    const old = this.sql.exec('SELECT tid FROM escrow GROUP BY tid HAVING MIN(got) < ?', Date.now() - TRADE.expireMinutes * 60000 * 2).toArray();
    for (const r of old) this.tradeAbort(r.tid);
  }
  state() {
    this.ensureStarter(); this.recoverEscrow(); this.wagerRecover();
    const a = this.acct(), d = this.sql.exec('SELECT * FROM daily WHERE day=?', today()).toArray()[0] || { coins: 0, games: 0 };
    const packs = {}; this.sql.exec('SELECT kind, COUNT(*) c FROM packs GROUP BY kind').toArray().forEach(r => { packs[r.kind] = r.c; });
    return { user: a.user, coins: a.coins, cards: this.sql.exec('SELECT uid,pid,rarity,src FROM cards ORDER BY got, uid').toArray().map(c => ({ uid: c.uid, pid: c.pid, rarity: c.rarity, sb: this.soulbound(c.src) ? 1 : 0 })), packs,
      lines: this.lineLevels(), lineup: this.lineupRows(), tlineup: (() => { try { return JSON.parse(this.metaGet('tlu') || '{}'); } catch (e) { return {}; } })(), stats: this.statsRow(), jersey: this.metaGet('jersey'), pass: this.passState(), xf: this.xfState(), chal: this.chalState(), season: this.metaGet('season'), seasonClaimed: this.seasonClaimed(), dev: this.metaGet('dev') === '1',
      today: { coins: d.coins, games: d.games }, ledger: this.sql.exec('SELECT ts,delta,bal,why FROM ledger ORDER BY id DESC LIMIT 12').toArray(), cfg: this.publicCfg() };
  }
  kickerBuy(b) {
    const pid = String(b.pid || ''); if (!pid.startsWith(KICKERS.shopPrefix) || !CATALOG.some(p => p[0] === pid)) return j({ ok: false, err: 'not for sale' }, 400);
    let enough = true;
    this.ctx.storage.transactionSync(() => {
      if (this.acct().coins < KICKERS.shopPrice) { enough = false; return; }
      this.add(-KICKERS.shopPrice, 'bought kicker ' + pid);
      this.sql.exec('INSERT INTO cards (uid,pid,rarity,got,src) VALUES (?,?,?,?,?)', uid(), pid, 'Common', Date.now(), 'shop');
    });
    if (!enough) return j({ ok: false, err: 'not enough coins' }, 402);
    return j({ ok: true, ...this.state() });
  }
  statsRow() { const r = this.sql.exec('SELECT wins, losses, ties, pf, pa FROM stats WHERE id=1').toArray()[0]; return r || { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 }; }
  snap(tour, tid) {
    const cards = {}; this.sql.exec('SELECT uid,pid,rarity FROM cards').toArray().forEach(c => { cards[c.uid] = c; });
    const lineup = {}; const lu = this.lineupRows(); for (const slot in lu) if (cards[lu[slot]]) lineup[slot] = { uid: lu[slot], pid: cards[lu[slot]].pid, rarity: cards[lu[slot]].rarity };
    const xf = {}; this.sql.exec('SELECT uid FROM xfactor').toArray().forEach(r => { const c = cards[r.uid]; if (c && this.xfOk(c.pid, c.rarity)) for (const slot in lu) if (lu[slot] === r.uid) xf[slot] = 1; });
    if (tour) {                                                  // a tournament game: the tournament lineup (if one was saved) over the normal one, plus this tournament's LTD player - never an expired one
      const allc = {}; this.sql.exec('SELECT uid,pid,rarity,src FROM cards').toArray().forEach(c => { allc[c.uid] = c; }); const okc = c => c && (!String(c.src || '').startsWith('ltd:') || (tid && c.src === 'ltd:' + tid));
      let tl = {}; try { tl = JSON.parse(this.metaGet('tlu') || '{}') || {}; } catch (e) {}
      for (const slot in tl) { const c = allc[tl[slot]]; if (!(slot in LINES.lineup) || !okc(c)) continue; const cat = CATALOG.find(x => x[0] === c.pid); if (!cat || !LINES.lineup[slot].includes(cat[2])) continue;
        for (const sl in lineup) if (lineup[sl] && lineup[sl].uid === c.uid) delete lineup[sl]; lineup[slot] = { uid: c.uid, pid: c.pid, rarity: c.rarity, ltd: String(c.src || '').startsWith('ltd:') ? 1 : 0 }; delete xf[slot]; }
      const c = tid ? this.sql.exec('SELECT uid, pid, rarity FROM cards WHERE src=? LIMIT 1', 'ltd:' + tid).toArray()[0] : null;
      if (c && !Object.values(lineup).some(e => e && e.uid === c.uid)) { const cat = CATALOG.find(x => x[0] === c.pid), pos = cat ? cat[2] : ''; const slot = Object.keys(LINES.lineup).find(sl => LINES.lineup[sl].includes(pos));
        if (slot) { lineup[slot] = { uid: c.uid, pid: c.pid, rarity: c.rarity, ltd: 1 }; delete xf[slot]; } }
    }
    return { user: this.acct().user, lineup, lines: this.lineLevels(), stats: this.statsRow(), jersey: this.metaGet('jersey'), xf };
  }
  matchPay(b) {
    const mid = String(b.mid || ''); let paid = 0, why = '', xp = 0;
    const done = this.sql.exec('SELECT coins, xp FROM paidmatch WHERE mid=?', mid).toArray()[0];
    if (done) return { paid: done.coins, xp: done.xp || 0, why: 'already paid' };
    if (b.peek) return { paid: 0, why: 'not paid yet' };
    const pf = Math.floor(+b.pf) || 0, pa = Math.floor(+b.pa) || 0, won = pf > pa, tie = pf === pa;
    this.ctx.storage.transactionSync(() => {
      const d = this.sql.exec('SELECT * FROM daily WHERE day=?', today()).toArray()[0] || { coins: 0, games: 0 };
      this.sql.exec('INSERT OR IGNORE INTO stats (id) VALUES (1)');
      this.sql.exec('UPDATE stats SET wins=wins+?, losses=losses+?, ties=ties+?, pf=pf+?, pa=pa+? WHERE id=1', won ? 1 : 0, !won && !tie ? 1 : 0, tie ? 1 : 0, pf, pa);
      const opp = String(b.opp || '').slice(0, 20), pk = 'pp:' + today() + ':' + opp, pn = parseInt(this.metaGet(pk) || '0', 10) || 0;
      if (opp) this.metaSet(pk, String(pn + 1));
      if (!(opp && pn >= (UT.rewards.pairDailyPaid || 3))) this.chalGame(b, won, true);     // (not for a pair that has played too many times today)
      if (opp && pn >= (UT.rewards.pairDailyPaid || 3)) { why = 'you already played this opponent ' + pn + ' times today'; }
      else if (d.games >= UT.rewards.dailyGameCap || d.coins >= UT.rewards.dailyCoinCap) { why = 'daily limit reached'; }
      else {
        paid = b.wager ? 0 : Math.min(coinsFor(UT.rewards, b, won, tie), UT.rewards.dailyCoinCap - d.coins);
        paid = this.passCoinBoost(false, paid); xp = this.passXp(false, b);                      // season pass: 2x boosters, then XP
        this.sql.exec('INSERT INTO daily (day,coins,games) VALUES (?,?,1) ON CONFLICT(day) DO UPDATE SET coins=coins+?, games=games+1', today(), paid, paid);
        this.add(paid, (won ? 'won' : tie ? 'tied' : 'lost') + ' online match');
      }
      this.sql.exec('INSERT INTO paidmatch (mid, coins, xp) VALUES (?,?,?)', mid, paid, xp);
      this.bumpGames();
    });
    return { paid, xp, why };
  }
  sell(b) {
    const uids = Array.isArray(b.uids) ? [...new Set(b.uids.map(String))].slice(0, 60) : [];
    if (!uids.length) return j({ ok: false, err: 'nothing to sell' }, 400);
    let got = 0, n = 0, held = 0;
    this.ctx.storage.transactionSync(() => {
      const equipped = new Set(Object.values(this.lineupRows()));
      for (const u of uids) {
        const c = this.sql.exec('SELECT uid, pid, rarity, src FROM cards WHERE uid=?', u).toArray()[0];
        if (!c) continue; if (equipped.has(c.uid) || String(c.src || '').startsWith('ltd:')) { held++; continue; }                 // a card in your lineup can not be sold
        const cat = CATALOG.find(x => x[0] === c.pid);
        this.sql.exec('DELETE FROM cards WHERE uid=?', c.uid); this.sql.exec('DELETE FROM xfactor WHERE uid=?', c.uid); got += sellValue(cat ? cat[1] : 'F', c.rarity); n++;
      }
      if (n) this.add(got, 'sold ' + n + ' card' + (n > 1 ? 's' : ''));
    });
    if (!n) return j({ ok: false, err: held ? 'those cards can not be sold (in your lineup, or a tournament LTD card)' : 'nothing to sell' }, 409);
    return j({ ok: true, sold: n, got, ...this.state() });
  }
  setJersey(b) {
    const raw = String(b.team || '');
    if (raw === '') { this.metaSet('jersey', ''); return j({ ok: true, ...this.state() }); }     // back to AUTO
    if (/^custom:#[0-9a-f]{6},#[0-9a-f]{6},#[0-9a-f]{6}$/i.test(raw)) { this.metaSet('jersey', raw.toLowerCase()); return j({ ok: true, ...this.state() }); }      // a custom jersey: body, number/trim, helmet
    const t = raw.toUpperCase(); if (!TEAMS.has(t)) return j({ ok: false, err: 'unknown team' }, 400);
    this.metaSet('jersey', t); return j({ ok: true, ...this.state() });
  }
  // ---- trading (the Trade object drives these; they are never reachable from a browser) ----
  async tradeVerify(b) {
    const a = this.acct(); if (!a) return j({ ok: false, err: 'no account' }, 404);
    if (a.lockUntil > Date.now()) return j({ ok: false, err: 'too many tries - wait a few minutes' }, 429);
    const salt = new Uint8Array(a.salt.match(/../g).map(h => parseInt(h, 16))), ok = same(await pbkdf2(String(b.pass || ''), salt), a.hash);
    if (!ok) { const f = a.fails + 1; this.sql.exec('UPDATE acct SET fails=?, lockUntil=? WHERE id=1', f >= UT.loginFailLimit ? 0 : f, f >= UT.loginFailLimit ? Date.now() + UT.loginLockMinutes * 60000 : 0); return j({ ok: false, err: 'wrong password' }, 401); }
    this.sql.exec('UPDATE acct SET fails=0, lockUntil=0 WHERE id=1'); return j({ ok: true });
  }
  // ---- season mode: the browser plays the league; the server stores it and pays the milestone rewards once ----
  seasonClaimed() { try { return JSON.parse(this.metaGet('sclaim') || '[]'); } catch (e) { return []; } }
  seasonSet(b) {
    const raw = String(b.blob || ''); if (raw.length > 9000) return j({ ok: false, err: 'season data too big' }, 400);
    let o; try { o = JSON.parse(raw); } catch (e) { return j({ ok: false, err: 'bad season data' }, 400); }
    if (!o || !(o.div >= 1 && o.div <= 5) || !(o.no >= 1 && o.no < 100000)) return j({ ok: false, err: 'bad season data' }, 400);
    const key = o.div + ':' + o.no; if (this.metaGet('skey') !== key) { this.metaSet('skey', key); this.metaSet('sgp', String(this.gamesPlayed())); this.metaSet('sclaim', '[]'); }   // a new season starts counting games from now
    this.metaSet('season', raw); return j({ ok: true, ...this.state() });
  }
  // ---- verified devs: the code is checked here (never in the page); a dev can give packs to anyone, himself included
  devUnlock(b) {
    const want = String((this.env && this.env.DEV_CODE) || DEV.code || '').trim().toLowerCase(), got = String(b.code || '').trim().toLowerCase();
    if (b.off) { this.metaSet('dev', '0'); return j({ ok: true, ...this.state() }); }
    if (!want || got !== want) return j({ ok: false, err: 'that code does nothing' }, 403);
    this.metaSet('dev', '1'); return j({ ok: true, ...this.state() });
  }
  async devGive(b) {
    if (this.metaGet('dev') !== '1') return j({ ok: false, err: 'devs only' }, 403);
    const pack = UT.packs[String(b.pack || '')]; if (!pack) return j({ ok: false, err: 'no such pack' }, 400);
    const qty = Math.max(1, Math.min(DEV.maxPacksPerGive, parseInt(b.qty, 10) || 1)), to = String(b.to || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16), me = this.acct().user;
    if (!to) return j({ ok: false, err: 'who gets them?' }, 400);
    if (to === me) { for (let i = 0; i < qty; i++) this.sql.exec('INSERT INTO packs (kind,got) VALUES (?,?)', b.pack, Date.now()); this.ledger(0, 'dev gift: ' + qty + ' ' + b.pack); return j({ ok: true, gave: qty, to, ...this.state() }); }
    const r = await this.env.VAULT.get(this.env.VAULT.idFromName('ut:' + to)).fetch('https://v/i_devgrant', { method: 'POST', body: JSON.stringify({ pack: b.pack, qty, from: me }) }).then(x => x.json()).catch(() => null);
    if (!r || !r.ok) return j({ ok: false, err: (r && r.err) || 'could not reach that player' }, 404);
    this.ledger(0, 'dev gift to ' + to + ': ' + qty + ' ' + b.pack); return j({ ok: true, gave: qty, to, ...this.state() });
  }
  async devInf(b) {                                                  // a verified dev turns INFINITE COINS + PACKS on or off for a player (or for himself)
    if (this.metaGet('dev') !== '1') return j({ ok: false, err: 'devs only' }, 403);
    const on = b.on === true || b.on === 1 || b.on === '1', to = String(b.to || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16), me = this.acct().user;
    if (!to) return j({ ok: false, err: 'who gets it?' }, 400);
    if (to === me) { const r = this.devInfSet({ on, from: me }); return r.status === 200 ? j({ ok: true, to, on, ...this.state() }) : r; }
    const r = await this.env.VAULT.get(this.env.VAULT.idFromName('ut:' + to)).fetch('https://v/i_devinf', { method: 'POST', body: JSON.stringify({ on, from: me }) }).then(x => x.json()).catch(() => null);
    if (!r || !r.ok) return j({ ok: false, err: (r && r.err) || 'could not reach that player' }, 404);
    this.ledger(0, 'dev ' + (on ? 'gave INFINITE to ' : 'took INFINITE from ') + to); return j({ ok: true, to, on, ...this.state() });
  }
  devInfSet(b) {
    if (!this.acct()) return j({ ok: false, err: 'no such player' }, 404);
    const on = !!b.on, was = this.metaGet('inf') === '1';
    if (on && !was) {                                                  // snapshot the WHOLE team first, so taking it away can put everything back exactly
      const snap = { coins: this.acct().coins, cards: this.sql.exec('SELECT uid,pid,rarity,got,src FROM cards').toArray(), lineup: this.sql.exec('SELECT slot,uid FROM lineup').toArray(),
        lines: this.sql.exec('SELECT slot,level FROM lines').toArray(), xf: this.sql.exec('SELECT uid FROM xfactor').toArray(), packs: this.sql.exec('SELECT kind,got FROM packs').toArray(),
        jersey: this.metaGet('jersey'), tlu: this.metaGet('tlu') };
      this.metaSet('inf_snap', JSON.stringify(snap)); this.metaSet('inf_earn', '0'); this.metaSet('inf_since', String(Date.now())); this.metaSet('inf', '1');
      this.sql.exec('UPDATE acct SET coins=? WHERE id=1', 999999999); this.ledger(0, 'INFINITE COINS + PACKS (from ' + String(b.from || 'a dev') + ')');
    } else if (!on && was) {
      let snap = null; try { snap = JSON.parse(this.metaGet('inf_snap') || 'null'); } catch (e) {}
      const earn = parseInt(this.metaGet('inf_earn'), 10) || 0;
      this.metaSet('inf', '0');
      if (snap) this.ctx.storage.transactionSync(() => {               // put the team back exactly as it was: cards (rarity upgrades, sold or opened ones), lineup, line levels, X-factors, packs, jersey
        this.sql.exec('DELETE FROM cards'); snap.cards.forEach(r => this.sql.exec('INSERT INTO cards (uid,pid,rarity,got,src) VALUES (?,?,?,?,?)', r.uid, r.pid, r.rarity, r.got, r.src));
        this.sql.exec('DELETE FROM lineup'); snap.lineup.forEach(r => this.sql.exec('INSERT INTO lineup (slot,uid) VALUES (?,?)', r.slot, r.uid));
        this.sql.exec('DELETE FROM lines'); snap.lines.forEach(r => this.sql.exec('INSERT INTO lines (slot,level) VALUES (?,?)', r.slot, r.level));
        this.sql.exec('DELETE FROM xfactor'); snap.xf.forEach(r => this.sql.exec('INSERT INTO xfactor (uid) VALUES (?)', r.uid));
        this.sql.exec('DELETE FROM packs'); snap.packs.forEach(r => this.sql.exec('INSERT INTO packs (kind,got) VALUES (?,?)', r.kind, r.got));
        this.metaSet('jersey', snap.jersey || ''); this.metaSet('tlu', snap.tlu || '');
        this.sql.exec('UPDATE acct SET coins=? WHERE id=1', (snap.coins | 0) + earn);
      });
      this.metaSet('inf_snap', ''); this.ledger(0, 'infinite taken away: whole team put back');
    }
    return j({ ok: true, on: this.metaGet('inf') === '1' });
  }
  devGrant(b) {
    if (!this.acct()) return j({ ok: false, err: 'no such player' }, 404);
    const pack = UT.packs[String(b.pack || '')]; if (!pack) return j({ ok: false, err: 'no such pack' }, 400);
    const qty = Math.max(1, Math.min(DEV.maxPacksPerGive, parseInt(b.qty, 10) || 1));
    for (let i = 0; i < qty; i++) this.sql.exec('INSERT INTO packs (kind,got) VALUES (?,?)', b.pack, Date.now());
    this.ledger(0, 'gift from dev ' + String(b.from || '').slice(0, 16) + ': ' + qty + ' ' + b.pack); return j({ ok: true });
  }
  seasonWon() { let o = null; try { o = JSON.parse(this.metaGet('season') || 'null'); } catch (e) {} return !!(o && o.phase === 'done' && o.champ === 'YOU' && (o.div + ':' + o.no) === this.metaGet('skey') && !o.poSim && Array.isArray(o.log) && o.log.filter(l => l && l.wk === 'PO' && !l.sim).length >= 3); }   // the Super Bowl AND every playoff game played, none simmed
  draftGet() {                           // the 3 cards on offer for the season you just won (rolled once by the server, fixed for that season)
    const key = this.metaGet('skey'); if (!key) return j({ ok: false, err: 'no season yet' }, 409);
    if (!this.seasonWon()) return j({ ok: false, err: 'win the Super Bowl (playing every playoff game) to draft a player' }, 409);
    let d = null; try { d = JSON.parse(this.metaGet('draft') || 'null'); } catch (e) {}
    if (!d || d.key !== key) {
      const pk = { tierWeights: DRAFT.tierWeights, rarityWeights: DRAFT.rarityWeights }, offers = []; const seen = new Set();
      for (let i = 0; i < 40 && offers.length < DRAFT.cards; i++) { const c = rollCard(pk); if (seen.has(c.pid)) continue; seen.add(c.pid); offers.push({ pid: c.pid, rarity: c.rarity }); }
      d = { key, offers, picked: -1 }; this.metaSet('draft', JSON.stringify(d));
    }
    return j({ ok: true, draft: { offers: d.offers, picked: d.picked }, ...this.state() });
  }
  draftPick(b) {
    const i = parseInt(b.i, 10); let res = null;
    this.ctx.storage.transactionSync(() => {
      const key = this.metaGet('skey'); let d = null; try { d = JSON.parse(this.metaGet('draft') || 'null'); } catch (e) {}
      if (!key || !d || d.key !== key) { res = { ok: false, err: 'open the draft first' }; return; }
      if (d.picked >= 0) { res = { ok: false, err: 'you already drafted this season' }; return; }
      if (!(i >= 0 && i < d.offers.length)) { res = { ok: false, err: 'pick one of the cards' }; return; }
      const o = d.offers[i], u = uid(); this.sql.exec('INSERT INTO cards (uid,pid,rarity,got,src) VALUES (?,?,?,?,?)', u, o.pid, o.rarity, Date.now(), 'draft');
      d.picked = i; this.metaSet('draft', JSON.stringify(d)); res = { ok: true, card: { uid: u, pid: o.pid, rarity: o.rarity } };
    });
    return res.ok ? j({ ok: true, pulled: [res.card], draft: { picked: i }, ...this.state() }) : j(res, 409);
  }
  seasonClaim(b) {
    const kind = String(b.kind || ''), coins = SEASON.reward[kind]; if (!coins) return j({ ok: false, err: 'unknown reward' }, 400);
    let res = null;
    this.ctx.storage.transactionSync(() => {
      const claimed = this.seasonClaimed(), key = this.metaGet('skey'); if (!key) { res = { ok: false, err: 'no season' }; return; }
      if (claimed.includes(kind)) { res = { ok: false, err: 'already claimed' }; return; }
      if (!this.seasonWon()) { res = { ok: false, err: 'win the Super Bowl first - every playoff game has to be played, not simmed' }; return; }
      let log = []; try { log = JSON.parse(this.metaGet('schamps') || '[]'); } catch (e) {} const now = Date.now(); log = log.filter(t => now - t < 86400000);
      if (log.length >= SEASON.champsPerDay) { res = { ok: false, err: 'that is ' + SEASON.champsPerDay + ' titles today - the next reward unlocks tomorrow' }; return; }
      log.push(now); this.metaSet('schamps', JSON.stringify(log)); claimed.push(kind);
      this.metaSet('sclaim', JSON.stringify(claimed)); this.add(coins, 'season ' + kind + ' reward'); this.sql.exec('INSERT INTO packs (kind,got) VALUES (?,?)', SEASON.pack[kind], Date.now()); res = { ok: true };
    });
    return res.ok ? j({ ok: true, ...this.state(), reward: coins, pack: SEASON.pack[kind] }) : j(res, 409);
  }
  // ---- challenges + leaderboard feed ----
  weekKey(d = new Date()) { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), dow = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dow); return 'w' + t.toISOString().slice(0, 10); }   // the Monday of this week
  chalPick(list, count, per) {            // the same few for everybody on a given day / week
    const h = s => { let x = 2166136261; for (const ch of s) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
    return list.slice().sort((a, b) => h(per + a.id) - h(per + b.id)).slice(0, count);
  }
  chalSet() { const d = today(), w = this.weekKey(); return { dayKey: d, weekKey: w, day: this.chalPick(CHALLENGES.daily, CHALLENGES.dailyCount, d), week: this.chalPick(CHALLENGES.weekly, CHALLENGES.weeklyCount, w) }; }
  chalState() {
    const S = this.chalSet(), rows = {}; this.sql.exec('SELECT per,id,n,claimed FROM chal WHERE per IN (?,?)', S.dayKey, S.weekKey).toArray().forEach(r => { rows[r.per + '|' + r.id] = r; });
    const fmt = (per, list) => list.map(c => { const r = rows[per + '|' + c.id] || { n: 0, claimed: 0 }; return { id: c.id, text: c.text, goal: c.goal, n: Math.min(r.n, c.goal), coins: c.coins, claimed: !!r.claimed, done: r.n >= c.goal }; });
    const now = new Date(), midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1), mon = Date.parse(S.weekKey.slice(1) + 'T00:00:00Z') + 7 * 86400000;
    return { day: { key: S.dayKey, resetsIn: midnight - Date.now(), list: fmt(S.dayKey, S.day) }, week: { key: S.weekKey, resetsIn: mon - Date.now(), list: fmt(S.weekKey, S.week) } };
  }
  chalGame(b, won, vs) {                  // a finished, valid game: count it toward today's and this week's challenges
    const cl = (x, m) => Math.max(0, Math.min(m, Math.floor(+x) || 0)), S = this.chalSet();
    const ptd = cl(b.ptd, 60), rtd = cl(b.rtd, 60), ev = { ptd, rtd, td: ptd + rtd, py: cl(b.py, 1500), ry: cl(b.ry, 1500), rec: cl(b.rec, 200), fd: cl(b.fd, 200), win: won ? 1 : 0, game: 1, vs: vs ? 1 : 0, clean: won && cl(b.ic, 60) === 0 ? 1 : 0 };
    for (const [per, list] of [[S.dayKey, S.day], [S.weekKey, S.week]]) for (const c of list) { const add = ev[c.stat] | 0; if (!add) continue;
      this.sql.exec('INSERT INTO chal (per,id,n,claimed) VALUES (?,?,?,0) ON CONFLICT(per,id) DO UPDATE SET n=MIN(?, n+?) WHERE claimed=0', per, c.id, Math.min(c.goal, add), c.goal, add); }
    this.sql.exec('DELETE FROM chal WHERE per < ?', new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10));
    try { this.ctx.waitUntil(this.env.MM.get(this.env.MM.idFromName('lb')).fetch('https://m/lbadd', { method: 'POST', body: JSON.stringify({ user: this.acct().user, vs: !!vs, win: !!won, td: ptd + rtd, week: S.weekKey }) }).catch(() => {})); } catch (e) {}
  }
  chalClaim(b) {
    const S = this.chalSet(), per = b.per === 'week' ? S.weekKey : S.dayKey, list = b.per === 'week' ? S.week : S.day, c = list.find(x => x.id === String(b.id)); if (!c) return j({ ok: false, err: 'that challenge is not active' }, 404);
    let res = null;
    this.ctx.storage.transactionSync(() => {
      const r = this.sql.exec('SELECT n,claimed FROM chal WHERE per=? AND id=?', per, c.id).toArray()[0];
      if (!r || r.n < c.goal) { res = { ok: false, err: 'not finished yet' }; return; } if (r.claimed) { res = { ok: false, err: 'already claimed' }; return; }
      this.sql.exec('UPDATE chal SET claimed=1 WHERE per=? AND id=?', per, c.id); this.add(c.coins, 'challenge: ' + c.text.toLowerCase()); res = { ok: true, coins: c.coins };
    });
    return res.ok ? j({ ok: true, ...this.state(), reward: res.coins }) : j(res, 409);
  }
  gamesPlayed() { return parseInt(this.metaGet('gp') || '0', 10) || 0; }
  bumpGames() { this.metaSet('gp', String(this.gamesPlayed() + 1)); }
  tradeEligible() {            // new / throwaway accounts cannot trade or wager
    const g = this.gamesPlayed(), age = (Date.now() - this.acct().created) / 3600000;
    if (g < TRADE.minGames) return 'finish ' + (TRADE.minGames - g) + ' more game' + (TRADE.minGames - g > 1 ? 's' : '') + ' before you can trade';
    if (age < TRADE.minAgeHours) return 'trading opens ' + Math.ceil(TRADE.minAgeHours - age) + ' hour(s) from now (new accounts wait ' + TRADE.minAgeHours + ' hours)';
    return '';
  }
  soulbound(src) { return src === 'start' || String(src || '').startsWith('pack:starter') || String(src || '').startsWith('ltd:'); }   // starter-pack cards and the starting kicker can never be traded
  tradeOpen() {                // called when this player starts a trade
    const why = this.tradeEligible(); if (why) return j({ ok: false, err: why }, 403);
    const key = 'to:' + today(), n = parseInt(this.metaGet(key) || '0', 10) || 0; if (n >= TRADE.dailyOpen) return j({ ok: false, err: 'you can start ' + TRADE.dailyOpen + ' trades a day' }, 429);
    this.metaSet(key, String(n + 1)); return j({ ok: true });
  }
  tradeHas(b) {                 // which of these cards could be offered right now
    const why = this.tradeEligible(); if (why) return j({ ok: false, err: why, cards: [] }, 403);
    const eq = new Set(Object.values(this.lineupRows())), out = [];
    for (const u of (Array.isArray(b.uids) ? b.uids : []).slice(0, TRADE.maxCards)) { const c = this.sql.exec('SELECT uid,pid,rarity,src FROM cards WHERE uid=?', String(u)).toArray()[0]; if (c && !eq.has(c.uid) && !this.soulbound(c.src)) { const cat = CATALOG.find(x => x[0] === c.pid); out.push({ uid: c.uid, pid: c.pid, rarity: c.rarity, val: sellValue(cat ? cat[1] : 'F', c.rarity) }); } }
    return j({ ok: true, cards: out });
  }
  tradeLock(b) {
    const tid = String(b.tid), uids = [...new Set((b.uids || []).map(String))].slice(0, TRADE.maxCards); let cards = [], bad = false;
    this.ctx.storage.transactionSync(() => {
      const eq = new Set(Object.values(this.lineupRows()));
      if (this.tradeEligible()) { bad = true; return; }
      for (const u of uids) { const c = this.sql.exec('SELECT uid,pid,rarity,got,src FROM cards WHERE uid=?', u).toArray()[0]; if (!c || eq.has(c.uid) || this.soulbound(c.src)) { bad = true; return; } cards.push(c); }
      for (const c of cards) { this.sql.exec('INSERT INTO escrow (uid,tid,pid,rarity,got) VALUES (?,?,?,?,?)', c.uid, tid, c.pid, c.rarity, Date.now()); this.sql.exec('DELETE FROM cards WHERE uid=?', c.uid); this.sql.exec('DELETE FROM xfactor WHERE uid=?', c.uid); }
    });
    if (bad) return j({ ok: false, err: 'a card in the offer is no longer available' }, 409);
    return j({ ok: true, cards: cards.map(c => ({ uid: c.uid, pid: c.pid, rarity: c.rarity })) });
  }
  tradeAbort(tid) {
    this.ctx.storage.transactionSync(() => { for (const c of this.sql.exec('SELECT uid,pid,rarity,got FROM escrow WHERE tid=?', tid).toArray()) { this.sql.exec('INSERT OR IGNORE INTO cards (uid,pid,rarity,got,src) VALUES (?,?,?,?,?)', c.uid, c.pid, c.rarity, c.got, 'trade-back'); this.sql.exec('DELETE FROM escrow WHERE uid=?', c.uid); } });
  }
  tradeCommit(b) {              // idempotent: a trade id can only ever be delivered once
    const tid = String(b.tid); if (this.metaGet('tdone:' + tid)) return j({ ok: true, again: true });
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM escrow WHERE tid=?', tid);
      for (const c of (b.get || []).slice(0, TRADE.maxCards)) this.sql.exec('INSERT OR IGNORE INTO cards (uid,pid,rarity,got,src) VALUES (?,?,?,?,?)', String(c.uid), String(c.pid), String(c.rarity), Date.now(), 'trade');
      this.metaSet('tdone:' + tid, '1');
    });
    return j({ ok: true });
  }
  // ---- season pass ----
  xfOk(pid, rarity) { const c = CATALOG.find(x => x[0] === pid); return !!c && XF.tiers.includes(c[1]) && XF.rarities.includes(rarity) && XF.positions.includes(c[2]); }
  xfState() { const p = this.passRow(), got = JSON.parse(p.claimed), tokens = PASS.xLevels.filter(L => got.includes(L)).length; return { tokens, equipped: this.sql.exec('SELECT uid FROM xfactor').toArray().map(r => r.uid) }; }
  xfSet(b, on) {
    const uidv = String(b.uid || ''); let err = '';
    this.ctx.storage.transactionSync(() => {
      const c = this.sql.exec('SELECT pid,rarity FROM cards WHERE uid=?', uidv).toArray()[0]; if (!c) { err = 'no such card'; return; }
      if (!on) { this.sql.exec('DELETE FROM xfactor WHERE uid=?', uidv); return; }
      if (!this.xfOk(c.pid, c.rarity)) { err = 'X-Factors need a tier S or A player who is Rare or better'; return; }
      const st = this.xfState(); if (st.equipped.includes(uidv)) return;
      if (st.equipped.length >= st.tokens) { err = 'no free X-Factor - claim more in the Battle Pass or remove one from another player'; return; }
      this.sql.exec('INSERT INTO xfactor (uid) VALUES (?)', uidv);
    });
    return err ? j({ ok: false, err }, 409) : j({ ok: true, ...this.state() });
  }
  passCost(L) { return Math.round(PASS.curve.base + PASS.curve.k * Math.pow(L, PASS.curve.pow)); }
  passRow() { this.sql.exec('INSERT OR IGNORE INTO pass (id) VALUES (1)'); return this.sql.exec('SELECT * FROM pass WHERE id=1').toArray()[0]; }
  passLevel(xp) { let L = 1, thr = 0; while (L < PASS.levels && xp >= thr + this.passCost(L)) { thr += this.passCost(L); L++; } return { level: L, into: xp - thr, need: L < PASS.levels ? this.passCost(L) : 0 }; }
  passState() { const p = this.passRow(), l = this.passLevel(p.xp); return { xp: p.xp, level: l.level, into: l.into, need: l.need, claimed: JSON.parse(p.claimed), boosters: { coin2: p.coin2, xp2: p.xp2 }, armed: { coin2: !!p.armc, xp2: !!p.armx } }; }
  passXp(early, st) {          // XP for a finished game (leaving early only keeps the touchdown XP); an armed 2x booster doubles it once
    const td = Math.max(0, Math.min(60, Math.floor(+(st && st.ptd) || 0))) + Math.max(0, Math.min(60, Math.floor(+(st && st.rtd) || 0)));
    let gain = (early ? 0 : PASS.xp.complete) + td * PASS.xp.td; const p = this.passRow();
    if (gain > 0 && !early && p.armx && p.xp2 > 0) { gain *= 2; this.sql.exec('UPDATE pass SET xp2=xp2-1, armx=0 WHERE id=1'); }
    this.sql.exec('UPDATE pass SET xp=xp+? WHERE id=1', gain); return gain;
  }
  passCoinBoost(early, paid) { const p = this.passRow(); if (!early && paid > 0 && p.armc && p.coin2 > 0) { this.sql.exec('UPDATE pass SET coin2=coin2-1, armc=0 WHERE id=1'); return paid * 2; } return paid; }
  passArm(b) {
    const k = b.kind === 'coin2' ? 'coin2' : b.kind === 'xp2' ? 'xp2' : ''; if (!k) return j({ ok: false, err: 'unknown booster' }, 400);
    const p = this.passRow(), col = k === 'coin2' ? 'armc' : 'armx', on = p[col] ? 0 : 1;
    if (on && p[k] < 1) return j({ ok: false, err: 'you have none of those' }, 409);
    this.sql.exec('UPDATE pass SET ' + col + '=? WHERE id=1', on); return j({ ok: true, ...this.state() });
  }
  passClaim(b) {
    let granted = 0;
    this.ctx.storage.transactionSync(() => {
      const p = this.passRow(), lv = this.passLevel(p.xp).level, got = new Set(JSON.parse(p.claimed));
      const want = b.level === 'all' ? Array.from({ length: lv }, (_, i) => i + 1) : [Math.floor(+b.level)];
      for (const L of want) {
        if (!(L >= 1 && L <= lv) || got.has(L)) continue; const r = PASS.rewards[L] || {};
        if (r.c) this.add(r.c, 'season pass level ' + L);
        for (const k in (r.p || {})) for (let i = 0; i < r.p[k]; i++) this.sql.exec('INSERT INTO packs (kind,got) VALUES (?,?)', k, Date.now());
        for (const k in (r.b || {})) this.sql.exec('UPDATE pass SET ' + (k === 'coin2' ? 'coin2' : 'xp2') + '=' + (k === 'coin2' ? 'coin2' : 'xp2') + '+? WHERE id=1', r.b[k]);
        got.add(L); granted++;
      }
      this.sql.exec('UPDATE pass SET claimed=? WHERE id=1', JSON.stringify([...got].sort((a, b) => a - b)));
    });
    if (!granted) return j({ ok: false, err: 'nothing to claim yet' }, 409);
    return j({ ok: true, granted, ...this.state() });
  }
  wagerLock(b) {              // hold my stake for this match (idempotent per match)
    const mid = String(b.mid), amt = Math.floor(+b.amount); if (!(amt >= WAGER.min && amt <= WAGER.max)) return j({ ok: false, err: 'wager must be ' + WAGER.min + '-' + WAGER.max }, 400);
    let res = null;
    this.ctx.storage.transactionSync(() => {
      const w = this.sql.exec('SELECT amount, state FROM wagers WHERE mid=?', mid).toArray()[0]; if (w) { res = { ok: w.state === 'held', amount: w.amount, err: w.state === 'held' ? '' : 'wager already ' + w.state }; return; }
      if (this.gamesPlayed() < WAGER.minGames) { res = { ok: false, err: 'finish ' + (WAGER.minGames - this.gamesPlayed()) + ' more games before you can wager' }; return; }
      const opp = String(b.opp || '').slice(0, 20), pk = 'wp:' + today() + ':' + opp, pn = parseInt(this.metaGet(pk) || '0', 10) || 0;
      if (opp && pn >= WAGER.pairDaily) { res = { ok: false, err: 'you can wager the same player only ' + WAGER.pairDaily + ' times a day' }; return; }
      if (this.acct().coins < amt) { res = { ok: false, err: 'not enough coins for the wager', short: true }; return; }
      if (opp) this.metaSet(pk, String(pn + 1));
      this.add(-amt, 'wager held'); this.sql.exec('INSERT INTO wagers (mid,amount,got,state) VALUES (?,?,?,?)', mid, amt, Date.now(), 'held'); res = { ok: true, amount: amt };
    });
    return j(res, res.ok ? 200 : 402);
  }
  wagerSettle(b) {            // win: both stakes; tie / refund: my stake back; lose: it is gone. Settles once.
    const mid = String(b.mid), r = String(b.result); let out = { ok: true, net: 0 };
    this.ctx.storage.transactionSync(() => {
      const w = this.sql.exec('SELECT amount, state FROM wagers WHERE mid=?', mid).toArray()[0]; if (!w || w.state !== 'held') { out = { ok: !!w, net: 0, again: true }; return; }
      if (r === 'win') { this.add(w.amount * 2, 'won a wager'); out.net = w.amount; } else if (r === 'lose') { out.net = -w.amount; } else { this.add(w.amount, 'wager refunded'); out.net = 0; }
      this.sql.exec('UPDATE wagers SET state=? WHERE mid=?', r === 'win' ? 'won' : r === 'lose' ? 'lost' : 'refunded', mid);
    });
    return j(out);
  }
  wagerRecover() {            // a stake held for a match that never finished comes back
    for (const w of this.sql.exec('SELECT mid, amount FROM wagers WHERE state=? AND got<?', 'held', Date.now() - WAGER.holdHours * 3600000).toArray()) { this.add(w.amount, 'wager refunded'); this.sql.exec("UPDATE wagers SET state='refunded' WHERE mid=?", w.mid); }
  }
  tradeLink(b) { this.sql.exec('INSERT INTO trades (id,other,status,ts) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, ts=excluded.ts', String(b.tid), String(b.other), String(b.status), Date.now()); return j({ ok: true }); }
  tradeList() { return j({ ok: true, trades: this.sql.exec('SELECT id, other, status, ts FROM trades ORDER BY ts DESC LIMIT 20').toArray() }); }
  cardUp(b) {
    const c = this.sql.exec('SELECT uid, pid, rarity, src FROM cards WHERE uid=?', String(b.uid || '')).toArray()[0]; if (!c) return j({ ok: false, err: 'no such card' }, 404);
    if (String(c.src || '').startsWith('ltd:') || String(c.pid).startsWith('LTD-')) return j({ ok: false, err: 'WNF LTD cards can not be upgraded' }, 409);
    const cat = CATALOG.find(x => x[0] === c.pid), cost = upgradeCost(cat ? cat[1] : 'F', c.rarity); if (!cost) return j({ ok: false, err: 'already Legendary' }, 409);
    const next = UPGRADE.order[UPGRADE.order.indexOf(c.rarity) + 1]; let enough = true;
    this.ctx.storage.transactionSync(() => {
      if (this.acct().coins < cost) { enough = false; return; }
      this.add(-cost, 'upgraded a card to ' + next); this.sql.exec('UPDATE cards SET rarity=? WHERE uid=?', next, c.uid);
    });
    if (!enough) return j({ ok: false, err: 'not enough coins' }, 402);
    return j({ ok: true, cost, rarity: next, ...this.state() });
  }
  lineLevels() {                                                                         // one level per GROUP: the whole O-line (OL) shares a level, the whole D-line (DL) shares a level
    const raw = {}; this.sql.exec('SELECT slot, level FROM lines').toArray().forEach(r => { raw[r.slot] = r.level; });
    const grp = {}; Object.keys(LINES.slots).forEach(k => { const g = LINES.slots[k]; grp[g] = Math.max(grp[g] || LINES.startLevel, raw[k] || LINES.startLevel); });
    const o = {}; Object.keys(LINES.slots).forEach(k => { o[k] = grp[LINES.slots[k]]; }); return o;
  }
  lineupRows() { const o = {}; this.sql.exec('SELECT slot, uid FROM lineup').toArray().forEach(r => { o[r.slot] = r.uid; }); return o; }
  setLineup(b) {
    const want = b.lineup && typeof b.lineup === 'object' ? b.lineup : null;
    if (!want) return j({ ok: false, err: 'no lineup sent' }, 400);
    const slots = Object.keys(LINES.lineup);
    for (const slot of Object.keys(want)) if (!slots.includes(slot)) return j({ ok: false, err: 'unknown slot ' + slot }, 400);
    const pick = {};
    try { this.ctx.storage.transactionSync(() => {
      for (const slot of slots) {
        const uid = want[slot]; if (!uid) continue;
        const c = this.sql.exec('SELECT uid, pid, src FROM cards WHERE uid=?', String(uid)).toArray()[0];
        if (!c) throw new Error('not owned');
        if (String(c.src || '').startsWith('ltd:')) throw new Error('LTD cards are for the tournament only');
        const p = CATALOG.find(x => x[0] === c.pid) || (c.pid === KICKERS.starter ? [c.pid, 'F', 'K'] : null);          // the starting kicker (Harrison Mevis) is not in the pack catalog but is a valid K
        if (!p || !LINES.lineup[slot].includes(p[2])) throw new Error('wrong position for ' + slot);
        if (Object.values(pick).includes(c.uid)) throw new Error('same card twice');
        pick[slot] = c.uid;
      }
      this.sql.exec('DELETE FROM lineup');
      for (const slot of Object.keys(pick)) this.sql.exec('INSERT INTO lineup (slot, uid) VALUES (?,?)', slot, pick[slot]);
    }); } catch (e) { return j({ ok: false, err: String(e.message || e) }, 400); }
    return j({ ok: true, ...this.state() });
  }
  setTourLineup(b) {                                        // WNF: a lineup used only in tournament games (it may hold this tournament's LTD card)
    const want = b.lineup && typeof b.lineup === 'object' ? b.lineup : null; if (!want) return j({ ok: false, err: 'no lineup sent' }, 400);
    const out = {}, seen = new Set();
    for (const slot of Object.keys(want)) { if (!(slot in LINES.lineup)) return j({ ok: false, err: 'unknown slot ' + slot }, 400); const uidv = want[slot]; if (!uidv) continue;
      const c = this.sql.exec('SELECT uid, pid FROM cards WHERE uid=?', String(uidv)).toArray()[0]; if (!c) return j({ ok: false, err: 'not owned' }, 400);
      const p = CATALOG.find(x => x[0] === c.pid) || (c.pid === KICKERS.starter ? [c.pid, 'F', 'K'] : null); if (!p || !LINES.lineup[slot].includes(p[2])) return j({ ok: false, err: 'wrong position for ' + slot }, 400);
      if (seen.has(c.uid)) return j({ ok: false, err: 'same card twice' }, 400); seen.add(c.uid); out[slot] = c.uid; }
    this.metaSet('tlu', JSON.stringify(out)); return j({ ok: true, ...this.state() });
  }
  upgradeLine(b) {
    const slot = String(b.slot || ''); if (!(slot in LINES.slots)) return j({ ok: false, err: 'unknown line slot' }, 400);
    const g = LINES.slots[slot], mates = Object.keys(LINES.slots).filter(k => LINES.slots[k] === g);
    let res = null;
    this.ctx.storage.transactionSync(() => {
      const lv = this.lineLevels()[slot];
      if (lv >= LINES.maxLevel) { res = { ok: false, err: 'already max level' }; return; }
      const cost = LINES.baseCost * lv;
      if (this.acct().coins < cost) { res = { ok: false, err: 'not enough coins' }; return; }
      this.add(-cost, 'upgraded ' + (g === 'OL' ? 'O-LINE' : g === 'DL' ? 'D-LINE' : g) + ' to ' + (lv + 1));
      mates.forEach(k => this.sql.exec('INSERT INTO lines (slot, level) VALUES (?,?) ON CONFLICT(slot) DO UPDATE SET level=excluded.level', k, lv + 1));
    });
    if (res) return j(res, res.err === 'not enough coins' ? 402 : 409);
    return j({ ok: true, ...this.state() });
  }
  add(delta, why) {
    if (this.metaGet('inf') === '1') {                                   // INFINITE (dev troll): spending is free, earnings are kept aside and paid back when the dev takes it away
      if (delta < 0) { this.ledger(0, String(why || '') + ' (free)'); return; }
      if (!/^sold /.test(String(why || ''))) this.metaSet('inf_earn', String((parseInt(this.metaGet('inf_earn'), 10) || 0) + delta));   // quick-sell money made while it was on is NOT paid back
      this.ledger(0, String(why || '') + ' (while infinite)'); return;
    }
    this.sql.exec('UPDATE acct SET coins=coins+? WHERE id=1', delta); this.ledger(delta, why);
  }

  async fetch(req) {
    let b; try { b = await req.json(); } catch (e) { return j({ ok: false, err: 'bad request' }, 400); }
    const act = new URL(req.url).pathname.split('/').pop();
    if (this.throttle()) return j({ ok: false, err: 'slow down' }, 429);
    try {
      if (act === 'i_exists') return j({ ok: !!this.acct() });
      if (act === 'i_devgrant') return this.devGrant(b);
      if (act === 'i_devinf') return this.devInfSet(b);
      if (act === 'i_isinf') return j({ ok: true, inf: this.metaGet('inf') === '1' });
      if (act === 'i_isdev') return j({ ok: true, dev: this.metaGet('dev') === '1' });
      if (act === 'i_tstats') { const a = this.acct(); if (!a) return j({ ok: false }, 404); return j({ ok: true, stats: this.statsRow() }); }
      if (act === 'i_tfee') { const fee = Math.max(0, Math.floor(+b.fee || 0)); if (!this.acct()) return j({ ok: false, err: 'no account' }, 404); if (this.acct().coins < fee) return j({ ok: false, err: 'the entry fee is ' + fee + ' coins' }, 402);
        if (fee) this.add(-fee, 'tournament entry ' + String(b.tid || '')); return j({ ok: true, ...this.state() }); }
      if (act === 'i_trefund') { const fee = Math.max(0, Math.floor(+b.fee || 0)); if (b.once) { const k = 'trefund:' + String(b.tid || ''); if (this.metaGet(k)) return j({ ok: true }); this.metaSet(k, '1'); } if (fee) this.add(fee, 'tournament refund ' + String(b.tid || '')); return j({ ok: true }); }
      if (act === 'i_tltd') { const tid = String(b.tid || ''); if (!/^[a-z0-9]{4,40}$/.test(tid)) return j({ ok: false, err: 'bad tournament' }, 400);
        const have = this.sql.exec('SELECT uid, pid, rarity FROM cards WHERE src=?', 'ltd:' + tid).toArray()[0]; if (have) return j({ ok: true, card: have, ...this.state() });   // one pack per tournament, ever
        if (this.metaGet('tltd:' + tid)) return j({ ok: true, card: null, ...this.state() });
        const base = TOUR.ltdPool[Math.floor(Math.random() * TOUR.ltdPool.length)], u = uid(), card = { uid: u, pid: 'LTD-' + base, rarity: 'Common' };
        this.ctx.storage.transactionSync(() => { this.sql.exec('INSERT INTO cards (uid,pid,rarity,got,src) VALUES (?,?,?,?,?)', u, card.pid, card.rarity, Date.now(), 'ltd:' + tid); this.metaSet('tltd:' + tid, card.pid); });
        this.ledger(0, 'WNF Season LTD pack: ' + card.pid); return j({ ok: true, card, ...this.state() }); }
      if (act === 'i_tdrop') { const src = 'ltd:' + String(b.tid || ''), gone = this.sql.exec('SELECT uid FROM cards WHERE src=?', src).toArray().map(r => r.uid);
        if (gone.length) { this.sql.exec('DELETE FROM cards WHERE src=?', src); this.sql.exec('DELETE FROM xfactor WHERE uid IN (' + gone.map(() => '?').join(',') + ')', ...gone);
          let tl = {}; try { tl = JSON.parse(this.metaGet('tlu') || '{}') || {}; } catch (e) {} for (const k in tl) if (gone.includes(tl[k])) delete tl[k]; this.metaSet('tlu', JSON.stringify(tl)); this.ledger(0, 'WNF over: the LTD card expired'); }
        return j({ ok: true }); }
      if (act === 'i_tprize') { const pz = b.prize || {}, key = 'tprize:' + String(b.tid || ''); if (this.metaGet(key)) return j({ ok: true, already: true }); this.metaSet(key, String(b.place | 0)); if ((b.place | 0) === 1) this.metaSet('wnfTitles', String((parseInt(this.metaGet('wnfTitles') || '0', 10) || 0) + 1)); if (pz.coins) this.add(Math.floor(pz.coins), 'tournament place ' + (b.place | 0));
        for (const k in (pz.packs || {})) if (UT.packs[k]) for (let i = 0; i < Math.min(5, pz.packs[k] | 0); i++) this.sql.exec('INSERT INTO packs (kind,got) VALUES (?,?)', k, Date.now());
        if (pz.card && TOUR.special[pz.card]) this.sql.exec('INSERT INTO cards (uid,pid,rarity,got,src) VALUES (?,?,?,?,?)', uid(), pz.card, 'Legendary', Date.now(), 'tour:' + String(b.tid || ''));
        this.ledger(0, 'tournament place ' + (b.place | 0) + ' prize'); return j({ ok: true }); }
      if (act === 'i_verify') return await this.tradeVerify(b);
      if (act === 'i_thas') return this.tradeHas(b);
      if (act === 'i_topen') return this.tradeOpen();
      if (act === 'i_tlock') return this.tradeLock(b);
      if (act === 'i_tabort') { this.tradeAbort(String(b.tid)); return j({ ok: true }); }
      if (act === 'i_tcommit') return this.tradeCommit(b);
      if (act === 'i_tlink') return this.tradeLink(b);
      if (act === 'i_wlock') return this.wagerLock(b);
      if (act === 'i_wsettle') return this.wagerSettle(b);
      if (act === 'i_snap') return j({ ok: true, snap: this.snap(!!b.tour, String(b.tid || '')) });                 // internal: only the Match object calls these two
      if (act === 'i_pay') { const r = this.matchPay(b); return j({ ok: true, ...r, stateOut: this.state() }); }
      if (act === 'register') return await this.register(b);
      if (act === 'login') return await this.login(b);
      if (!(await this.authed(b.token))) return j({ ok: false, err: 'signed out' }, 401);
      if (act === 'state') return j({ ok: true, ...this.state() });
      if (act === 'buy') return this.buy(b);
      if (act === 'open') return this.open(b);
      if (act === 'ping') return j({ ok: true });
      if (act === 'setjersey') return this.setJersey(b);
      if (act === 'chalclaim') return this.chalClaim(b);
      if (act === 'seasonset') return this.seasonSet(b);
      if (act === 'devunlock') return this.devUnlock(b);
      if (act === 'devgive') return await this.devGive(b);
      if (act === 'devinf') return await this.devInf(b);
      if (act === 'draftget') return this.draftGet();
      if (act === 'draftpick') return this.draftPick(b);
      if (act === 'seasonclaim') return this.seasonClaim(b);
      if (act === 'cardup') return this.cardUp(b);
      if (act === 'passclaim') return this.passClaim(b);
      if (act === 'xfequip') return this.xfSet(b, true);
      if (act === 'xfunequip') return this.xfSet(b, false);
      if (act === 'passarm') return this.passArm(b);
      if (act === 'tradelist') return this.tradeList();
      if (act === 'sell') return this.sell(b);
      if (act === 'lineup') return this.setLineup(b);
      if (act === 'tlineup') return this.setTourLineup(b);
      if (act === 'kickbuy') return this.kickerBuy(b);
      if (act === 'upgrade') return this.upgradeLine(b);
      if (act === 'gamestart') return this.gameStart(b);
      if (act === 'gamefinish') return this.gameFinish(b);
      if (act === 'logout') { this.sql.exec('DELETE FROM sessions WHERE h=?', await sha(b.token)); return j({ ok: true }); }
    } catch (e) { return j({ ok: false, err: 'server error' }, 500); }
    return j({ ok: false, err: 'unknown' }, 404);
  }
  async register(b) {
    if (this.acct()) return j({ ok: false, err: 'that name is taken' }, 409);
    const pass = String(b.pass || ''); if (pass.length < 6 || pass.length > 64) return j({ ok: false, err: 'password must be 6-64 characters' }, 400);
    const salt = crypto.getRandomValues(new Uint8Array(16)), hash = await pbkdf2(pass, salt);
    this.ctx.storage.transactionSync(() => { this.sql.exec('INSERT INTO acct (id,user,salt,hash,coins,created) VALUES (1,?,?,?,?,?)', b.user, hex(salt), hash, UT.startCoins, Date.now()); this.ledger(UT.startCoins, 'welcome');
      const sk = uid(); this.sql.exec('INSERT INTO cards (uid,pid,rarity,got,src) VALUES (?,?,?,?,?)', sk, KICKERS.starter, 'Common', Date.now(), 'start');
      this.sql.exec('INSERT INTO lineup (slot, uid) VALUES (?,?)', 'K', sk); });
    this.ensureStarter(); try { this.open({ pack: 'starter' }); } catch (e) {}      // a new account starts with its team already built: the starter pack is opened and equipped for you
    return j({ ok: true, token: await this.newSession(), ...this.state() });
  }
  async login(b) {
    const a = this.acct(); if (!a) return j({ ok: false, err: 'wrong name or password' }, 401);
    if (a.lockUntil > Date.now()) return j({ ok: false, err: 'too many tries - wait a few minutes' }, 429);
    const salt = new Uint8Array(a.salt.match(/../g).map(h => parseInt(h, 16))), ok = same(await pbkdf2(String(b.pass || ''), salt), a.hash);
    if (!ok) { const f = a.fails + 1; this.sql.exec('UPDATE acct SET fails=?, lockUntil=? WHERE id=1', f >= UT.loginFailLimit ? 0 : f, f >= UT.loginFailLimit ? Date.now() + UT.loginLockMinutes * 60000 : 0); return j({ ok: false, err: 'wrong name or password' }, 401); }
    this.sql.exec('UPDATE acct SET fails=0, lockUntil=0 WHERE id=1');
    return j({ ok: true, token: await this.newSession(), ...this.state() });
  }
  buy(b) {
    const pack = UT.packs[b.pack]; if (!pack || pack.noBuy) return j({ ok: false, err: 'no such pack' }, 400);
    const qty = Math.floor(+b.qty || 1); if (!(qty >= 1 && qty <= UT.maxBuyAtOnce)) return j({ ok: false, err: 'bad quantity' }, 400);
    const cost = pack.price * qty; let enough = true;
    this.ctx.storage.transactionSync(() => {
      if (this.acct().coins < cost) { enough = false; return; }
      this.add(-cost, 'bought ' + qty + ' ' + b.pack);
      for (let i = 0; i < qty; i++) this.sql.exec('INSERT INTO packs (kind,got) VALUES (?,?)', b.pack, Date.now());
    });
    if (!enough) return j({ ok: false, err: 'not enough coins' }, 402);
    return j({ ok: true, ...this.state() });
  }
  open(b) {
    const pack = UT.packs[b.pack]; if (!pack) return j({ ok: false, err: 'no such pack' }, 400);
    let pulled = null;
    this.ctx.storage.transactionSync(() => {
      const gone = this.sql.exec('DELETE FROM packs WHERE id=(SELECT id FROM packs WHERE kind=? ORDER BY id LIMIT 1) RETURNING id', b.pack).toArray();
      if (!gone.length) return;                                    // no pack to open: nothing is rolled
      pulled = [];
      const now = Date.now(), taken = new Set(Object.keys(this.lineupRows()));
      for (const c of rollPack(pack)) {
        const u = uid(); this.sql.exec('INSERT INTO cards (uid,pid,rarity,got,src) VALUES (?,?,?,?,?)', u, c.pid, c.rarity, now, 'pack:' + b.pack); pulled.push({ uid: u, pid: c.pid, rarity: c.rarity });
        if (pack.starter) { const slot = (STARTER.equip[c.pos] || []).find(sl => !taken.has(sl)); if (slot) { taken.add(slot); this.sql.exec('INSERT INTO lineup (slot, uid) VALUES (?,?)', slot, u); } }   // the starter set fills your empty slots
      }
    });
    if (!pulled) return j({ ok: false, err: 'you have no packs to open' }, 409);
    return j({ ok: true, pulled, ...this.state() });
  }
  gameStart(b) {
    const mode = ['solo', 'coop', 'vs'].includes(b.mode) ? b.mode : 'solo';
    this.sql.exec('DELETE FROM games WHERE start<?', Date.now() - 6 * 3600000);
    if (this.sql.exec('SELECT COUNT(*) c FROM games WHERE used=0').toArray()[0].c >= 12) this.sql.exec('DELETE FROM games WHERE used=0 AND start=(SELECT MIN(start) FROM games WHERE used=0)');
    const gid = uid() + uid(); this.sql.exec('INSERT INTO games (gid,mode,start) VALUES (?,?,?)', gid, mode, Date.now());
    return j({ ok: true, gid });
  }
  gameFinish(b) {
    const R = UT.rewards, won = b.won === true && b.early !== true; let paid = 0, why = '', xp = 0;
    this.ctx.storage.transactionSync(() => {
      const g = this.sql.exec('SELECT * FROM games WHERE gid=?', String(b.gid || '')).toArray()[0];
      if (!g) { why = 'unknown game'; return; }
      if (g.used) { why = 'already claimed'; return; }
      this.sql.exec('UPDATE games SET used=1 WHERE gid=?', g.gid);       // a game can only ever pay once
      const secs = (Date.now() - g.start) / 1000; if (secs < (R.minSeconds[g.mode] ?? 120)) { why = 'game too short'; return; }
      if (b.early !== true) this.chalGame(b, won, false);          // challenges count every finished game, even past the daily coin cap
      const d = this.sql.exec('SELECT * FROM daily WHERE day=?', today()).toArray()[0] || { coins: 0, games: 0 };
      if (d.games >= R.dailyGameCap || d.coins >= R.dailyCoinCap) { why = 'daily limit reached'; return; }
      paid = Math.min(coinsFor(R, b, won, false, b.early === true), R.dailyCoinCap - d.coins);
      paid = this.passCoinBoost(b.early === true, paid); xp = this.passXp(b.early === true, b);   // season pass: 2x boosters, then XP
      this.sql.exec('INSERT INTO daily (day,coins,games) VALUES (?,?,1) ON CONFLICT(day) DO UPDATE SET coins=coins+?, games=games+1', today(), paid, paid);
      this.add(paid, (won ? 'won ' : 'finished ') + g.mode + ' game'); if (b.early !== true) this.bumpGames();
    });
    return j({ ok: true, paid, why, xp, ...this.state() });
  }
}
const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
