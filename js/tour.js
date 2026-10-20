/* =========================================================================
 * 관리자 대시보드 가이드 (Product Tour) — 뮤니가 화면을 하나씩 짚어 준다
 *
 * - 오버레이는 #stage(2560x1600 캔버스) 안에 둔다. 그래서 화면 축소 비율과 상관없이
 *   하이라이트·말풍선이 캔버스 좌표로 맞고, 함께 줄어든다.
 * - 가이드 중에는 화면 전체를 막아 실제 버튼이 눌리지 않게 하고,
 *   dashboard.js의 전송 함수도 AIMMUNE_TOUR.active일 때 바로 빠져나간다.
 * - 진행 대기 목록을 다 불러오면(첫 로딩 오버레이가 걷힌 뒤) 매번 자동으로 열린다.
 *   닫은 뒤에는 레일의 뮤니 버튼으로 다시 연다.
 * - 다른 화면(처리 내역)의 뮤니 버튼은 dashboard.html?tour=1 로 보내고, 여기서 1단계부터 연다.
 * - 단계 정의: js/tour-steps.js
 * ========================================================================= */
(function () {
  const W = 2560, H = 1600, MARGIN = 40, GAP = 36, PAD = 14;
  const GIF = { idle: 'img/muni-idle.gif', approve: 'img/muni-approve.gif', reject: 'img/muni-reject.gif', confirm: 'img/muni-confirm.gif' };
  const STILL = 'img/muniForm.png';
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let root, spot, bubble, tail, steps = [], idx = 0, usedDemo = false, lastFocus = null, autoTried = false, token = 0;
  const DASH = () => window.AIMMUNE_DASH;
  const T = { active: false, start, end, maybeAutoStart };
  window.AIMMUNE_TOUR = T;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const stage = () => document.getElementById('stage');

  /* 화면 좌표 → 캔버스 좌표. 스크롤 영역 안의 요소는 보이는 부분만 */
  function rectOf(el) {
    const st = stage().getBoundingClientRect(), k = st.width / W, r = el.getBoundingClientRect();
    let x = (r.left - st.left) / k, y = (r.top - st.top) / k, x2 = x + r.width / k, y2 = y + r.height / k;
    const sp = el.parentElement?.closest('.scroll-y');
    if (sp) {
      const p = sp.getBoundingClientRect();
      x = Math.max(x, (p.left - st.left) / k); y = Math.max(y, (p.top - st.top) / k);
      x2 = Math.min(x2, (p.right - st.left) / k); y2 = Math.min(y2, (p.bottom - st.top) / k);
    }
    return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
  }

  /* 스크롤 영역 안의 대상이 가운데 오도록 */
  function bringIntoView(el) {
    const sp = el.parentElement?.closest('.scroll-y');
    if (!sp) return;
    const k = stage().getBoundingClientRect().width / W;
    const er = el.getBoundingClientRect(), pr = sp.getBoundingClientRect();
    const top = (er.top - pr.top) / k + sp.scrollTop, h = er.height / k;
    sp.scrollTop = Math.max(0, top - Math.max(0, (sp.clientHeight - h) / 2));
  }

  function build() {
    root = document.createElement('div');
    root.className = 'tour-root';
    root.innerHTML = `
      <div class="tour-blocker"></div>
      <div class="tour-spot" aria-hidden="true"></div>
      <div class="tour-bubble" role="dialog" aria-modal="true" aria-labelledby="tourTitle" aria-describedby="tourText">
        <span class="tour-tail" aria-hidden="true"></span>
        <img class="tour-muni" alt="" />
        <div class="tour-body">
          <div class="tour-step" aria-live="polite"></div>
          <h3 id="tourTitle"></h3>
          <p id="tourText"></p>
          <p class="tour-note" hidden></p>
          <div class="tour-actions">
            <button type="button" class="tour-btn tour-skip">건너뛰기</button>
            <span class="grow"></span>
            <button type="button" class="tour-btn tour-prev">이전</button>
            <button type="button" class="tour-btn tour-next">다음</button>
          </div>
        </div>
      </div>`;
    stage().appendChild(root);
    spot = root.querySelector('.tour-spot');
    bubble = root.querySelector('.tour-bubble');
    tail = root.querySelector('.tour-tail');
    root.querySelector('.tour-skip').addEventListener('click', () => end());
    root.querySelector('.tour-prev').addEventListener('click', () => go(idx - 1, -1));
    root.querySelector('.tour-next').addEventListener('click', () => (idx >= steps.length - 1 ? end() : go(idx + 1, 1)));
    root.querySelector('.tour-blocker').addEventListener('click', (e) => e.stopPropagation());
  }

  function onKey(e) {
    if (!T.active) return;
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); root.querySelector('.tour-next').click(); }
    else if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); go(idx - 1, -1); }
    else if (e.key === 'Tab') { // 포커스를 말풍선 안에 가둔다
      const f = [...bubble.querySelectorAll('button:not([hidden])')];
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }
  const onResize = () => T.active && place(steps[idx]);

  async function start() {
    if (T.active || !stage() || !DASH() || DASH().isBusy()) return;
    T.active = true;
    lastFocus = document.activeElement;
    usedDemo = DASH().useDemoIfEmpty();
    steps = (window.AIMMUNE_TOUR_STEPS || []).filter((s) => !s.when || DASH().has(s.when));
    build();
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    go(0, 1);
  }

  function end() {
    if (!T.active) return;
    T.active = false; token++;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    root?.remove(); root = null;
    if (usedDemo) DASH().restore(); else DASH().close();
    usedDemo = false;
    (document.getElementById('btnTour') || lastFocus)?.focus?.();
  }

  /* 목록을 불러온 뒤(로딩 오버레이가 걷힌 뒤) 호출된다. 페이지를 열 때마다 한 번씩 1단계부터 연다.
   * 처리 내역에서 넘어온 ?tour=1 은 주소에서 지워 둔다 */
  function maybeAutoStart() {
    if (autoTried) return;
    const params = new URLSearchParams(location.search);
    const forced = params.get('tour') === '1';
    if (forced) {
      params.delete('tour');
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    }
    autoTried = true;
    setTimeout(start, forced ? 300 : 700);
  }

  /* n번째 단계로. 대상이 없으면 같은 방향으로 건너뛴다 */
  async function go(n, dir) {
    const my = ++token;
    while (n >= 0 && n < steps.length) {
      const s = steps[n];
      if (s.before === 'close') DASH().close();
      else if (s.before) DASH().open(s.before);
      if (s.before) await wait(420); // 목록 열 폭 전환(.35s)이 끝난 뒤 위치를 잰다
      if (my !== token) return;
      const el = s.target ? document.querySelector(s.target) : null;
      if (!s.target || el) {
        if (el) { bringIntoView(el); await wait(60); }
        if (my !== token) return;
        idx = n; render(s, el); return;
      }
      n += dir || 1;
    }
    end();
  }

  function render(s, el) {
    root.querySelector('.tour-step').textContent = `${idx + 1} / ${steps.length}`;
    root.querySelector('#tourTitle').textContent = s.title;
    root.querySelector('#tourText').textContent = s.text;
    const note = root.querySelector('.tour-note');
    note.hidden = !(usedDemo && idx === 0);
    note.textContent = '지금은 대기 건이 없어서 예시 카드로 보여 줄게. 예시는 실제로 처리되지 않아.';
    const img = root.querySelector('.tour-muni');
    img.src = reduced ? STILL : (s.gif || GIF[s.muni] || GIF.idle);
    root.querySelector('.tour-prev').hidden = idx === 0;
    root.querySelector('.tour-next').textContent = idx === steps.length - 1 ? '시작하기' : '다음';
    root.dataset.step = s.id;
    place(s, el);
    root.querySelector('.tour-next').focus({ preventScroll: true });
  }

  /* 하이라이트와 말풍선 위치 */
  function place(s, el = s.target ? document.querySelector(s.target) : null) {
    if (!root) return;
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    if (!el) {
      root.classList.add('dim'); spot.hidden = true; tail.hidden = true;
      bubble.style.left = (W - bw) / 2 + 'px'; bubble.style.top = (H - bh) / 2 + 'px';
      return;
    }
    root.classList.remove('dim'); spot.hidden = false; tail.hidden = false;
    const r = rectOf(el);
    const t = { x: r.x - PAD, y: r.y - PAD, w: r.w + PAD * 2, h: r.h + PAD * 2 };
    Object.assign(spot.style, { left: t.x + 'px', top: t.y + 'px', width: t.w + 'px', height: t.h + 'px' });

    const clampX = (x) => Math.min(Math.max(x, MARGIN), W - MARGIN - bw);
    const clampY = (y) => Math.min(Math.max(y, MARGIN), H - MARGIN - bh);
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    const cands = [
      { side: 'right',  x: t.x + t.w + GAP, y: clampY(cy - bh / 2), ok: t.x + t.w + GAP + bw <= W - MARGIN },
      { side: 'left',   x: t.x - GAP - bw,  y: clampY(cy - bh / 2), ok: t.x - GAP - bw >= MARGIN },
      { side: 'bottom', x: clampX(cx - bw / 2), y: t.y + t.h + GAP, ok: t.y + t.h + GAP + bh <= H - MARGIN },
      { side: 'top',    x: clampX(cx - bw / 2), y: t.y - GAP - bh,  ok: t.y - GAP - bh >= MARGIN },
    ];
    const c = cands.find((k) => k.ok) || { side: 'none', x: clampX(cx - bw / 2), y: clampY(H - MARGIN - bh) };
    bubble.style.left = c.x + 'px'; bubble.style.top = c.y + 'px';

    // 말풍선 꼬리: 대상 쪽 변에서 대상 가운데를 가리킨다
    tail.hidden = c.side === 'none';
    const T_ = 30;
    if (c.side === 'right' || c.side === 'left') {
      const ty = Math.min(Math.max(cy - c.y - T_ / 2, 30), bh - 30 - T_);
      Object.assign(tail.style, { top: ty + 'px', left: c.side === 'right' ? -T_ / 2 + 'px' : bw - T_ / 2 + 'px' });
    } else {
      const tx = Math.min(Math.max(cx - c.x - T_ / 2, 30), bw - 30 - T_);
      Object.assign(tail.style, { left: tx + 'px', top: c.side === 'bottom' ? -T_ / 2 + 'px' : bh - T_ / 2 + 'px' });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnTour')?.addEventListener('click', () => start());
  });
})();
