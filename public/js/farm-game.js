const tg = window.Telegram && window.Telegram.WebApp;
try { if (tg) { tg.ready(); tg.expand(); } } catch (e) {}
const initData = (tg && tg.initData) || '';

const GROUPS = ['普通', 'VIP', 'SVIP', 'SSVIP'];
let state = null;

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
function fmtRemain(sec) {
  if (sec <= 0) return '即将成熟';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h > 0) return h + '小时' + m + '分';
  if (m > 0) return m + '分钟';
  return sec + '秒';
}

// 4 阶段生长（每 6 小时一阶段）
function growStage(p) {
  const total = p.totalSec || 86400;
  const elapsed = Math.max(0, total - (p.remainingSec || 0));
  const ratio = Math.min(1, elapsed / total);
  const B = '/img/farm/';
  if (p.mature) return { icon: '🌾', img: B + 'stage4.png', label: '已成熟', sway: false, ripe: true, pct: 100 };
  if (ratio < 0.25) return { icon: '🌰', img: B + 'stage0.png', label: '种子期', sway: false, pct: ratio * 100 };
  if (ratio < 0.50) return { icon: '🌱', img: B + 'stage1.png', label: '幼苗期', sway: true, pct: ratio * 100 };
  if (ratio < 0.75) return { icon: '🌿', img: B + 'stage2.png', label: '生长期', sway: true, pct: ratio * 100 };
  return { icon: '🌾', img: B + 'stage3.png', label: '成熟前', sway: true, pct: ratio * 100 };
}

// 作物图标：用自托管 SVG，加载失败时回退到 emoji
function cropIcon(img, emoji, extraClass) {
  return '<img class="icon' + (extraClass || '') + '" src="' + img + '?v=4" alt="" '
    + 'onerror="this.outerHTML=&quot;<div class=\\&quot;icon' + (extraClass || '') + '\\&quot;>' + emoji + '</div>&quot;">';
}

async function api(path, body) {
  try {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ initData: initData }, body || {})),
    });
    return await r.json();
  } catch (e) { return { ok: false, error: '网络错误' }; }
}

function render() {
  if (!state) return;
  document.getElementById('seeds').textContent = state.seeds;
  document.getElementById('seedcap').textContent = state.seedCap;
  document.getElementById('unlocked').textContent = state.unlocked;
  document.getElementById('total').textContent = state.totalPlots;
  document.getElementById('grouplabel').textContent = GROUPS[state.group] || '-';
  document.getElementById('yieldgb').textContent = state.cropYieldGb;

  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  state.plots.forEach(function (p) {
    const d = document.createElement('div');
    if (p.locked) {
      d.className = 'plot locked';
      d.innerHTML = '<div class="icon">🔒</div><div class="nm">未解锁</div><div class="st">升级会员开通</div>';
    } else if (!p.planted) {
      d.className = 'plot empty';
      d.innerHTML = '<div class="badge">' + (p.slot + 1) + '</div>';
      d.onclick = function () { plant(p.slot); };
    } else if (p.mature) {
      d.className = 'plot mature';
      d.innerHTML = '<div class="badge">' + (p.slot + 1) + '</div>'
        + '<div class="timer ripe">✨ 收获 +' + p.expectedGb + 'GB</div>'
        + cropIcon('/img/farm/stage4.png', '🌾');
      d.onclick = function () { harvest(p.slot); };
    } else {
      const g = growStage(p);
      d.className = 'plot';
      d.innerHTML = '<div class="badge">' + (p.slot + 1) + '</div>'
        + '<div class="timer">⏳ ' + fmtRemain(p.remainingSec) + '</div>'
        + cropIcon(g.img, g.icon, g.sway ? ' sprout' : '')
        + '<div class="gbar"><i style="width:' + g.pct.toFixed(0) + '%"></i></div>';
    }
    grid.appendChild(d);
  });
}

async function plant(slot) {
  if (state && state.seeds <= 0) { toast('没有种子啦，每天签到可领取种子～'); return; }
  const r = await api('/farm/api/plant', { slot: slot });
  if (r.action && !r.action.ok) { toast(r.action.error || '播种失败'); }
  else { toast('🌱 播种成功'); try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred('light'); } catch (e) {} }
  if (r.ok) { state = r; render(); }
}

async function harvest(slot) {
  const r = await api('/farm/api/harvest', { slot: slot });
  if (r.action && r.action.ok) { toast('✅ 收获 +' + r.action.gainedGb + 'GB'); }
  else if (r.action && r.action.error) { toast(r.action.error); }
  if (r.ok) { state = r; render(); }
  try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); } catch (e) {}
}

async function harvestAll() {
  const r = await api('/farm/api/harvest-all', {});
  if (r.action && r.action.ok) { toast('🌾 收获' + r.action.count + '块 +' + r.action.gainedGb + 'GB'); }
  else { toast('没有可收获的作物'); }
  if (r.ok) { state = r; render(); }
}

// ───────── 邻居农场 / 偷菜 ─────────
let neighbor = null;
const nFarm = document.getElementById('nFarm');

function closeNeighbor() {
  nFarm.classList.remove('show');
  neighbor = null;
  load(); // 回到自家农场,刷新最新状态
}

function renderNeighbor() {
  if (!neighbor) return;
  document.getElementById('nName').textContent = neighbor.victimName || '邻居';
  document.getElementById('nPer').textContent = neighbor.stealPerGb;
  document.getElementById('nLeft').textContent = neighbor.stealLeftToday;

  const ng = document.getElementById('ngrid');
  ng.innerHTML = '';
  (neighbor.plots || []).forEach(function (p) {
    const d = document.createElement('div');
    if (p.locked) {
      d.className = 'plot locked';
      d.innerHTML = '<div class="icon">🔒</div><div class="nm">未解锁</div><div class="st">邻居还没开通</div>';
    } else if (!p.planted) {
      d.className = 'plot empty';
      d.innerHTML = '<div class="badge">' + (p.slot + 1) + '</div><div class="st" style="margin-top:56px;opacity:.75">空地一块</div>';
    } else if (p.mature) {
      if (p.stolenByMe || p.stealableLeftGb <= 0) {
        // 成熟但你偷过 / 已被偷光：仅展示,不可点
        d.className = 'plot taken';
        d.innerHTML = '<div class="badge">' + (p.slot + 1) + '</div>'
          + '<div class="ntag">' + (p.stolenByMe ? '你偷过啦' : '已被偷光') + '</div>'
          + cropIcon('/img/farm/stage4.png', '🌾');
      } else {
        // 成熟可偷：点击偷菜
        d.className = 'plot mature';
        d.innerHTML = '<div class="badge">' + (p.slot + 1) + '</div>'
          + '<div class="ntag">可偷 ' + p.stealableLeftGb + 'GB</div>'
          + '<div class="timer ripe">🥬 偷 +' + neighbor.stealPerGb + 'GB</div>'
          + cropIcon('/img/farm/stage4.png', '🌾');
        d.onclick = function () { steal(p.slot); };
      }
    } else {
      // 生长中：和自家农场一样显示进度,不可偷
      const g = growStage(p);
      d.className = 'plot';
      d.innerHTML = '<div class="badge">' + (p.slot + 1) + '</div>'
        + '<div class="timer">⏳ ' + fmtRemain(p.remainingSec) + '</div>'
        + cropIcon(g.img, g.icon, g.sway ? ' sprout' : '')
        + '<div class="gbar"><i style="width:' + g.pct.toFixed(0) + '%"></i></div>';
    }
    ng.appendChild(d);
  });
}

async function visitNeighbor() {
  const r = await api('/farm/api/visit', {});
  if (!r.ok) { toast(r.error || '没有可逛的农场'); return; }
  neighbor = r;
  renderNeighbor();
  nFarm.classList.add('show');
  nFarm.scrollTop = 0;
}

async function steal(slot) {
  if (!neighbor) return;
  const r = await api('/farm/api/steal', { victimId: neighbor.victimId, slot: slot });
  if (r.ok) {
    toast('🥬 偷到 +' + r.gainedGb + 'GB！今天还能偷 ' + r.stealLeftToday + ' 次');
    try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); } catch (e) {}
    // 本地更新该块的可偷余量与标记,并更新剩余次数
    const p = (neighbor.plots || []).find(function (x) { return x.slot === slot; });
    if (p) {
      p.stealableLeftGb = Math.max(0, p.stealableLeftGb - neighbor.stealPerGb);
      p.stolenByMe = true;
    }
    neighbor.stealLeftToday = r.stealLeftToday;
    renderNeighbor();
    if (r.stealLeftToday <= 0) { toast('今天偷菜次数已用完，明天再来～'); }
  } else {
    toast(r.error || '偷菜失败');
    // 目标可能已变化（被收获/被偷满），换一家
    visitNeighbor();
  }
}

document.getElementById('btnVisit').onclick = visitNeighbor;
document.getElementById('nNext').onclick = visitNeighbor;
document.getElementById('nDone').onclick = closeNeighbor;

async function load() {
  const r = await api('/farm/api/state', {});
  if (!r.ok) { document.getElementById('grid').innerHTML = '<div class="loading">' + (r.error || '加载失败') + '</div>'; return; }
  state = r; render();
}

load();
setInterval(load, 30000);
