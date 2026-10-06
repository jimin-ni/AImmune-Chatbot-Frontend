/* =========================================================================
 * 뮤니 32프레임 시트 컨트롤러
 *
 * 시트: img/muni-sheet.png — 8열 x 4행, 셀 256x256, 투명 배경, 번호 = 행*8 + 열 (원본 순서)
 *
 * 시선 매핑
 *  - 프레임마다 "눈동자 중심 - 눈 흰자 중심" 오프셋을 측정해 시선 각도를 구했다.
 *    각도는 화면 좌표 기준: 0 = 오른쪽, 90 = 아래, 180 = 왼쪽, -90 = 위.
 *  - 시선이 6도 이내로 비슷한 프레임은 한 묶음(CLUSTERS)으로 모았다.
 *    같은 묶음 안에서는 시선은 같고 고개 돌림만 다르므로, 커서가 멀수록 뒤쪽 프레임(더 돌린 고개)을 쓴다.
 *  - 시트에는 왼쪽 아래(약 100~180도) 시선이 없다. 그 방향은 가장 가까운 각도의 프레임을 쓴다.
 *  - 프레임 0은 시트의 기본 정면 포즈(눈이 약간 위)다. 커서가 뮤니 얼굴 위에 있을 때 쓴다.
 * ========================================================================= */

const SHEET = {
  src: 'img/muni-sheet.png',
  cell: 256,
  cols: 8,
  crop: { x: 32, y: 26, w: 198, h: 216 }, // 32프레임 합친 외곽 + 여백 (셀 좌표)
  eye: { x: 131.2, y: 122.8 },            // 눈 중심 평균 (셀 좌표)
  front: 0,
  frames: 32,
};

// 각도 오름차순. f = 고개 돌림이 작은 순서
const CLUSTERS = [
  { a: -143, f: [26, 27] },
  { a: -127, f: [28, 29] },
  { a: -106, f: [30] },
  { a: -85,  f: [0, 31] },
  { a: -57,  f: [1, 2, 3, 4, 5, 6, 7] },
  { a: -24,  f: [8] },
  { a: -5,   f: [9, 10, 11] },
  { a: 8,    f: [12] },
  { a: 23,   f: [13, 14, 15] },
  { a: 56,   f: [16] },
  { a: 65,   f: [17] },
  { a: 73,   f: [18] },
  { a: 85,   f: [19] },
  { a: 92,   f: [20, 21] },
  { a: 102,  f: [22, 23] },
  { a: 179,  f: [24, 25] },
];
const FRAME_CLUSTER = [];
CLUSTERS.forEach((c, ci) => c.f.forEach((f) => { FRAME_CLUSTER[f] = ci; }));

// 시선 연출에 쓰는 프레임
const LOOK = { left: 24, right: 10, down: 19, up: 0 };

const circDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createMuni({ canvas, fx, glow }) {
  const img = new Image();
  img.src = SHEET.src;
  await img.decode();

  const ctx = canvas.getContext('2d');
  const body = canvas.parentElement;                 // 이동·찌그러짐 애니메이션을 거는 래퍼
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  let cur = SHEET.front;       // 지금 그려진 프레임
  let aim = SHEET.front;       // 커서/입력창이 가리키는 프레임
  let path = [];               // cur → aim 으로 가는 중간 프레임
  let sticky = null;           // 직전에 고른 묶음(경계에서 떨림 방지)
  let lastPoint = null;        // 마지막으로 바라본 화면 좌표
  let scripted = 0;            // 연출 시선이 도는 동안 커서 반영을 잠시 미룬다 (값 = 연출 번호, 0 = 없음)
  let seq = 0;                 // 연출 번호는 계속 증가시켜 예전 연출이 되살아나지 않게 한다
  let raf = 0;
  let lastStep = 0;

  /* ---------- 그리기 ---------- */
  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    draw();
  }
  function draw() {
    const c = SHEET.crop;
    const sx = (cur % SHEET.cols) * SHEET.cell + c.x;
    const sy = Math.floor(cur / SHEET.cols) * SHEET.cell + c.y;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, c.w, c.h, 0, 0, canvas.width, canvas.height);
    canvas.dataset.frame = String(cur);
  }
  new ResizeObserver(fit).observe(canvas);
  fit();

  /* ---------- 커서 방향 → 프레임 ---------- */
  function clusterPath(from, to) {
    const a = FRAME_CLUSTER[from];
    const b = FRAME_CLUSTER[to];
    if (a === b) return [to];
    const n = CLUSTERS.length;
    const fwd = (b - a + n) % n;
    const dir = fwd <= n - fwd ? 1 : -1;
    const steps = Math.min(fwd, n - fwd);
    if (steps > 5) return [to];                       // 너무 멀면 훑지 않고 한 번에 돌아본다
    const out = [];
    for (let k = 1; k < steps; k++) out.push(CLUSTERS[(a + dir * k + n) % n].f[0]);
    out.push(to);
    return out;
  }

  function setAim(frame) {
    if (frame === aim && !path.length) return;
    aim = frame;
    path = cur === frame ? [] : clusterPath(cur, frame);
    kick();
  }

  function aimAt(x, y) {
    lastPoint = [x, y];
    if (scripted) return;
    const r = canvas.getBoundingClientRect();
    const c = SHEET.crop;
    const ex = r.left + ((SHEET.eye.x - c.x) / c.w) * r.width;
    const ey = r.top + ((SHEET.eye.y - c.y) / c.h) * r.height;
    const dx = x - ex;
    const dy = y - ey;
    const dist = Math.hypot(dx, dy);
    const dead = r.width * 0.2;
    if (dist < dead) { sticky = null; setAim(SHEET.front); return; }

    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    let best = 0;
    for (let i = 1; i < CLUSTERS.length; i++) {
      if (circDiff(ang, CLUSTERS[i].a) < circDiff(ang, CLUSTERS[best].a)) best = i;
    }
    if (sticky !== null && best !== sticky &&
        circDiff(ang, CLUSTERS[sticky].a) <= circDiff(ang, CLUSTERS[best].a) + 7) best = sticky;
    sticky = best;

    const strength = Math.min(1, (dist - dead) / (r.width * 1.2));
    const f = CLUSTERS[best].f;
    setAim(f[Math.round(strength * (f.length - 1))]);
  }

  function aimAtElement(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    aimAt(r.left + r.width / 2, r.top + Math.min(r.height / 2, 60));
  }

  function tick(t) {
    raf = 0;
    if (scripted || !path.length) return;
    const hold = path.length > 1 ? 34 : 70;
    if (t - lastStep >= hold) {
      cur = path.shift();
      lastStep = t;
      draw();
    }
    if (path.length) kick();
  }
  function kick() { if (!raf && !scripted) raf = requestAnimationFrame(tick); }

  /* ---------- 연출용 시선 (눈 굴리기, 두리번) ---------- */
  async function playGaze(steps) {
    if (reduce.matches) return;
    const token = ++seq;
    scripted = token;
    for (const [frame, ms] of steps) {
      if (token !== scripted) return;               // 새 연출이 시작되면 중단
      cur = frame; draw();
      await sleep(ms);
    }
    if (token === scripted) { scripted = 0; resume(); }
  }
  function resume() {
    sticky = null; path = []; aim = -1;
    if (lastPoint) aimAt(lastPoint[0], lastPoint[1]); else setAim(SHEET.front);
  }
  const ring = (ms) => Array.from({ length: SHEET.frames }, (_, i) => [i, ms]);

  /* ---------- 몸 동작 ---------- */
  const ease = 'cubic-bezier(.3,.7,.3,1)';
  const play = (keyframes, opt) => body.animate(keyframes, { easing: ease, ...opt });
  const hopFrames = (lift) => [
    { transform: 'translateY(0) scale(1,1)' },
    { transform: 'translateY(0) scale(1.07,.92)', offset: 0.18 },
    { transform: `translateY(${-lift}%) scale(.96,1.06)`, offset: 0.5 },
    { transform: 'translateY(0) scale(1.06,.94)', offset: 0.8 },
    { transform: 'translateY(0) scale(1,1)' },
  ];

  function sparkles(n) {
    if (!fx) return;
    const colors = ['#ff4fa8', '#ffc83d', '#6aa0ff', '#ff8f7a'];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      s.style.left = 18 + Math.random() * 64 + '%';
      s.style.top = 6 + Math.random() * 40 + '%';
      s.style.setProperty('--s', 10 + Math.random() * 14 + 'px');
      s.style.setProperty('--c', colors[i % colors.length]);
      s.style.animationDelay = Math.random() * 160 + 'ms';
      s.addEventListener('animationend', () => s.remove());
      fx.appendChild(s);
    }
  }

  function confetti(n) {
    const layer = document.createElement('div');
    layer.className = 'confetti';
    const colors = ['#ff4fa8', '#2f5fd0', '#ffc83d', '#ff8f7a', '#6aa0ff'];
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', (Math.random() - 0.5) * 240 + 'px');
      p.style.setProperty('--rot', (Math.random() - 0.5) * 900 + 'deg');
      p.style.setProperty('--d', 1.4 + Math.random() * 1.1 + 's');
      p.style.animationDelay = Math.random() * 260 + 'ms';
      layer.appendChild(p);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3200);
  }

  function pulse() {
    if (!glow) return;
    glow.classList.remove('pulse');
    void glow.offsetWidth;
    glow.classList.add('pulse');
  }

  let thinkingOn = false;
  let sway = null;

  const reactions = {
    // 답을 입력하고 다음으로 넘어갈 때
    happy() {
      play(hopFrames(9), { duration: 620 });
      sparkles(6);
      playGaze([[LOOK.up, 650]]);
    },
    // 입력 중 가볍게 끄덕임
    nod() {
      play([
        { transform: 'translateY(0) scale(1,1)' },
        { transform: 'translateY(3%) scale(1.01,.985)' },
        { transform: 'translateY(0) scale(1,1)' },
      ], { duration: 240 });
    },
    // 필수 항목을 비웠을 때
    oops() {
      play([
        { transform: 'translateX(0)' },
        { transform: 'translateX(-4%) rotate(-2deg)', offset: 0.2 },
        { transform: 'translateX(4%) rotate(2deg)', offset: 0.45 },
        { transform: 'translateX(-3%) rotate(-1.5deg)', offset: 0.7 },
        { transform: 'translateX(0)' },
      ], { duration: 440 });
      playGaze([[LOOK.left, 150], [LOOK.right, 150], [LOOK.left, 130], [SHEET.front, 200]]);
    },
    // 접수 완료
    cheer() {
      play(hopFrames(14), { duration: 560, iterations: 2 });
      sparkles(10);
      confetti(34);
      playGaze([...ring(26), [SHEET.front, 300]]);
    },
    // 접수 실패
    sorry() {
      const a = play([
        { transform: 'none' },
        { transform: 'translateY(2%) scale(1.02,.94) rotate(-3deg)' },
      ], { duration: 500, fill: 'forwards' });
      playGaze([[LOOK.down, 1900]]);
      setTimeout(() => { a.reverse(); a.onfinish = () => a.cancel(); }, 1900);
    },
  };

  function react(name) {
    if (reduce.matches) { if (name === 'happy' || name === 'cheer') pulse(); return; }
    (reactions[name] || (() => {}))();
  }

  // 접수하는 동안 눈을 천천히 굴린다
  async function thinking(on) {
    if (on === thinkingOn) return;
    thinkingOn = on;
    if (reduce.matches) return;
    if (!on) {
      if (sway) { sway.cancel(); sway = null; }
      seq++;                                        // 진행 중인 굴리기를 끊고
      scripted = 0; resume();
      return;
    }
    sway = play([{ transform: 'rotate(-2deg)' }, { transform: 'rotate(2deg)' }],
      { duration: 900, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
    const token = ++seq;
    scripted = token;
    while (thinkingOn && token === scripted) {
      for (let i = 0; i < SHEET.frames && thinkingOn && token === scripted; i++) {
        cur = i; draw();
        await sleep(70);
      }
    }
  }

  return { aimAt, aimAtElement, react, thinking, get frame() { return cur; } };
}
