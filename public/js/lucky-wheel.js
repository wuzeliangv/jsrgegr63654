const SEGMENT_DEG = 45;
const SEGMENT_CENTER_OFFSET_DEG = SEGMENT_DEG / 2;
// The wheel artwork is drawn with prize index 0 starting 90deg clockwise from the top pointer.
const POINTER_ANGLE_DEG = 90;

function prizeAngle(index) {
  const safeIndex = Number.isInteger(index) && index >= 0 ? index : 0;
  return safeIndex * SEGMENT_DEG + SEGMENT_CENTER_OFFSET_DEG;
}

function getSpinRotationDelta(prizeIndex, pointerAngleDeg = POINTER_ANGLE_DEG) {
  const angle = prizeAngle(prizeIndex);
  return (pointerAngleDeg - angle + 360) % 360;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { prizeAngle, getSpinRotationDelta };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.expand();
    tg.ready();
    if (tg.MainButton) tg.MainButton.hide();
  }

  const initData = tg ? tg.initData : '';
  const wheel = document.getElementById('wheel');
  const spinBtn = document.getElementById('spin-btn');
  let spinning = false;
  let currentRotation = 0;

  function $(id) { return document.getElementById(id); }

  function setStatusText(remainingGB, canSpin, nextOpenLabel) {
    const remainingText = remainingGB === -1 ? '∞' : String(remainingGB);
    $('status-text').textContent = canSpin
      ? `剩余流量 ${remainingText} GB · 本周还可以转 1 次`
      : `剩余流量 ${remainingText} GB · 本周机会已用完 · ${nextOpenLabel}（周一）再来`;
  }

  function setResult(title, sub, color) {
    $('result-title').textContent = title;
    $('result-sub').textContent = sub;
    $('result-sub').style.color = color || '#b5bfd3';
  }

  function spinToPrize(prizeIndex) {
    const turns = 6 + Math.floor(Math.random() * 2);
    const targetRotation = getSpinRotationDelta(prizeIndex);
    const normalizedRotation = ((currentRotation % 360) + 360) % 360;
    const correction = (targetRotation - normalizedRotation + 360) % 360;
    currentRotation += turns * 360 + correction;
    wheel.style.transform = `rotate(${currentRotation}deg)`;
  }

  async function loadProfile() {
    try {
      const response = await fetch('/api/lucky-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });
      const data = await response.json();
      if (!data.ok) {
        $('status-text').textContent = data.error || '暂时无法读取转盘状态';
        spinBtn.disabled = true;
        return;
      }
      setStatusText(data.remainingGB, data.canSpin, data.nextOpenLabel);
      if (!data.canSpin) {
        spinBtn.disabled = true;
        spinBtn.textContent = '本周已转完';
        if (Number.isInteger(data.prizeIndex)) {
          setResult(data.prizeLabel, `这周已经抽中过了，奖励 ${data.prizeGb} GB 已到账。`, '#f8e6b6');
          spinToPrize(data.prizeIndex);
        }
      }
    } catch (_err) {
      $('status-text').textContent = '转盘状态读取失败，请稍后再试';
      spinBtn.disabled = true;
    }
  }

  spinBtn.addEventListener('click', async () => {
    if (spinning || spinBtn.disabled) return;
    spinning = true;
    spinBtn.disabled = true;
    setResult('转盘启动中...', '这周的奖励已经在路上了。', '#f8e6b6');

    try {
      const response = await fetch('/api/lucky-spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });
      const data = await response.json();

      if (!data.ok) {
        setResult(data.error || '本周已经抽过了', `下次开放时间：${data.nextOpenLabel}（周一）`, '#fbbf24');
        if (Number.isInteger(data.prizeIndex)) {
          spinToPrize(data.prizeIndex);
        }
        setStatusText(data.remainingGB, data.canSpin, data.nextOpenLabel);
        return;
      }

      spinToPrize(data.prizeIndex);
      window.setTimeout(() => {
        setResult(data.prizeLabel, `奖励 ${data.prizeGb} GB 已到账，去用你的新流量吧。`, '#34d399');
        setStatusText(data.remainingGB, data.canSpin, data.nextOpenLabel);
        spinBtn.textContent = '本周已转完';
      }, 4700);
    } catch (_err) {
      setResult('网络错误', '请求没有成功发到服务器，请稍后重试。', '#fb7185');
      spinBtn.disabled = false;
    } finally {
      window.setTimeout(() => {
        spinning = false;
      }, 4800);
    }
  });

  loadProfile();
}
