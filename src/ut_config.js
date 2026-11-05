// ULTIMATE TEAM SETTINGS - edit this file to change prices, rewards and odds, then redeploy.
export const UT = {
  startCoins: 500,                                   // coins a new account starts with (PLACEHOLDER - set what you want)
  packs: {
    standard: {
      label: 'STANDARD PACK',
      price: 500,                                    // PLACEHOLDER price
      cards: 3,                                      // three player cards per pack
      tierWeights: { S: 3, A: 7, B: 12, C: 35, D: 43 }   // your odds: 3 / 7 / 12 / 35 / 43
    },
    // better packs cost more and shift BOTH the tier odds and the rarity odds toward the top (PLACEHOLDER prices, tuned to the coin formula below)
    premium: {
      label: 'PREMIUM PACK', price: 1800, cards: 3,
      tierWeights: { S: 8, A: 17, B: 25, C: 30, D: 20 },
      rarityWeights: { Common: 20, Uncommon: 35, Rare: 28, Epic: 12, Legendary: 5 }
    },
    elite: {
      label: 'ELITE PACK', price: 5000, cards: 3,
      tierWeights: { S: 20, A: 30, B: 28, C: 17, D: 5 },
      rarityWeights: { Common: 5, Uncommon: 20, Rare: 40, Epic: 25, Legendary: 10 }
    },
    // POSITION PACKS: five cards of ONE position at the standard pack odds (PLACEHOLDER price: 5 standard packs with a 20% discount)
    qb:   { label: 'QUARTERBACK PACK',     price: 2000, cards: 5, pos: 'QB',   tierWeights: { S: 3, A: 7, B: 12, C: 35, D: 43 } },
    rb:   { label: 'RUNNING BACK PACK',    price: 2000, cards: 5, pos: 'RB',   tierWeights: { S: 3, A: 7, B: 12, C: 35, D: 43 } },
    wr:   { label: 'WIDE RECEIVER PACK',   price: 2000, cards: 5, pos: 'WR',   tierWeights: { S: 3, A: 7, B: 12, C: 35, D: 43 } },
    te:   { label: 'TIGHT END PACK',       price: 2000, cards: 5, pos: 'TE',   tierWeights: { S: 3, A: 7, B: 12, C: 35, D: 43 } },
    lb:   { label: 'LINEBACKER PACK',      price: 2000, cards: 5, pos: 'LB',   tierWeights: { S: 3, A: 7, B: 12, C: 35, D: 43 } },
    cb:   { label: 'CORNERBACK PACK',      price: 2000, cards: 5, pos: 'CB',   tierWeights: { S: 3, A: 7, B: 12, C: 35, D: 43 } },
    saf:  { label: 'SAFETY PACK',          price: 2000, cards: 5, pos: 'SAF',  tierWeights: { S: 3, A: 7, B: 12, C: 35, D: 43 } },
    edge: { label: 'EDGE RUSHER PACK',     price: 2000, cards: 5, pos: 'EDGE', tierWeights: { S: 3, A: 7, B: 12, C: 35, D: 43 } },
    // handed out by the season pass (not for sale): one card, S or A tier, always Legendary
    legend: { label: 'SEASON LEGEND PACK', price: 0, noBuy: true, cards: 1, tierWeights: { S: 60, A: 40 }, rarityWeights: { Legendary: 1 } },
    // the starter pack is free, one per account (it is handed out automatically), and fills your empty lineup slots
    starter: { label: 'STARTER PACK', price: 0, noBuy: true, starter: true, cards: 14, tierWeights: { D: 1 } },
    // one plain kicker that can make field goals: never a C or D tier, never Mevis
    kicker: { label: 'COMPETENT KICKER', price: 300, cards: 1, fixed: ['K-STD'], tierWeights: { D: 1 } }
  },
  maxBuyAtOnce: 5,
  // PLACEHOLDER rarity odds (the game had none). Change freely; they only need to be positive numbers.
  rarityWeights: { Common: 43, Uncommon: 35, Rare: 12, Epic: 7, Legendary: 3 },
  // who can never come out of a pack
  excludedPositions: ['OL', 'DL', 'OT', 'OG', 'C', 'DT'],   // linemen (note: EDGE is NOT in this list - add it if edge rushers count as linemen)
  blockedIds: ['K-0017'],                                    // Harrison Mevis
  // coins for finished games (PLACEHOLDERS)
  rewards: {
    // coins per game = playBase + max(0, rushWeight*rushYards + passYards - opponentTotalYards), x winMult if you won, capped per game.
    // rushWeight 2: every rushing yard counts double a passing yard.
    playBase: 50, rushWeight: 2, yardRate: 0.1, winMult: 3.0, perGameCap: 800,
    // yardRate: yards are worth only 0.1 coin each (a rush yard 0.15). Finishing a game pays playBase (50) and every touchdown 20.
    // events add to / take from the performance score. The game can NEVER pay less than playBase (finishing a game always pays), win or lose.
    events: { ptd: 20, rtd: 20, rec: 1, fd: 1, ic: -10, tod: -5, tda: -5, rtda: -5 },
    pairDailyPaid: 3,                                // the same two players are paid for at most 3 online matches a day (stops two accounts farming each other)
    minSeconds: { solo: 120, coop: 120, vs: 120 },   // a game shorter than this pays nothing
    dailyCoinCap: 1e12,                              // no daily limit on coins (a huge number so it never triggers)
    dailyGameCap: 1e12                               // no daily limit on paid games
  },
  sessionDays: 60,
  loginFailLimit: 8, loginLockMinutes: 10
};

// LINEUP AND LINE UPGRADES - PLACEHOLDER numbers, edit and redeploy.
export const LINES = {
  slots: { LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL', DE1: 'DL', DT1: 'DL', DT2: 'DL' },     // the defense has 5 DL bodies: 2 are EDGE cards (collectible), 3 are these standard linemen
  startLevel: 1,
  maxLevel: 10,
  baseCost: 300,              // upgrade from level n costs baseCost * n coins (PLACEHOLDER)
  perLevel: 4,                // attribute points added per level
  // which attributes each line slot improves when upgraded
  attrs: { OL: ['blocking', 'strength'], DL: ['tackling', 'strength', 'big_hit'] },
  // lineup slots -> the positions allowed in them
  lineup: { QB: ['QB'], RB: ['RB'], WR1: ['WR'], WR2: ['WR'], WR3: ['WR'], TE: ['TE'], LB1: ['LB'], LB2: ['LB'], CB1: ['CB'], CB2: ['CB'], S1: ['SAF'], S2: ['SAF'], EDGE1: ['EDGE'], EDGE2: ['EDGE'], K: ['K'] }
};

// KICKER SHOP - PLACEHOLDER price. Every new account starts with STARTER_KICKER.
export const KICKERS = {
  starter: 'K-0017',                 // Harrison Mevis
  shopPrice: 600,                    // coins per generated D-tier kicker (PLACEHOLDER)
  shopPrefix: 'K-GEN'                // these 20 are sold only in the Kicker Shop, never from packs
};

// ONLINE MATCHES (PLACEHOLDER numbers). A match pays only when BOTH players report the same final score.
export const MATCH = {
  win: 150,                // coins for winning an Ultimate Team online match
  loss: 50,                // coins for losing
  tie: 75,
  minSeconds: 120,         // both players must have been in the match at least this long
  queueSeconds: 25         // a matchmaking ticket is dropped after this long without a poll
};

// SELLING CARDS - value = base[tier] x rarityMult[rarity] (PLACEHOLDER). Kept far below pack prices so selling can never pay for more packs than it cost.
export const SELL = {
  base: { S: 400, A: 200, B: 100, C: 50, D: 25, E: 10, F: 10 },
  rarityMult: { Common: 1, Uncommon: 1.5, Rare: 2.5, Epic: 5, Legendary: 12 }
};

// STARTER PACK: an actual player at each position - 1 B tier, 3 C tiers, the rest D tier (Mevis is already your kicker)
export const STARTER = {
  slots: ['QB', 'RB', 'WR', 'WR', 'WR', 'TE', 'LB', 'LB', 'CB', 'CB', 'SAF', 'SAF', 'EDGE', 'EDGE'],
  B: 1, C: 3,
  equip: { QB: ['QB'], RB: ['RB'], WR: ['WR1', 'WR2', 'WR3'], TE: ['TE'], LB: ['LB1', 'LB2'], CB: ['CB1', 'CB2'], SAF: ['S1', 'S2'], EDGE: ['EDGE1', 'EDGE2'] }
};
// TRADING
// TRADING ANTI-ABUSE: you must have FINISHED minGames paid games and the account must be minAgeHours old before you can trade; starter-pack
// cards can never be traded; both sides of a trade must be worth about the same (sell values within maxGapPct or maxGapAbs coins); and an
// account can open at most dailyOpen trades a day. This is what stops "make 10 accounts, funnel every star to one".
export const TRADE = { maxCards: 15, expireMinutes: 60, minGames: 10, minAgeHours: 24, maxGapPct: 0.35, maxGapAbs: 300, dailyOpen: 8 };

// UPGRADING A CARD'S RARITY (Common -> Uncommon -> Rare -> Epic -> Legendary). Each rarity adds flat rating points (see RARITY_BONUS in the rules file).
// cost of a step = tierBase[tier] x stepMult[step]. The steps get much harder AND the better the player's tier the more every step costs,
// so making a D-tier kicker Legendary is cheap and making an S-tier QB Legendary is a long grind. (PLACEHOLDER numbers.)
export const UPGRADE = {
  tierBase: { S: 600, A: 400, B: 200, C: 120, D: 60, E: 40, F: 40 },
  stepMult: [1, 2, 3.5, 6],                       // Common->Uncommon, ->Rare, ->Epic, ->Legendary  (an S-tier Common to Legendary: 600+1200+2100+3600 = 7,500 coins)
  order: ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']
};

// WAGERS: both players put up the same coins, the winner takes both stakes, no play bonus. A tie refunds both. (PLACEHOLDER limits.)
export const WAGER = { min: 50, max: 5000, presets: [100, 250, 500, 1000, 2500], holdHours: 3, minGames: 10, pairDaily: 2 };   // wagers need 10 finished games, and the same two players can wager only 2 times a day

// SEASON PASS: 40 levels, a free track. XP comes from finishing a game and from touchdowns; every level costs more XP than the one before.
// cost of level L -> L+1 = base + k * L^pow  (about 38,600 XP for the whole pass, roughly 175 typical games). Level 1 pays nothing, level 40 is the jackpot.
// rewards: c = coins, p = packs {kind: n}, b = boosters {coin2: n, xp2: n} (a booster doubles the coins / the XP of ONE finished game once armed)
export const PASS = {
  levels: 40, xp: { complete: 120, td: 50 }, curve: { base: 250, k: 12, pow: 1.35 },
  rewards: {
    1: {}, 2: { c: 100 }, 3: { b: { coin2: 1 } }, 4: { c: 150 }, 5: { p: { standard: 1 } }, 6: { b: { xp2: 1 } }, 7: { c: 250 }, 8: { p: { standard: 1 } }, 9: { b: { coin2: 1 } }, 10: { p: { premium: 1 } },
    11: { c: 400 }, 12: { b: { xp2: 1 } }, 13: { c: 450 }, 14: { p: { standard: 2 } }, 15: { c: 300, p: { premium: 1 } }, 16: { b: { coin2: 1 } }, 17: { c: 600 }, 18: { b: { xp2: 1 } }, 19: { c: 700 }, 20: { p: { premium: 2 } },
    21: { c: 800 }, 22: { b: { coin2: 1 } }, 23: { c: 900 }, 24: { b: { xp2: 1 } }, 25: { p: { elite: 1 } }, 26: { c: 1100 }, 27: { b: { coin2: 1 } }, 28: { c: 1250 }, 29: { b: { xp2: 1 } }, 30: { c: 1000, p: { elite: 1 } },
    31: { c: 1500 }, 32: { b: { coin2: 2 } }, 33: { c: 1750 }, 34: { b: { xp2: 2 } }, 35: { p: { elite: 1 } }, 36: { c: 2000 }, 37: { b: { coin2: 2, xp2: 2 } }, 38: { c: 2500 }, 39: { c: 2500, p: { elite: 1 } },
    40: { c: 10000, p: { elite: 3, legend: 1 }, b: { coin2: 3, xp2: 3 } }
  }
};

// X-FACTORS: claimed from the Battle Pass at these levels. Each one is a token you can put on ONE eligible card (tier S or A, Rare or better) and move later.
PASS.xLevels = [5, 10, 20, 30, 35, 40];
PASS.xLevels.forEach(L => { PASS.rewards[L] = Object.assign({}, PASS.rewards[L], { x: 1 }); });
export const XF = { tiers: ['S', 'A'], rarities: ['Rare', 'Epic', 'Legendary'], positions: ['QB', 'RB', 'WR', 'TE', 'CB', 'S', 'SAF', 'FS', 'SS', 'LB', 'EDGE', 'DE', 'OLB'] };

// TESTING MODE: every pack is free (starter, premium, elite, position, legend, kicker). Set FREE_PACKS to false to bring the prices back.
export const FREE_PACKS = false;
// the starter pack is the one exception: you only get it at signup
if (FREE_PACKS) { for (const k in UT.packs) { UT.packs[k].price = 0; UT.packs[k].noBuy = !!UT.packs[k].starter; } KICKERS.shopPrice = 0; }

// DAILY / WEEKLY CHALLENGES (PLACEHOLDER rewards). Three daily and two weekly ones are picked from these lists (the same for everybody, reset at midnight UTC / Monday).
// stat: ptd rtd td (passing / rushing / all touchdowns), py ry (yards), rec (catches), fd (first downs), win, game (finished games), vs (online matches), clean (a win with no interception thrown)
export const CHALLENGES = {
  dailyCount: 3, weeklyCount: 2,
  daily: [
    { id: 'd_ptd2', stat: 'ptd', goal: 2, coins: 60, text: 'THROW 2 TOUCHDOWN PASSES' },
    { id: 'd_rtd1', stat: 'rtd', goal: 1, coins: 60, text: 'SCORE A RUSHING TOUCHDOWN' },
    { id: 'd_td4', stat: 'td', goal: 4, coins: 100, text: 'SCORE 4 TOUCHDOWNS' },
    { id: 'd_py300', stat: 'py', goal: 300, coins: 70, text: 'THROW FOR 300 YARDS' },
    { id: 'd_ry100', stat: 'ry', goal: 100, coins: 70, text: 'RUSH FOR 100 YARDS' },
    { id: 'd_rec10', stat: 'rec', goal: 10, coins: 50, text: 'COMPLETE 10 CATCHES' },
    { id: 'd_fd15', stat: 'fd', goal: 15, coins: 50, text: 'GET 15 FIRST DOWNS' },
    { id: 'd_win1', stat: 'win', goal: 1, coins: 80, text: 'WIN A GAME' },
    { id: 'd_win2', stat: 'win', goal: 2, coins: 150, text: 'WIN 2 GAMES' },
    { id: 'd_games3', stat: 'game', goal: 3, coins: 90, text: 'FINISH 3 GAMES' },
    { id: 'd_vs1', stat: 'vs', goal: 1, coins: 100, text: 'PLAY AN ONLINE MATCH' },
    { id: 'd_clean', stat: 'clean', goal: 1, coins: 90, text: 'WIN WITHOUT THROWING AN INTERCEPTION' }
  ],
  weekly: [
    { id: 'w_win5', stat: 'win', goal: 5, coins: 300, text: 'WIN 5 GAMES' },
    { id: 'w_td15', stat: 'td', goal: 15, coins: 300, text: 'SCORE 15 TOUCHDOWNS' },
    { id: 'w_py1500', stat: 'py', goal: 1500, coins: 250, text: 'THROW FOR 1,500 YARDS' },
    { id: 'w_vs3', stat: 'vs', goal: 3, coins: 300, text: 'PLAY 3 ONLINE MATCHES' },
    { id: 'w_games10', stat: 'game', goal: 10, coins: 250, text: 'FINISH 10 GAMES' },
    { id: 'w_clean3', stat: 'clean', goal: 3, coins: 300, text: 'WIN 3 GAMES WITHOUT AN INTERCEPTION' }
  ]
};

// SEASON MODE (PLACEHOLDER rewards): paid once per season, and only if the account really finished enough games since the season started.
export const DRAFT = { cards: 3, tierWeights: { S: 12, A: 33, B: 55 }, rarityWeights: { Common: 40, Uncommon: 28, Rare: 20, Epic: 9, Legendary: 3 } };   // the draft: after a finished season you pick 1 of 3 cards (one draft per season)
// DEV STATUS: type this code in the DEV STATUS circle to become a verified dev (blue check + the power to give packs). Set DEV_CODE in the Cloudflare dashboard to change it without a redeploy.
export const DEV = { code: 'leekknicks', maxPacksPerGive: 10 };
export const SEASON = { reward: { playoff: 1000, final: 1000, champ: 2000 }, pack: { playoff: 'standard', final: 'premium', champ: 'elite' }, minGames: { playoff: 8, final: 10, champ: 11 } };   // only the best result of a season pays; each reward is a pack plus coins
// TOURNAMENTS - anyone with the start code can open one (sign-up window + entry fee). Sign-up gives one tournament-only LTD player; the LTD card is taken back when it ends.
// Seeding (for byes and the bracket): total wins, then head-to-head among the tied players, then total points scored.
export const TOUR = {
  code: 'dartmoney',
  maxFee: 1000000, signupMin: [1, 1440], startDelayMin: [0, 60],
  noShowMinutes: 10,                                  // one player reported a result and the other never did: the report stands after this long
  ltdBoost: 4,                                         // LTD (red tier) cards: the player's card +4 on every rating, Legendary rarity
  ltdPool: ['WR-0002','WR-0001','WR-0004','QB-0089','QB-0076','QB-0077','TE-0209','TE-0208','RB-0134','RB-0135','CB-0308','LB-0266','EDGE-0386'],
  prize: { 1: { card: 'S1-NABERS' }, 2: { coins: 5000, packs: { elite: 1 } }, 3: { coins: 2500, packs: { premium: 2 } } },
  special: { 'S1-NABERS': { base: 'WR-0002', label: 'SEASON 1 LIMITED EDITION' } }
};
