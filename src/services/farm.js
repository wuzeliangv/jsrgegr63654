// 农场种菜收流量 —— 单作物 + 种子机制
// 设计：唯一作物🌾 24h成熟、单块固定收5GB；签到送种子(=地块数)、种子上限=地块数；
//       播种消耗1颗种子(不扣流量)、收获给流量；24h成熟天然限制每块地每天1收，无需硬封顶。
const db = require('./database');
const { today } = require('../utils/tgGame');

const GB = 1073741824;

// 唯一作物
const CROP = { id: 'lotus', emoji: '🌙', name: '月华宝莲', hours: 24, yieldGb: 5 };

const PLOTS_BY_LEVEL = [1, 2, 3, 4];  // 普通/VIP/SVIP/SSVIP 解锁地块数（也是种子上限/每日签到发放数）
const TOTAL_PLOTS = 4;

// 偷菜（零和）：偷走的流量从被偷者本茬收获里扣，不凭空增发
const STEAL_PER_GB = 1;            // 每次偷固定 1GB
const STEAL_MAX_PER_PLOT_GB = 2;   // 每块地一茬最多被偷 2GB（= 5GB 的 40%）
const STEAL_DAILY_LIMIT = 5;       // 每人每天最多偷 5 次（封顶 5GB）

function lvl(user) { return Math.min(Math.max(user.trust_level || 0, 0), 3); }
function unlockedPlots(user) { return PLOTS_BY_LEVEL[lvl(user)]; }
function seedCap(user) { return PLOTS_BY_LEVEL[lvl(user)]; }      // 种子上限 = 地块数
function dailySeedGrant(user) { return PLOTS_BY_LEVEL[lvl(user)]; } // 每日签到发放 = 地块数

// 建表（幂等）
function ensureTables() {
  db.getDb().exec(`
    CREATE TABLE IF NOT EXISTS tg_farm_plots (
      user_id INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      crop TEXT NOT NULL,
      planted_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, slot)
    );
    CREATE TABLE IF NOT EXISTS tg_farm_seeds (
      user_id INTEGER PRIMARY KEY,
      seeds INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tg_farm_steals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thief_id INTEGER NOT NULL,        -- 偷菜者 user_id
      victim_id INTEGER NOT NULL,       -- 被偷者 user_id
      slot INTEGER NOT NULL,            -- 被偷的地块
      planted_at INTEGER NOT NULL,      -- 关键：绑定那一茬作物，换茬后即视为新作物
      stolen_gb REAL NOT NULL,
      day TEXT NOT NULL,                -- 偷菜当日(Asia/Shanghai)，用于每日次数统计
      created_at INTEGER NOT NULL,
      UNIQUE(thief_id, victim_id, slot, planted_at)   -- 同一小偷对同一茬只能偷一次
    );
    CREATE INDEX IF NOT EXISTS idx_farm_steals_victim
      ON tg_farm_steals (victim_id, slot, planted_at);
    CREATE INDEX IF NOT EXISTS idx_farm_steals_thief_day
      ON tg_farm_steals (thief_id, day);
  `);
}

// 某一茬作物（victim+slot+planted_at）已被偷走的总 GB
function _stolenFromPlot(victimId, slot, plantedAt) {
  const row = db.getDb().prepare(
    'SELECT COALESCE(SUM(stolen_gb), 0) AS g FROM tg_farm_steals WHERE victim_id = ? AND slot = ? AND planted_at = ?'
  ).get(victimId, slot, plantedAt);
  return row ? row.g : 0;
}

// 小偷今天已偷次数
function stealCountToday(thiefId) {
  const row = db.getDb().prepare(
    'SELECT COUNT(*) AS c FROM tg_farm_steals WHERE thief_id = ? AND day = ?'
  ).get(thiefId, today());
  return row ? row.c : 0;
}

function getSeeds(userId) {
  const row = db.getDb().prepare('SELECT seeds FROM tg_farm_seeds WHERE user_id = ?').get(userId);
  return row ? row.seeds : 0;
}

function setSeeds(userId, n) {
  db.getDb().prepare(`
    INSERT INTO tg_farm_seeds (user_id, seeds) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET seeds = ?
  `).run(userId, n, n);
}

// 签到发放种子：发放 = 地块数，但库存上限 = 地块数。
// 若已满 -> 不发放，返回 {granted:0, full:true, seeds}
function grantDailySeeds(user) {
  ensureTables();
  const cap = seedCap(user);
  const cur = getSeeds(user.id);
  if (cur >= cap) return { granted: 0, full: true, seeds: cur, cap };
  const want = dailySeedGrant(user);
  const next = Math.min(cap, cur + want);
  setSeeds(user.id, next);
  return { granted: next - cur, full: false, seeds: next, cap };
}

// 单块地状态
function plotInfo(user, slot, row, now) {
  const info = { slot, locked: slot >= unlockedPlots(user), crop: null };
  if (info.locked || !row) return info;
  const elapsedSec = Math.floor((now - row.planted_at) / 1000);
  const remainingSec = Math.max(0, CROP.hours * 3600 - elapsedSec);
  info.crop = CROP;
  info.plantedAt = row.planted_at;
  info.mature = remainingSec <= 0;
  info.remainingSec = remainingSec;
  info.totalSec = CROP.hours * 3600;

  const stolen = Math.min(STEAL_MAX_PER_PLOT_GB, _stolenFromPlot(user.id, slot, row.planted_at));
  info.expectedGb = Math.max(0, CROP.yieldGb - stolen);

  return info;
}

// 农场状态
function getState(user) {
  ensureTables();
  const now = Date.now();
  const rows = db.getDb().prepare('SELECT slot, planted_at FROM tg_farm_plots WHERE user_id = ?').all(user.id);
  const map = new Map(rows.map(r => [r.slot, r]));
  const plots = [];
  for (let s = 0; s < TOTAL_PLOTS; s++) plots.push(plotInfo(user, s, map.get(s), now));
  return {
    plots,
    unlocked: unlockedPlots(user),
    seeds: getSeeds(user.id),
    seedCap: seedCap(user),
    cropYieldGb: CROP.yieldGb,
    cropName: CROP.name,
    cropEmoji: CROP.emoji,
    matureCount: plots.filter(p => p.crop && p.mature).length,
  };
}

// 播种：消耗 1 颗种子（不扣流量）
function plant(user, slot) {
  ensureTables();
  if (!Number.isInteger(slot) || slot < 0 || slot >= TOTAL_PLOTS) return { ok: false, error: '无效地块' };
  if (slot >= unlockedPlots(user)) return { ok: false, error: '该地块未解锁，升级会员可解锁更多地块' };
  const occupied = db.getDb().prepare('SELECT 1 FROM tg_farm_plots WHERE user_id = ? AND slot = ?').get(user.id, slot);
  if (occupied) return { ok: false, error: '该地块已有作物' };
  const seeds = getSeeds(user.id);
  if (seeds <= 0) return { ok: false, error: '没有种子啦，每天签到可领取种子～' };

  const tx = db.getDb().transaction(() => {
    setSeeds(user.id, seeds - 1);
    db.getDb().prepare('INSERT INTO tg_farm_plots (user_id, slot, crop, planted_at) VALUES (?, ?, ?, ?)').run(user.id, slot, CROP.id, Date.now());
  });
  tx();
  return { ok: true, crop: CROP, seedsLeft: seeds - 1 };
}

// 收获单块：固定 5GB（×无，单块统一）
// 全程在单个事务内完成，并以 DELETE 行数作为唯一发放门闸，避免“先读后写”竞态导致的重复发放/丢失更新。
function _harvestOne(user, slot, now) {
  return db.getDb().transaction(() => {
    const row = db.getDb().prepare('SELECT planted_at FROM tg_farm_plots WHERE user_id = ? AND slot = ?').get(user.id, slot);
    if (!row) return { gainedGb: 0, skipped: true };
    const matureAt = row.planted_at + CROP.hours * 3600 * 1000;
    if (now < matureAt) return { gainedGb: 0, notMature: true };

    // 零和：扣除这一茬已被邻居偷走的流量，剩余才是本人到手的收成
    const stolen = Math.min(STEAL_MAX_PER_PLOT_GB, _stolenFromPlot(user.id, slot, row.planted_at));
    const netGb = Math.max(0, CROP.yieldGb - stolen);
    const grantBytes = Math.round(netGb * GB);

    // 先删除作物：以受影响行数作为门闸，确保同一块地只会发放一次
    const del = db.getDb().prepare('DELETE FROM tg_farm_plots WHERE user_id = ? AND slot = ?').run(user.id, slot);
    if (del.changes === 0) return { gainedGb: 0, skipped: true };

    // 原子自增，且仅对非无限额(traffic_limit >= 0)用户增加配额
    if (grantBytes > 0) {
      db.getDb().prepare('UPDATE users SET traffic_limit = traffic_limit + ? WHERE id = ? AND traffic_limit >= 0').run(grantBytes, user.id);
    }
    return { gainedGb: netGb, stolenGb: stolen };
  })();
}

function harvest(user, slot) {
  ensureTables();
  if (!Number.isInteger(slot) || slot < 0 || slot >= TOTAL_PLOTS) return { ok: false, error: '无效地块' };
  const res = _harvestOne(user, slot, Date.now());
  if (res.skipped) return { ok: false, error: '该地块无作物' };
  if (res.notMature) return { ok: false, error: '作物还没成熟哦' };
  _unfreezeIfNeeded(user.id);
  return { ok: true, gainedGb: res.gainedGb };
}

function harvestAll(user) {
  ensureTables();
  const now = Date.now();
  const rows = db.getDb().prepare('SELECT slot FROM tg_farm_plots WHERE user_id = ? ORDER BY slot').all(user.id);
  let totalGb = 0, count = 0;
  for (const r of rows) {
    const res = _harvestOne(user, r.slot, now);
    if (res.gainedGb > 0) { totalGb += res.gainedGb; count++; }
  }
  if (count > 0) _unfreezeIfNeeded(user.id);
  return { ok: count > 0, count, gainedGb: +totalGb.toFixed(2) };
}

function _unfreezeIfNeeded(userId) {
  try {
    const user = db.getDb().prepare('SELECT id, username, is_frozen, freeze_reason FROM users WHERE id = ?').get(userId);
    if (user && user.is_frozen && user.freeze_reason === 'traffic_limit' && !db.isTrafficExceeded(userId)) {
      db.unfreezeUser(userId);
      db.addAuditLog(null, 'traffic_limit_unfreeze', `农场收获增加流量后自动解冻: ${user.username}`, 'system');
    }
  } catch (_) { /* 忽略 */ }
}

// 邻居昵称打码，避免暴露真实身份
function _maskName(username) {
  if (!username) return '神秘邻居';
  const s = String(username);
  if (s.length <= 2) return s[0] + '*';
  return s.slice(0, 1) + '***' + s.slice(-1);
}

// 随机找一个“有成熟且未被偷满作物”的邻居农场（无好友系统，纯随机串门）
function getRandomFarm(viewer) {
  ensureTables();
  const now = Date.now();
  // 随机取一批有作物的其他用户，逐个找出可偷的那家
  const candidates = db.getDb().prepare(`
    SELECT DISTINCT p.user_id
    FROM tg_farm_plots p
    JOIN users u ON u.id = p.user_id
    WHERE p.user_id != ? AND COALESCE(u.is_blocked, 0) = 0
    ORDER BY RANDOM()
    LIMIT 30
  `).all(viewer.id);

  for (const c of candidates) {
    const victim = db.getDb().prepare('SELECT id, username, trust_level FROM users WHERE id = ?').get(c.user_id);
    if (!victim) continue;
    const rows = db.getDb().prepare('SELECT slot, planted_at FROM tg_farm_plots WHERE user_id = ?').all(victim.id);
    const map = new Map(rows.map(r => [r.slot, r]));
    // 像自家农场一样,返回全部地块(锁定/空地/生长中/成熟),并在成熟块上附加可偷信息
    const plots = [];
    let stealableCount = 0;
    for (let s = 0; s < TOTAL_PLOTS; s++) {
      const info = plotInfo(victim, s, map.get(s), now);
      const out = {
        slot: s,
        locked: info.locked,
        planted: !!info.crop,
        mature: info.crop ? info.mature : false,
        remainingSec: info.crop ? info.remainingSec : 0,
        totalSec: info.crop ? info.totalSec : 0,
        expectedGb: info.crop ? info.expectedGb : 0,
        stolenByMe: false,
        stealableLeftGb: 0,
      };
      if (info.crop && info.mature) {
        const stolen = _stolenFromPlot(victim.id, s, info.plantedAt);
        out.stealableLeftGb = Math.max(0, STEAL_MAX_PER_PLOT_GB - stolen);
        out.stolenByMe = !!db.getDb().prepare(
          'SELECT 1 FROM tg_farm_steals WHERE thief_id = ? AND victim_id = ? AND slot = ? AND planted_at = ?'
        ).get(viewer.id, victim.id, s, info.plantedAt);
        if (out.stealableLeftGb > 0 && !out.stolenByMe) stealableCount++;
      }
      plots.push(out);
    }
    // 只有这家至少有一块"可偷"的地才串门,保持原有体验
    if (stealableCount > 0) {
      return {
        ok: true,
        victimId: victim.id,
        victimName: _maskName(victim.username),
        cropName: CROP.name,
        cropEmoji: CROP.emoji,
        cropYieldGb: CROP.yieldGb,
        unlocked: unlockedPlots(victim),
        totalPlots: TOTAL_PLOTS,
        stealPerGb: STEAL_PER_GB,
        plots,
        stealLeftToday: Math.max(0, STEAL_DAILY_LIMIT - stealCountToday(viewer.id)),
        dailyLimit: STEAL_DAILY_LIMIT,
      };
    }
  }
  return { ok: false, error: '现在没有可偷的邻居农场，过会儿再来逛逛～' };
}

// 偷一块地：零和——小偷 +1GB，被偷者本茬收获自动少 1GB
function steal(thief, victimId, slot) {
  ensureTables();
  victimId = Number(victimId);
  if (!Number.isInteger(victimId) || victimId === thief.id) return { ok: false, error: '无效目标' };
  if (!Number.isInteger(slot) || slot < 0 || slot >= TOTAL_PLOTS) return { ok: false, error: '无效地块' };
  if (stealCountToday(thief.id) >= STEAL_DAILY_LIMIT) {
    return { ok: false, error: `今天偷菜次数已用完（${STEAL_DAILY_LIMIT} 次），明天再来～` };
  }

  const now = Date.now();
  const day = today();
  const grantBytes = Math.round(STEAL_PER_GB * GB);

  let result;
  try {
    result = db.getDb().transaction(() => {
      // 1. 目标作物必须存在且已成熟
      const row = db.getDb().prepare('SELECT planted_at FROM tg_farm_plots WHERE user_id = ? AND slot = ?').get(victimId, slot);
      if (!row) return { error: '这块地已经空了' };
      const matureAt = row.planted_at + CROP.hours * 3600 * 1000;
      if (now < matureAt) return { error: '作物还没成熟，偷不了' };

      // 2. 这一茬未被偷满（40% 上限）
      const stolen = _stolenFromPlot(victimId, slot, row.planted_at);
      if (stolen + STEAL_PER_GB > STEAL_MAX_PER_PLOT_GB) return { error: '这块地已经被偷光啦' };

      // 3. 每日次数事务内兜底
      if (stealCountToday(thief.id) >= STEAL_DAILY_LIMIT) return { error: `今天偷菜次数已用完（${STEAL_DAILY_LIMIT} 次）` };

      // 4. UNIQUE 门闸：同一小偷对同一茬只能偷一次
      try {
        db.getDb().prepare(
          'INSERT INTO tg_farm_steals (thief_id, victim_id, slot, planted_at, stolen_gb, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(thief.id, victimId, slot, row.planted_at, STEAL_PER_GB, day, now);
      } catch (_) {
        return { error: '你已经偷过这块地啦，换一块吧' };
      }

      // 5. 给小偷加流量（零和：被偷者收获时自动少这部分；无限额用户不累加）
      db.getDb().prepare('UPDATE users SET traffic_limit = traffic_limit + ? WHERE id = ? AND traffic_limit >= 0').run(grantBytes, thief.id);
      return { ok: true };
    })();
  } catch (_) {
    return { ok: false, error: '偷菜失败，请稍后再试' };
  }

  if (result.error) return { ok: false, error: result.error };
  _unfreezeIfNeeded(thief.id);
  return {
    ok: true,
    gainedGb: STEAL_PER_GB,
    stealLeftToday: Math.max(0, STEAL_DAILY_LIMIT - stealCountToday(thief.id)),
  };
}

module.exports = {
  CROP, TOTAL_PLOTS, PLOTS_BY_LEVEL,
  STEAL_PER_GB, STEAL_MAX_PER_PLOT_GB, STEAL_DAILY_LIMIT,
  ensureTables, getState, plant, harvest, harvestAll,
  getRandomFarm, steal, stealCountToday,
  getSeeds, setSeeds, grantDailySeeds, unlockedPlots, seedCap, dailySeedGrant,
};
