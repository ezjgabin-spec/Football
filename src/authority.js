// Server-side resolution of the football contacts the game already asks a "fb-authority" service about.
// It uses the SAME rules module as the browser (fbs_rules.js) and rates every player from the SERVER's copy of each team's saved lineup,
// so a browser cannot choose its own ratings or reroll a catch / tackle / swim it did not like.
import { FBS, UFR } from './fbs_rules.js';
import { PLAYERS } from './ut_players.js';
import { LINES } from './ut_config.js';

const byId = pid => PLAYERS[pid] || null;
const rnd = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// players: [{user, role:'host'|'guest', snap}] from the Match object -> {host, guest} rig ratings
export function buildTeams(players) {
  const T = { host: null, guest: null };
  for (const p of players) if (p.role === 'host' || p.role === 'guest') T[p.role] = UFR.team(p.snap, byId, LINES.perLevel);
  return T;
}
const unitTeam = (A, side, ho) => ((side === 'O') === !!ho) ? A.teams.host : (A.vs ? A.teams.guest : null);
function rate(A, p, ho, TS) {
  const T = unitTeam(A, p.side, ho);
  return Object.assign({}, p, { ur: (T && T.ur[p.role]) || null, engaged: !!p.engaged, vx: (p.vx || 0) * TS, vz: (p.vz || 0) * TS });
}

export function resolveContact(A, d) {
  const fr = A.frame, TS = (fr && fr.timeScale) || 0.75, lag = fr ? Math.min(.075, +fr.latency || 0) : 0, ho = !!d.ho;
  if (!d.ball || !Array.isArray(d.players) || d.players.length > 30) return { action: 'none' };
  const want = new Set(Array.isArray(d.rl) ? d.rl : []), ign = new Set(Array.isArray(d.ign) ? d.ign : []), at = d.at || {};
  const list = d.players.map(p => rate(A, p, ho, TS)), contacts = [];
  for (const p of list) {
    if (!want.has(p.role) || ign.has(p.role)) continue;
    if (p.side === 'O' && /^(OL|QB)/.test(p.role)) continue;
    const c = FBS.handContact(p, d.ball, d.ball.previous, lag);
    if (c) { c.at = +at[p.role] || 0; contacts.push(c); }
  }
  if (!contacts.length) return { action: 'none' };
  const w = contacts.find(c => c.side === 'O'), wp = w && list.find(p => p.role === w.role), cp = wp || d.ball;
  const defs = list.filter(p => p.side === 'D' && !p.down);
  const near = (r) => defs.filter(p => Math.hypot(p.x - cp.x, p.z - cp.z) < r);
  const b = Object.assign({}, d.ball, { contested: !!(wp && near(2.4).length), crowd: near(1.5).length,
    covK: wp ? near(2.4).reduce((m, p) => Math.max(m, p.ur ? p.ur.cov : 1), 1) : 1 });
  return FBS.resolve(contacts, b, rnd);
}

export function resolveAction(A, d) {
  const fr = A.frame; if (!fr || !Array.isArray(fr.players)) return {};
  const ho = !!fr.ho, TS = fr.timeScale || 0.75, raw = r => fr.players.find(p => p.role === r);
  const a0 = raw(d.a), b0 = d.b && raw(d.b); if (!a0) return {};
  const a = rate(A, a0, ho, 1), b = b0 && rate(A, b0, ho, 1);
  if (d.kind === 'tackle' && b) {
    // closing speed is judged on the pre-contact velocities the host reports; the ratings come from the server
    return { imp: FBS.hitPower(a, b), bt: clamp((b.ur ? b.ur.brk : 1) / (a.ur ? a.ur.tkl : 1), .7, 1.4), ds: ((a.ur ? a.ur.str : 1) - (b.ur ? b.ur.str : 1)) * .12, sec: b.ur ? b.ur.sec : 1 };
  }
  if (d.kind === 'swim' && b) {
    const ex = d.extra || {}, r = FBS.swim({ d: a, o: b, started: +ex.started || 0 }, +ex.side || 0, +d.t || 0);
    const gate = clamp(1 + ((a.ur ? a.ur.rush : 1) - (b.ur ? b.ur.blk : 1)) * .6, .45, 1);     // equal ratings (or no cards) = exactly the old rule
    return { success: !!(r.success && (gate >= 1 || rnd() < gate)) };
  }
  return {};
}
