/* =========================================================================
 * A-IMMUNE 관리자 대시보드
 * - 진행 대기 목록(지침 개정) + 기술 문제(TECH) 확인 + 수동검토(MANUAL)
 * - 데이터: n8n webhook (WF-04 조회·기술확인·수동검토, WF-02 승인/반려)
 * ========================================================================= */

/* ---------------------------------------------------------------------------
 * 0. 설정 — 본인 n8n 주소로 바꿔주세요
 * ------------------------------------------------------------------------- */
const CONFIG = {
  N8N_BASE_URL: 'https://blitzrattle.app.n8n.cloud',   // 실제 n8n 주소
  PENDING_PATH: '/webhook/a-immune-admin-pending',      // WF-04 조회
  DECISION_PATH: '/webhook/a-immune-revision-decision',  // WF-02 승인/반려
  TECH_CONFIRM_PATH: '/webhook/a-immune-tech-confirm',   // WF-04 기술 문제 확인
  MANUAL_REVIEW_PATH: '/webhook/a-immune-manual-review', // WF-04 수동검토 처리
  MANAGER_ID: window.AIMMUNE_MANAGER?.get() ?? 'M-001',   // 현재 담당자 (화면 왼쪽 '관리자 아이디'에서 선택)
  USE_SAMPLE_ON_FAIL: false, // true면 연결 실패 시 샘플 데이터 표시
};

/* ---------------------------------------------------------------------------
 * 1. 전역 상태
 * ------------------------------------------------------------------------- */
const state = {
  items: [],          // 지침 개정 대기 (type GUIDELINE_REVISION)
  techItems: [],      // 기술 문제 (type TECH)
  manualItems: [],    // 수동검토 (type MANUAL)
  guidelines: [],     // 수동검토에서 고를 수 있는 '현재' 지침 (versionId 포함)
  selectedKind: null, // 'REVISION' | 'TECH' | 'MANUAL'
  selectedId: null,   // revisionId 또는 reportId
  rejecting: false,   // 반려 사유 입력 모드
  busy: false,        // 승인·반려·확인 등을 서버에 보내는 중이면 true
  manualDraft: null,  // 수동검토 입력 중인 값 {reportId, mode, guidelineItemId, before, after, reason}
};

/* ---------------------------------------------------------------------------
 * 2. 뱃지 색상
 * ------------------------------------------------------------------------- */
/* 위험도 뱃지 색상 */
function riskStyle(level) {
  // 빨강(가장 위험) → 주황 → 노랑 → 파랑(가장 낮음)
  const map = {
    CRITICAL: { text: 'text-white',     bg: 'bg-[#f0322e]' },
    HIGH:     { text: 'text-[#f27a1a]', bg: 'bg-[#ffeedd]' },
    MEDIUM:   { text: 'text-[#d99a00]', bg: 'bg-[#fff7e2]' },
    LOW:      { text: 'text-[#25a0e2]', bg: 'bg-[#eaf8ff]' },
  };
  return map[String(level || '').toUpperCase()] || { text: 'text-ink/60', bg: 'bg-canvas' };
}

/* 지침 항목 표시 이름: "ID 제목". 제목이 없거나 ID와 같으면(n8n 제목표에 없는 항목) ID만 한 번 */
function guidelineLabel(g) {
  const id = String(g?.itemId ?? '').trim();
  const title = String(g?.title ?? '').trim();
  return esc(!title || title === id ? (id || title) : (id ? `${id} ${title}` : title));
}


/* 위험도 순서 정렬 — CRITICAL > HIGH > MEDIUM > LOW > 값 없음. 같으면 우선순위 번호(작은 쪽 먼저), 그다음 서버 순서 유지 */
const RISK_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
function sortByRisk(list) {
  const key = (x) => RISK_ORDER[String(x.risk?.level || '').toUpperCase()] ?? 4;
  const rank = (x) => Number.isFinite(Number(x.priority?.rank)) && x.priority?.rank !== null ? Number(x.priority.rank) : Infinity;
  return [...list]
    .map((x, i) => ({ x, i }))
    .sort((a, b) => key(a.x) - key(b.x) || (rank(a.x) === rank(b.x) ? 0 : rank(a.x) < rank(b.x) ? -1 : 1) || a.i - b.i)
    .map(o => o.x);
}

/* HTML 이스케이프 */
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------------------------------------------------------------------
 * 바뀐 부분 강조 — 수정 전/후 문장을 단어 단위로 비교해 실제로 바뀐 글자만 표시
 *   ranges: [[시작, 끝), ...] (원문 문자 위치)
 * ------------------------------------------------------------------------- */
const DIFF_SPLIT = /(\s+|[.,!?;:·()\[\]"'“”‘’<>/])/;

function tokenize(text) {
  const out = []; let pos = 0;
  for (const t of String(text ?? '').split(DIFF_SPLIT)) {
    if (t) { out.push({ t, s: pos, e: pos + t.length }); pos += t.length; }
  }
  return out;
}

/* 두 글의 바뀐 구간. 앞뒤 공통 부분을 먼저 떼고 가운데만 LCS로 비교한다 */
function diffRanges(a, b) {
  const A = tokenize(a), B = tokenize(b);
  let p = 0; while (p < A.length && p < B.length && A[p].t === B[p].t) p++;
  let q = 0; while (q < A.length - p && q < B.length - p && A[A.length - 1 - q].t === B[B.length - 1 - q].t) q++;
  const a2 = A.slice(p, A.length - q), b2 = B.slice(p, B.length - q);
  const keepA = new Array(a2.length).fill(false), keepB = new Array(b2.length).fill(false);
  if (a2.length && b2.length && a2.length * b2.length <= 250000) {
    const n = a2.length, m = b2.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      L[i][j] = a2[i].t === b2[j].t ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a2[i].t === b2[j].t) { keepA[i++] = true; keepB[j++] = true; }
      else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
    }
  }
  // 바뀐 단어 사이에 공백·문장부호만 있으면 한 덩어리로 잇고, 공백·문장부호만 바뀐 건 표시하지 않는다
  const toRanges = (toks, keep) => {
    const r = []; let bridge = false;
    toks.forEach((tk, i) => {
      const word = /[\p{L}\p{N}]/u.test(tk.t);              // 글자·숫자가 있는 토큰
      if (!keep[i] && word) {
        if (bridge && r.length) r[r.length - 1][1] = tk.e; else r.push([tk.s, tk.e]);
        bridge = true;
      } else if (!keep[i] && tk.t.trim() && bridge && r.length) {
        // 바뀐 문장부호는 앞 구간에 붙인다 (예: "추천, 인계를"의 쉼표)
      } else if (word) bridge = false;                        // 그대로인 단어가 나오면 구간을 끊는다
    });
    return r;
  };
  return { a: toRanges(a2, keepA), b: toRanges(b2, keepB) };
}

/* 글의 일부(sentence)를 바꾼 경우: 그 문장 위치만큼 구간을 옮겨 전체 지침에 적용 */
function rangesInContent(content, sentence, ranges) {
  const at = sentence ? String(content ?? '').indexOf(sentence) : -1;
  return at < 0 ? null : ranges.map(([s, e]) => [s + at, e + at]);
}

/* 구간을 강조 표시(.chg)로 감싼 HTML. offset = text가 원문에서 시작하는 위치 */
function markText(text, ranges = [], offset = 0) {
  let out = '', pos = 0;
  for (const [s0, e0] of ranges) {
    const s = Math.max(s0 - offset, pos), e = Math.min(e0 - offset, text.length);
    if (e <= s) continue;
    out += esc(text.slice(pos, s)) + `<span class="chg">${esc(text.slice(s, e))}</span>`;
    pos = e;
  }
  return out + esc(text.slice(pos));
}

/* 전체 지침 content를 번호 목록으로 렌더 (줄바꿈 기준) + 바뀐 부분 강조 */
function renderContent(content, ranges = []) {
  const src = String(content ?? '');
  const lines = []; let pos = 0;
  for (const raw of src.split(/(\r?\n)/)) {
    if (!/^\r?\n$/.test(raw) && raw.trim()) {
      const lead = raw.length - raw.trimStart().length;
      const num = raw.trimStart().match(/^\d+[.)]\s*/)?.[0].length || 0;
      lines.push({ text: raw.trim().slice(num), off: pos + lead + num });
    }
    pos += raw.length;
  }
  if (lines.length <= 1) {
    const t = src.trim(), off = src.indexOf(t);
    return `<p class="leading-relaxed">${markText(t, ranges, off)}</p>`;
  }
  return `<ol class="list-decimal space-y-1.5 pl-5 leading-relaxed">${
    lines.map(l => `<li>${markText(l.text, ranges, l.off)}</li>`).join('')
  }</ol>`;
}

/* ---------------------------------------------------------------------------
 * 3. 데이터 가져오기
 * ------------------------------------------------------------------------- */
async function fetchPending() {
  const url = CONFIG.N8N_BASE_URL + CONFIG.PENDING_PATH + '?managerId=' + encodeURIComponent(CONFIG.MANAGER_ID);
  console.log('[A-IMMUNE] 조회 요청 →', url);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(url, { method: 'GET', signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('응답 시간 초과(15초). n8n 워크플로가 Active인지, MySQL 노드가 에러 없이 Respond까지 도달하는지 확인하세요.');
    }
    throw new Error('네트워크/CORS 오류(' + e.message + '). 운영 URL을 브라우저에 직접 열어 확인하세요.');
  } finally {
    clearTimeout(timer);
  }

  console.log('[A-IMMUNE] 응답 status →', res.status);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' — 워크플로 Active 여부 / 웹훅 경로를 확인하세요.');

  const data = await res.json();
  console.log('[A-IMMUNE] 응답 본문 →', data);
  return data; // { ok, items, techItems, techConfirmApi, decisionApi, ... }
}

/* ---------------------------------------------------------------------------
 * 4. 목록 렌더 (지침 개정 + 기술 문제)
 * ------------------------------------------------------------------------- */
function renderList() {
  const wrap = document.getElementById('listWrap');
  const groups = [
    { label: '지침 개정 대기', list: sortByRisk(state.items), card: renderRevisionCard },
    { label: '수동검토', list: state.manualItems, card: renderManualCard },
    { label: '기술 문제', list: sortByRisk(state.techItems), card: renderTechCard },
  ].filter(g => g.list.length);

  if (!groups.length) {
    wrap.innerHTML = `<div class="py-16 text-center text-muted">진행 대기 중인 항목이 없습니다.</div>`;
    return;
  }

  // 항목 종류가 둘 이상일 때만 구역 제목을 붙인다
  const html = groups.map((g, i) => {
    const head = groups.length > 1
      ? `<div class="mb-1 ${i ? 'mt-4' : 'mt-1'} px-1 text-[15px] font-semibold text-ink/50">${g.label} (${g.list.length})</div>`
      : '';
    return head + g.list.map(g.card).join('');
  }).join('');

  wrap.innerHTML = html;

  wrap.querySelectorAll('.card-item').forEach(el => {
    el.addEventListener('click', () => selectItem(el.dataset.kind, el.dataset.id));
  });
}

/* 지침 개정 카드 */
function renderRevisionCard(item) {
  const r = riskStyle(item.risk?.level);
  const active = state.selectedKind === 'REVISION' && item.revisionId === state.selectedId;
  const title = guidelineLabel(item.guideline);
  return `
    <button data-kind="REVISION" data-id="${esc(item.revisionId)}"
      class="card-item w-full rounded-[20px] bg-white p-6 text-left shadow-card transition
             ${active ? 'ring-2 ring-salmon bg-[#fffaf9]' : 'hover:bg-[#fafafa]'}">
      <div class="mb-5 flex items-center justify-between">
        <span class="inline-flex items-center gap-2 rounded-[18px] ${r.bg} px-4 py-1.5 text-[20px] font-medium ${r.text}">
          위험도 <span>${esc(item.risk?.level || '-')}</span>
        </span>
        <span class="text-[20px] text-muted">${item.demo ? DEMO_TAG : esc(item.createdAt || '')}</span>
      </div>
      <div class="mb-1.5 text-[28px] font-semibold [text-wrap:balance]">${title}</div>
      <p class="mb-5 line-clamp-1 text-[22px] text-ink/70">${esc(item.change?.reason || '')}</p>
      <span class="inline-flex items-center gap-2 rounded-[18px] bg-canvas px-4 py-1.5 text-[20px] font-medium">
        AGENT <span>${esc(item.agentId || '-')}</span>
      </span>
    </button>`;
}

/* 기술 문제 카드 */
function renderTechCard(t) {
  const active = state.selectedKind === 'TECH' && t.reportId === state.selectedId;
  const r = riskStyle(t.risk?.level);
  const title = esc(t.complaintType || '기술 문제');
  return `
    <button data-kind="TECH" data-id="${esc(t.reportId)}"
      class="card-item w-full rounded-[20px] bg-white p-6 text-left shadow-card transition
             ${active ? 'ring-2 ring-[#25a0e2] bg-[#f7fbff]' : 'hover:bg-[#fafafa]'}">
      <div class="mb-5 flex items-center justify-between">
        <span class="inline-flex items-center rounded-[18px] bg-[#eaf8ff] px-4 py-1.5 text-[20px] font-medium text-[#25a0e2]">기술 문제</span>
        <span class="text-[20px] text-muted">${t.demo ? DEMO_TAG : esc(t.createdAt || '')}</span>
      </div>
      <div class="mb-1.5 text-[28px] font-semibold [text-wrap:balance]">${title}</div>
      <p class="mb-5 line-clamp-1 text-[22px] text-ink/70">${esc(t.issueRequest || t.classificationReason || '')}</p>
      <div class="flex items-center gap-2">
        <span class="inline-flex items-center gap-2 rounded-[18px] bg-canvas px-4 py-1.5 text-[20px] font-medium">
          AGENT <span>${esc(t.agentName || '-')}</span>
        </span>
        ${t.risk?.level ? `<span class="inline-flex items-center rounded-[18px] ${r.bg} px-4 py-1.5 text-[19px] font-medium ${r.text}">위험도 ${esc(t.risk.level)}</span>` : ''}
      </div>
    </button>`;
}

/* 수동검토 카드 */
const RE_REVIEW = '개정안 반려 - 재검토 필요';
function renderManualCard(m) {
  const active = state.selectedKind === 'MANUAL' && m.reportId === state.selectedId;
  const rereview = m.resolution === RE_REVIEW;
  return `
    <button data-kind="MANUAL" data-id="${esc(m.reportId)}"
      class="card-item w-full rounded-[20px] bg-white p-6 text-left shadow-card transition
             ${active ? 'ring-2 ring-ink bg-[#fafafa]' : 'hover:bg-[#fafafa]'}">
      <div class="mb-5 flex items-center justify-between">
        <span class="inline-flex items-center whitespace-nowrap rounded-[18px] bg-ink px-4 py-1.5 text-[20px] font-medium text-white">수동검토</span>
        <span class="whitespace-nowrap text-[20px] text-muted">${m.demo ? DEMO_TAG : esc(m.createdAt || '')}</span>
      </div>
      <div class="mb-1.5 text-[28px] font-semibold [text-wrap:balance]">${esc(m.complaintType || '수동검토')}</div>
      <p class="mb-5 line-clamp-1 text-[22px] text-ink/70">${esc(m.issueRequest || m.resolution || '')}</p>
      <div class="flex flex-wrap items-center gap-2">
        <span class="inline-flex items-center gap-2 rounded-[18px] bg-canvas px-4 py-1.5 text-[20px] font-medium">
          AGENT <span>${esc(m.agentId || m.agentName || '-')}</span>
        </span>
        ${rereview ? '<span class="inline-flex items-center whitespace-nowrap rounded-[18px] bg-[#fff6f4] px-4 py-1.5 text-[20px] font-medium text-salmon">반려 후 재검토</span>' : ''}
      </div>
    </button>`;
}

/* ---------------------------------------------------------------------------
 * 5. 상세 열기 / 렌더
 * ------------------------------------------------------------------------- */
function selectItem(kind, id) {
  if (state.busy) return; // 처리 중에 다른 카드를 열면 엉뚱한 카드가 지워질 수 있다
  state.selectedKind = kind;
  state.selectedId = id;
  state.rejecting = false;
  state.manualDraft = null;
  const layout = document.getElementById('layout');
  const opening = !layout.classList.contains('detail-open');
  const col = document.getElementById('listCol');
  const x0 = opening ? col.getBoundingClientRect().left : 0;
  layout.classList.add('detail-open');
  renderList();
  renderDetail();
  if (opening) slideListLeft(col, x0);
}

/* 상세가 처음 열릴 때: 가운데 있던 목록이 왼쪽으로 스르륵 이동 (1.5s, 빠르게 출발해 천천히 멈춤)
 * 자리를 먼저 바꾼 뒤, 원래 위치에서 출발하는 것처럼 되돌려 놓고 0으로 움직인다(FLIP). */
const SLIDE = { duration: 1500, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
function slideListLeft(col, x0) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !col.animate) return;
  const k = document.getElementById('stage').getBoundingClientRect().width / 2560 || 1; // 캔버스 축소 비율
  const dx = (x0 - col.getBoundingClientRect().left) / k;
  if (Math.abs(dx) < 1) return;
  col.getAnimations().forEach(a => a.cancel());
  col.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], SLIDE);
  // 상세는 목록이 비켜 주는 동안 서서히 나타난다
  document.getElementById('detailCol').animate([{ opacity: 0 }, { opacity: 1 }],
    { duration: 900, delay: 250, easing: 'ease-out', fill: 'backwards' });
}

function getSelected() {
  if (state.selectedKind === 'MANUAL') {
    return state.manualItems.find(m => m.reportId === state.selectedId) || null;
  }
  if (state.selectedKind === 'TECH') {
    return state.techItems.find(t => t.reportId === state.selectedId) || null;
  }
  return state.items.find(i => i.revisionId === state.selectedId) || null;
}

function renderDetail() {
  const box = document.getElementById('detailWrap');
  const item = getSelected();
  if (!item) { box.innerHTML = ''; return; }

  // 상세 패널 제목 전환
  const h = document.querySelector('#detailCol h2');
  if (h) h.textContent = { TECH: '기술 문제 확인', MANUAL: '수동검토' }[state.selectedKind] || '지침서 개정 승인';

  if (state.selectedKind === 'MANUAL') { renderManualDetail(item); return; }
  if (state.selectedKind === 'TECH') { renderTechDetail(item); return; }
  renderRevisionDetail(item);
}

/* 지침 개정 상세 (기존 유지) */
function renderRevisionDetail(item) {
  const box = document.getElementById('detailWrap');
  const p = riskStyle(item.risk?.level);
  const title = guidelineLabel(item.guideline);
  const curVer = esc(item.currentVersion?.versionNumber || 'v1.0');
  const candVer = esc(item.candidateVersion?.versionNumber || 'v1.1');
  const priorityReason = [item.priority?.reason, item.risk?.level].filter(Boolean).map(esc).join(' / ');
  const evidenceIds = Array.isArray(item.evidence?.reportIds) ? item.evidence.reportIds : [];
  // 바뀐 부분: 수정 전/후 문장끼리 비교하고, 같은 구간을 전체 지침에도 표시
  const before = item.change?.beforeSentence || '', after = item.change?.afterSentence || '';
  const curC = item.currentVersion?.content || '', candC = item.candidateVersion?.content || '';
  const sd = before !== after ? diffRanges(before, after) : { a: [], b: [] };
  let curR = rangesInContent(curC, before, sd.a), candR = rangesInContent(candC, after, sd.b);
  if (!curR || !candR) { const fd = curC !== candC ? diffRanges(curC, candC) : { a: [], b: [] }; curR = curR || fd.a; candR = candR || fd.b; }

  box.innerHTML = `
    <div class="flex items-start justify-between">
      <div class="flex flex-wrap items-center gap-3">
        <h3 class="text-[35px] font-semibold">${title}</h3>
        <span class="inline-flex items-center gap-1.5 rounded-[14px] ${p.bg} px-3 py-1 text-[22px] font-medium ${p.text}">
          위험도 <span>${esc(item.risk?.level || '-')}</span>
        </span>
        <span class="inline-flex items-center gap-2 rounded-[14px] bg-ink px-3 py-1 text-[22px] font-medium text-white">
          AGENT <span>${esc(item.agentId || '-')}</span>
        </span>
      </div>
      <div class="text-right text-[21px] text-muted">
        <div>요청일: ${esc(item.firstSubmittedAt || item.createdAt || '')}</div>
        <div>사건 발생일: ${esc(item.occurredAt || '-')}</div>
      </div>
    </div>
    <div class="mt-2 text-[23px] text-ink/70">
      지침서 버전: ${curVer} → ${candVer}
      <span class="mx-2 text-muted">|</span>
      근거 신고 ${esc(item.evidence?.count ?? evidenceIds.length)}건
    </div>

    <section class="mt-8">
      <h4 class="mb-3 text-[27px] font-semibold">개정 사유</h4>
      <p class="text-[23px] leading-relaxed text-ink/90">${esc(item.change?.reason || '')}</p>
    </section>

    <section class="mt-8" data-tour="compare">
      <h4 class="mb-3 text-[27px] font-semibold">개정 제안</h4>
      <div class="flex items-stretch gap-4">
        <div class="flex-1 rounded-[16px] bg-canvas p-5">
          <div class="mb-3 text-[22px] font-medium text-ink/60">수정 전 <span class="ml-1">${curVer}</span></div>
          <p class="text-[23px] leading-relaxed">${markText(before, sd.a)}</p>
        </div>
        <div class="flex items-center text-[31px] text-muted">→</div>
        <div class="flex-1 rounded-[16px] border-2 border-salmon bg-[#fff6f4] p-5">
          <div class="mb-3 text-[22px] font-medium text-salmon">수정 제안 <span class="ml-1">${candVer}</span></div>
          <p class="text-[23px] leading-relaxed">${markText(after, sd.b)}</p>
        </div>
      </div>
    </section>

    <section class="mt-8">
      <h4 class="mb-3 text-[27px] font-semibold">개정 제안 상세</h4>
      <div class="flex items-stretch gap-4">
        <div class="flex-1 overflow-hidden rounded-[16px] bg-canvas">
          <div class="bg-ink px-5 py-3 text-[22px] font-semibold text-white">전체 현재 지침 <span class="ml-1 font-normal opacity-80">${curVer}</span></div>
          <div class="p-5 text-[22px]">${renderContent(curC, curR)}</div>
        </div>
        <div class="flex items-center text-[31px] text-muted">→</div>
        <div class="flex-1 overflow-hidden rounded-[16px] bg-canvas">
          <div class="bg-brand px-5 py-3 text-[22px] font-semibold text-white">전체 후보 지침 <span class="ml-1 font-normal opacity-80">${candVer}</span></div>
          <div class="p-5 text-[22px]">${renderContent(candC, candR)}</div>
        </div>
      </div>
    </section>

    <section class="mt-8">
      <h4 class="mb-4 text-[27px] font-semibold">근거 및 추가 정보</h4>
      <div class="space-y-3 text-[23px]">
        <div class="flex gap-6">
          <span class="w-48 shrink-0 text-ink/60">근거 신고</span>
          <span class="flex flex-wrap gap-2">
            ${evidenceIds.length
              ? evidenceIds.map(id => `<span class="rounded-[12px] bg-canvas px-3 py-1 text-[21px]">${esc(id)}</span>`).join('')
              : '<span class="text-muted">-</span>'}
          </span>
        </div>
        <div class="flex gap-6">
          <span class="w-48 shrink-0 text-ink/60">우선순위 이유</span>
          <span>${priorityReason || '-'}</span>
        </div>
        <div class="flex gap-6">
          <span class="w-48 shrink-0 text-ink/60">담당자</span>
          <span>${esc(item.manager?.name || '')} ${esc(item.manager?.id || '')}</span>
        </div>
        ${item.risk?.reason ? `
        <div class="flex gap-6">
          <span class="w-48 shrink-0 text-ink/60">위험 사유</span>
          <span>${esc(item.risk.reason)}</span>
        </div>` : ''}
      </div>
    </section>

    <div class="sticky bottom-4 mt-10 flex flex-col items-center gap-4">
      ${state.rejecting ? `
      <div id="rejectBox" class="w-[860px] max-w-full rounded-[20px] bg-white px-6 py-5 shadow-[0_4px_24px_rgba(0,0,0,0.12)]">
        <h4 class="mb-3 text-center text-[27px] font-semibold">반려 사유를 기입해 주세요.</h4>
        <textarea id="rejectReason" rows="3"
          class="w-full resize-none rounded-[16px] bg-canvas p-5 text-[23px] outline-none focus:ring-2 focus:ring-salmon"
          placeholder="반려 사유를 입력하세요."></textarea>
      </div>` : ''}
      <div id="actionBar" class="flex items-center gap-4 rounded-[20px] bg-white px-6 py-4 shadow-[0_4px_24px_rgba(0,0,0,0.12)]">
        ${renderActionButtons()}
      </div>
    </div>
  `;
  bindActions();
}

/* 기술 문제 상세 (지침 비교·승인/반려 없음, 확인 버튼만) */
function renderTechDetail(t) {
  const box = document.getElementById('detailWrap');
  const r = riskStyle(t.risk?.level);

  // 크기·여백은 지침 개정 상세와 같은 기준 (제목 35 / 섹션 27 / 본문 23 / 뱃지 22 / 날짜 21)
  const reportBlock = (label, text) => text
    ? `<div class="rounded-[16px] bg-canvas p-5">
         <div class="mb-2 text-[22px] font-medium text-ink/60">${label}</div>
         <p class="whitespace-pre-wrap text-[23px] leading-relaxed">${esc(text)}</p>
       </div>` : '';

  box.innerHTML = `
    <div class="flex items-start justify-between">
      <div class="flex flex-wrap items-center gap-3">
        <h3 class="text-[35px] font-semibold">${esc(t.complaintType || '기술 문제')}</h3>
        <span class="inline-flex items-center rounded-[14px] bg-[#eaf8ff] px-3 py-1 text-[22px] font-medium text-[#25a0e2]">기술 문제</span>
        <span class="inline-flex items-center gap-2 rounded-[14px] bg-ink px-3 py-1 text-[22px] font-medium text-white">
          AGENT <span>${esc(t.agentName || '-')}</span>
        </span>
        ${t.risk?.level ? `<span class="inline-flex items-center gap-1.5 rounded-[14px] ${r.bg} px-3 py-1 text-[22px] font-medium ${r.text}">위험도 <span>${esc(t.risk.level)}</span></span>` : ''}
      </div>
      <div class="text-right text-[21px] text-muted">
        <div>요청일: ${esc(t.createdAt || '')}</div>
        <div>사건 발생일: ${esc(t.occurredAt || '-')}</div>
        <div>신고번호: ${esc(t.reportId || '')}</div>
      </div>
    </div>

    <section class="mt-8">
      <h4 class="mb-3 text-[27px] font-semibold">신고 내용</h4>
      <div class="space-y-3">
        ${reportBlock('사용자 질문', t.userPrompt)}
        ${reportBlock('AI 응답', t.agentResponse)}
        ${reportBlock('문제 / 요청', t.issueRequest)}
        ${(!t.userPrompt && !t.agentResponse && !t.issueRequest) ? '<p class="text-[23px] text-muted">신고 상세 내용이 없습니다.</p>' : ''}
      </div>
    </section>

    <section class="mt-8">
      <h4 class="mb-3 text-[27px] font-semibold">분석 이유</h4>
      <p class="text-[23px] leading-relaxed text-ink/90">${esc(t.classificationReason || '-')}</p>
    </section>

    <section class="mt-8">
      <h4 class="mb-4 text-[27px] font-semibold">근거 및 추가 정보</h4>
      <div class="space-y-3 text-[23px]">
        <div class="flex items-center gap-6">
          <span class="w-48 shrink-0 text-ink/60">위험도</span>
          ${t.risk?.level
            ? `<span class="inline-flex items-center rounded-[14px] ${r.bg} px-3 py-1 text-[22px] font-medium ${r.text}">${esc(t.risk.level)}</span>`
            : '<span class="text-muted">-</span>'}
        </div>
        ${t.risk?.reason ? `
        <div class="flex gap-6">
          <span class="w-48 shrink-0 text-ink/60">위험 사유</span>
          <span>${esc(t.risk.reason)}</span>
        </div>` : ''}
      </div>
    </section>

    <div class="mt-8 rounded-[16px] bg-[#fff7e2] px-6 py-5 text-[21px] leading-relaxed text-ink/70">
      문제를 확인하고 필요한 조치를 완료한 뒤 <b>확인</b>을 눌러 주세요. 확인하면 조치 완료 기록을 저장하고 신고자에게 결과를 안내합니다.
    </div>

    <div class="sticky bottom-4 mt-10 flex justify-center" data-tour="tech-confirm">
      <div class="flex items-center gap-4 rounded-[20px] bg-white px-6 py-4 shadow-[0_4px_24px_rgba(0,0,0,0.12)]">
        <span class="mr-2 text-[23px] font-medium text-ink/70">이 기술 문제를 확인 처리할까요?</span>
        <button id="btnConfirmTech" class="rounded-[14px] bg-[#25a0e2] px-9 py-3 text-[27px] font-semibold text-white hover:opacity-90">확인</button>
      </div>
    </div>
  `;

  document.getElementById('btnConfirmTech')?.addEventListener('click', confirmTech);
}

/* ---------------------------------------------------------------------------
 * 수동검토 상세 — 신고 내용 확인 후 ① 지침 수정안 제출 ② 변경 없이 완료 ③ 메모 저장
 * ------------------------------------------------------------------------- */
const MANUAL_MODES = {
  SUBMIT_REVISION:   { tab: '지침 수정안 제출', desc: '현재 지침의 한 구간을 고쳐 개정안으로 제출합니다. 제출하면 \'지침 개정 대기\'에 올라가 승인·반려를 거칩니다.',
                       prompt: '이 수정안을 제출할까요?', btn: '수정안 제출', cls: 'bg-brand text-white' },
  COMPLETE_NO_CHANGE:{ tab: '변경 없이 완료', desc: '지침을 바꾸지 않고 검토를 끝냅니다. 신고는 처리완료로 바뀌고 신고자에게 결과가 안내됩니다.',
                       prompt: '지침 변경 없이 검토를 완료할까요?', btn: '검토 완료', cls: 'bg-ink text-white' },
  SAVE_NOTE:         { tab: '메모 저장', desc: '검토 메모만 남깁니다. 신고는 수동검토 목록에 계속 남아 있습니다.',
                       prompt: '검토 메모를 저장할까요?', btn: '메모 저장', cls: 'bg-canvas text-ink/70 hover:bg-[#ececec]' },
};

/* 이 신고의 에이전트에 해당하는 '현재' 지침 목록 */
function manualGuidelines(m) {
  return state.guidelines.filter(g => g.agentId === m.agentId);
}

/* 서버 검증과 같은 기준: 겹치는 위치까지 센다 */
function countOccurrences(text, part) {
  if (!part) return 0;
  let n = 0, i = -1;
  while ((i = text.indexOf(part, i + 1)) >= 0) n++;
  return n;
}

function ensureManualDraft(m) {
  if (state.manualDraft && state.manualDraft.reportId === m.reportId) return state.manualDraft;
  const gl = manualGuidelines(m);
  const preset = gl.find(g => g.guidelineItemId === m.guidelineItemId) || gl[0] || null;
  state.manualDraft = {
    reportId: m.reportId,
    mode: gl.length ? 'SUBMIT_REVISION' : 'COMPLETE_NO_CHANGE',
    guidelineItemId: preset ? preset.guidelineItemId : '',
    before: '', after: '', reason: '',
  };
  return state.manualDraft;
}

/* 화면을 다시 그리기 전에 입력칸의 값을 draft에 옮겨 둔다 */
function syncManualDraft() {
  const d = state.manualDraft;
  if (!d) return;
  const v = (id) => document.getElementById(id)?.value;
  if (v('mrGuideline') !== undefined) d.guidelineItemId = v('mrGuideline');
  if (v('mrBefore') !== undefined) d.before = v('mrBefore');
  if (v('mrAfter') !== undefined) d.after = v('mrAfter');
  if (v('mrReason') !== undefined) d.reason = v('mrReason');
}

function renderManualDetail(m) {
  const box = document.getElementById('detailWrap');
  const d = ensureManualDraft(m);
  const gl = manualGuidelines(m);
  const cur = gl.find(g => g.guidelineItemId === d.guidelineItemId) || null;
  const mode = MANUAL_MODES[d.mode];
  const rereview = m.resolution === RE_REVIEW;

  const reportBlock = (label, text) => text
    ? `<div class="rounded-[16px] bg-canvas p-5">
         <div class="mb-2 text-[22px] font-medium text-ink/60">${label}</div>
         <p class="whitespace-pre-wrap text-[23px] leading-relaxed">${esc(text)}</p>
       </div>` : '';
  const inputCls = 'w-full resize-none rounded-[16px] bg-canvas p-5 text-[23px] leading-relaxed outline-none focus:ring-2 focus:ring-salmon';
  const label = (t, sub) => `<div class="mb-2 flex items-baseline gap-3"><span class="text-[23px] font-semibold">${t}</span>${sub ? `<span class="text-[20px] text-ink/50">${sub}</span>` : ''}</div>`;

  const revisionForm = !gl.length
    ? `<p class="rounded-[16px] bg-canvas p-5 text-[22px] text-ink/70">이 에이전트에서 고를 수 있는 현재 지침이 없습니다.</p>`
    : `
      <div class="space-y-6">
        <div>
          ${label('수정할 지침')}
          <select id="mrGuideline" class="w-full cursor-pointer rounded-[16px] bg-canvas p-4 text-[23px] outline-none focus:ring-2 focus:ring-salmon">
            ${gl.map(g => `<option value="${esc(g.guidelineItemId)}" ${g.guidelineItemId === d.guidelineItemId ? 'selected' : ''}>${esc(g.guidelineItemId)} · v${esc(g.versionNumber)}</option>`).join('')}
          </select>
        </div>
        <div>
          <div class="mb-2 flex items-center justify-between">
            ${label('현재 지침 원문', '고칠 구간을 드래그로 선택하세요')}
            <button id="mrPick" type="button" class="rounded-[14px] bg-ink px-5 py-2 text-[21px] font-semibold text-white hover:opacity-90">선택한 구간 가져오기</button>
          </div>
          <div id="mrCurrent" class="max-h-[320px] select-text overflow-y-auto whitespace-pre-wrap rounded-[16px] bg-canvas p-5 text-[22px] leading-relaxed">${esc(cur?.content || '')}</div>
        </div>
        <div class="flex items-stretch gap-4">
          <div class="flex-1">
            ${label('수정 전 구간', '원문 그대로')}
            <textarea id="mrBefore" rows="4" class="${inputCls}">${esc(d.before)}</textarea>
            <div id="mrBeforeHint" class="mt-2 min-h-[30px] text-[20px]"></div>
          </div>
          <div class="flex items-center pb-8 text-[31px] text-muted">→</div>
          <div class="flex-1">
            ${label('수정 후 구간')}
            <textarea id="mrAfter" rows="4" class="${inputCls}">${esc(d.after)}</textarea>
          </div>
        </div>
      </div>`;

  box.innerHTML = `
    <div class="flex items-start justify-between">
      <div class="flex flex-wrap items-center gap-3">
        <h3 class="text-[35px] font-semibold">${esc(m.complaintType || '수동검토')}</h3>
        <span class="inline-flex items-center rounded-[14px] bg-ink px-3 py-1 text-[22px] font-medium text-white">수동검토</span>
        ${rereview ? '<span class="inline-flex items-center rounded-[14px] bg-[#fff6f4] px-3 py-1 text-[22px] font-medium text-salmon">반려 후 재검토</span>' : ''}
        <span class="inline-flex items-center gap-2 rounded-[14px] bg-canvas px-3 py-1 text-[22px] font-medium">
          AGENT <span>${esc(m.agentId || m.agentName || '-')}</span>
        </span>
      </div>
      <div class="text-right text-[21px] text-muted">
        <div>요청일: ${esc(m.createdAt || '')}</div>
        <div>사건 발생일: ${esc(m.occurredAt || '-')}</div>
        <div>신고번호: ${esc(m.reportId || '')}</div>
      </div>
    </div>

    <section class="mt-8">
      <h4 class="mb-3 text-[27px] font-semibold">신고 내용</h4>
      <div class="space-y-3">
        ${reportBlock('사용자 질문', m.userPrompt)}
        ${reportBlock('AI 응답', m.agentResponse)}
        ${reportBlock('문제 / 요청', m.issueRequest)}
        ${(!m.userPrompt && !m.agentResponse && !m.issueRequest) ? '<p class="text-[23px] text-muted">신고 상세 내용이 없습니다.</p>' : ''}
      </div>
    </section>

    <section class="mt-8">
      <h4 class="mb-4 text-[27px] font-semibold">검토 정보</h4>
      <div class="space-y-3 text-[23px]">
        <div class="flex gap-6"><span class="w-48 shrink-0 text-ink/60">검토 사유</span><span>${esc(m.resolution || '-')}</span></div>
        ${m.reasonCode ? `<div class="flex gap-6"><span class="w-48 shrink-0 text-ink/60">분석 결과</span><span>${esc(m.reasonCode)}</span></div>` : ''}
        ${m.guidelineItemId ? `<div class="flex gap-6"><span class="w-48 shrink-0 text-ink/60">관련 지침</span><span>${esc(m.guidelineItemId)}</span></div>` : ''}
      </div>
    </section>

    <section class="mt-8" data-tour="manual-modes">
      <h4 class="mb-3 text-[27px] font-semibold">처리 방법</h4>
      <div class="mb-3 flex flex-wrap gap-3">
        ${Object.entries(MANUAL_MODES).map(([k, v]) => `
          <button type="button" data-mode="${k}"
            class="mr-tab rounded-[14px] px-6 py-3 text-[23px] font-semibold ${k === d.mode ? 'bg-ink text-white' : 'bg-canvas text-ink/70 hover:bg-[#ececec]'}">${v.tab}</button>`).join('')}
      </div>
      <p class="mb-6 text-[21px] leading-relaxed text-ink/60">${mode.desc}</p>
      ${d.mode === 'SUBMIT_REVISION' ? revisionForm : ''}
      <div class="${d.mode === 'SUBMIT_REVISION' ? 'mt-6' : ''}">
        ${label(d.mode === 'SUBMIT_REVISION' ? '수정 사유' : '검토 내용', '필수 · 1000자 이내')}
        <textarea id="mrReason" rows="3" maxlength="1000" class="${inputCls}"
          placeholder="${d.mode === 'SUBMIT_REVISION' ? '왜 이렇게 고치는지 적어 주세요.' : '검토한 내용을 적어 주세요.'}">${esc(d.reason)}</textarea>
      </div>
    </section>

    <div class="sticky bottom-4 mt-10 flex justify-center">
      <div class="flex items-center gap-4 rounded-[20px] bg-white px-6 py-4 shadow-[0_4px_24px_rgba(0,0,0,0.12)]">
        <span class="mr-2 text-[23px] font-medium text-ink/70">${mode.prompt}</span>
        <button id="btnManualSubmit" class="rounded-[14px] ${mode.cls} px-9 py-3 text-[27px] font-semibold hover:opacity-90">${mode.btn}</button>
      </div>
    </div>
  `;
  bindManualActions(m);
  updateBeforeHint();
}

/* '수정 전 구간'이 현재 원문에 정확히 한 번 있는지 바로 알려 준다 */
function updateBeforeHint() {
  const hint = document.getElementById('mrBeforeHint');
  const m = getSelected();
  if (!hint || !m) return;
  const d = state.manualDraft;
  const cur = manualGuidelines(m).find(g => g.guidelineItemId === (document.getElementById('mrGuideline')?.value || d.guidelineItemId));
  const before = document.getElementById('mrBefore')?.value ?? '';
  if (!before) { hint.className = 'mt-2 min-h-[30px] text-[20px] text-ink/50'; hint.textContent = '원문에서 구간을 선택해 가져오거나 그대로 붙여 넣으세요.'; return; }
  const n = countOccurrences(cur?.content ?? '', before);
  if (n === 1) { hint.className = 'mt-2 min-h-[30px] text-[20px] font-medium text-approve'; hint.textContent = '원문에서 정확히 1곳 일치합니다.'; }
  else if (n === 0) { hint.className = 'mt-2 min-h-[30px] text-[20px] font-medium text-[#e10412]'; hint.textContent = '현재 원문에서 찾을 수 없습니다. 글자와 띄어쓰기가 원문과 같아야 합니다.'; }
  else { hint.className = 'mt-2 min-h-[30px] text-[20px] font-medium text-[#e10412]'; hint.textContent = `원문에 ${n}곳 있습니다. 한 곳만 가리키도록 더 길게 선택해 주세요.`; }
}

function bindManualActions(m) {
  const $ = (id) => document.getElementById(id);
  document.querySelectorAll('.mr-tab').forEach(b => b.addEventListener('click', () => {
    if (state.busy) return;
    syncManualDraft();
    state.manualDraft.mode = b.dataset.mode;
    renderManualDetail(m);
  }));
  $('mrGuideline')?.addEventListener('change', () => {
    if (state.busy) return;
    syncManualDraft();
    state.manualDraft.before = ''; state.manualDraft.after = ''; // 다른 지침이면 구간이 달라진다
    renderManualDetail(m);
  });
  $('mrBefore')?.addEventListener('input', updateBeforeHint);
  // 버튼을 눌러도 드래그한 선택이 풀리지 않게 한다
  $('mrPick')?.addEventListener('mousedown', (e) => e.preventDefault());
  $('mrPick')?.addEventListener('click', () => {
    const src = $('mrCurrent');
    const sel = window.getSelection();
    const text = sel && sel.rangeCount && src.contains(sel.anchorNode) && src.contains(sel.focusNode) ? sel.toString() : '';
    if (!text) { alert('아래 \'현재 지침 원문\'에서 고칠 구간을 드래그로 선택한 뒤 눌러 주세요.'); return; }
    $('mrBefore').value = text;
    if (!$('mrAfter').value) $('mrAfter').value = text; // 고치기 쉽게 같은 글을 먼저 채워 둔다
    updateBeforeHint();
    $('mrAfter').focus();
  });
  $('btnManualSubmit')?.addEventListener('click', submitManual);
}

/* 지침 개정 액션 버튼 */
function renderActionButtons() {
  if (state.rejecting) {
    return `
      <span class="mr-2 text-[23px] font-medium text-ink/70">이 개정안을 반려할까요?</span>
      <button id="btnCancel" class="rounded-[14px] bg-canvas px-7 py-3 text-[27px] font-semibold text-ink/70 hover:bg-[#ececec]">취소</button>
      <button id="btnRejectSubmit" class="rounded-[14px] bg-ink px-7 py-3 text-[27px] font-semibold text-white hover:opacity-90">반려 제출</button>`;
  }
  if (getSelected()?.staleBase) {
    return `
      <span class="mr-2 text-[23px] font-medium text-[#d99a00]">기준 지침이 바뀌어 승인할 수 없습니다. 반려 후 다시 검토해 주세요.</span>
      <button id="btnApprove" disabled data-keep-disabled class="cursor-not-allowed rounded-[14px] bg-brand px-9 py-3 text-[27px] font-semibold text-white opacity-30">승인</button>
      <button id="btnReject" class="rounded-[14px] bg-ink px-9 py-3 text-[27px] font-semibold text-white hover:opacity-90">반려</button>`;
  }
  return `
    <span class="mr-2 text-[23px] font-medium text-ink/70">해당 개정 제안과 수정에 동의하시나요?</span>
    <button id="btnApprove" class="rounded-[14px] bg-brand px-9 py-3 text-[27px] font-semibold text-white hover:opacity-90">승인</button>
    <button id="btnReject" class="rounded-[14px] bg-ink px-9 py-3 text-[27px] font-semibold text-white hover:opacity-90">반려</button>`;
}

/* ---------------------------------------------------------------------------
 * 6. 승인 / 반려 / 기술확인 동작
 * ------------------------------------------------------------------------- */
function bindActions() {
  const $ = (id) => document.getElementById(id);
  if (state.rejecting) {
    $('btnCancel')?.addEventListener('click', () => { state.rejecting = false; renderDetail(); });
    $('btnRejectSubmit')?.addEventListener('click', submitReject);
  } else {
    $('btnApprove')?.addEventListener('click', approve);
    $('btnReject')?.addEventListener('click', () => {
      state.rejecting = true;
      renderDetail();
      const t = document.getElementById('rejectReason');
      t?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      t?.focus();
    });
  }
}

/* 처리 중에는 같은 줄의 버튼을 모두 막는다.
 * 누른 버튼은 그대로 두고 '처리 중…'으로 바뀌며, 나머지는 연하게(opacity-30) 보인다. */
const ACTION_BTNS = '#detailWrap .sticky button:not([data-keep-disabled])';
function lockActions(activeBtn) {
  state.busy = true;
  document.querySelectorAll(ACTION_BTNS).forEach(b => {
    b.disabled = true;
    b.classList.add(b === activeBtn ? 'cursor-wait' : 'opacity-30', ...(b === activeBtn ? [] : ['cursor-not-allowed']));
  });
  document.querySelectorAll('#detailWrap textarea, #detailWrap select').forEach(t => { t.disabled = true; });
}
function unlockActions() {
  state.busy = false;
  document.querySelectorAll(ACTION_BTNS).forEach(b => {
    b.disabled = false;
    b.classList.remove('cursor-wait', 'opacity-30', 'cursor-not-allowed');
  });
  document.querySelectorAll('#detailWrap textarea, #detailWrap select').forEach(t => { t.disabled = false; });
}

/* 결정 전송 공통 (POST JSON) */
async function postJson(path, payload) {
  const url = CONFIG.N8N_BASE_URL + path;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    // 서버가 보낸 안내 문구(예: 기준 버전이 바뀜, 권한 없음)를 그대로 보여준다
    throw Object.assign(new Error(data.message || ('HTTP ' + res.status)), { status: res.status });
  }
  return data;
}

/* 이미 처리됐거나 기준이 바뀐 건(403/409)이면 서버 기준으로 목록을 다시 불러온다 */
async function reloadAll() {
  state.busy = false;
  state.selectedKind = null; state.selectedId = null; state.rejecting = false; state.manualDraft = null;
  document.getElementById('layout')?.classList.remove('detail-open');
  const d = document.getElementById('detailWrap'); if (d) d.innerHTML = '';
  try { await init(); } catch (_) {}
}
async function refreshIfStale(e) {
  if (e && (e.status === 403 || e.status === 409)) await reloadAll();
}

async function approve() {
  if (window.AIMMUNE_TOUR?.active) return; // 가이드 중에는 실제 요청을 보내지 않는다
  const item = getSelected();
  if (!item || state.busy) return;
  const btn = document.getElementById('btnApprove');
  lockActions(btn);
  if (btn) btn.textContent = '처리 중…';
  try {
    await postJson(CONFIG.DECISION_PATH, {
      revisionId: item.revisionId,
      decision: 'APPROVE',
      rejectionReason: '',
      managerId: CONFIG.MANAGER_ID,
    });
    removeSelected();
  } catch (e) {
    alert('승인 처리에 실패했습니다: ' + e.message);
    unlockActions();
    if (btn) btn.textContent = '승인';
    refreshIfStale(e);
  }
}

async function submitReject() {
  if (window.AIMMUNE_TOUR?.active) return; // 가이드 중에는 실제 요청을 보내지 않는다
  const item = getSelected();
  if (!item || state.busy) return;
  const reason = (document.getElementById('rejectReason')?.value || '').trim();
  if (!reason) {
    alert('반려 사유를 입력해 주세요.');
    document.getElementById('rejectReason')?.focus();
    return;
  }
  const btn = document.getElementById('btnRejectSubmit');
  lockActions(btn);
  if (btn) btn.textContent = '처리 중…';
  try {
    await postJson(CONFIG.DECISION_PATH, {
      revisionId: item.revisionId,
      decision: 'REJECT',
      rejectionReason: reason,
      managerId: CONFIG.MANAGER_ID,
    });
    removeSelected();
  } catch (e) {
    alert('반려 처리에 실패했습니다: ' + e.message);
    unlockActions();
    if (btn) btn.textContent = '반려 제출';
    refreshIfStale(e);
  }
}

async function confirmTech() {
  if (window.AIMMUNE_TOUR?.active) return; // 가이드 중에는 실제 요청을 보내지 않는다
  const t = getSelected();
  if (!t || state.busy) return;
  const btn = document.getElementById('btnConfirmTech');
  lockActions(btn);
  if (btn) btn.textContent = '처리 중…';
  try {
    await postJson(CONFIG.TECH_CONFIRM_PATH, {
      reportId: t.reportId,
      managerId: CONFIG.MANAGER_ID,
    });
    removeSelected();
  } catch (e) {
    alert('확인 처리에 실패했습니다: ' + e.message);
    unlockActions();
    if (btn) btn.textContent = '확인';
    refreshIfStale(e);
  }
}

/* 수동검토 처리 — SUBMIT_REVISION / COMPLETE_NO_CHANGE / SAVE_NOTE */
async function submitManual() {
  if (window.AIMMUNE_TOUR?.active) return; // 가이드 중에는 실제 요청을 보내지 않는다
  const m = getSelected();
  if (!m || state.busy) return;
  syncManualDraft();
  const d = state.manualDraft;
  const reason = d.reason.trim();
  if (!reason) {
    alert(d.mode === 'SUBMIT_REVISION' ? '수정 사유를 입력해 주세요.' : '검토 내용을 입력해 주세요.');
    document.getElementById('mrReason')?.focus();
    return;
  }

  const payload = { reportId: m.reportId, managerId: CONFIG.MANAGER_ID, action: d.mode, reason };
  if (d.mode === 'SUBMIT_REVISION') {
    const g = manualGuidelines(m).find(x => x.guidelineItemId === d.guidelineItemId);
    if (!g) { alert('수정할 지침을 선택해 주세요.'); return; }
    if (!d.before.trim() || !d.after.trim()) { alert('수정 전 구간과 수정 후 구간을 모두 입력해 주세요.'); return; }
    if (d.before === d.after) { alert('수정 전과 수정 후가 같습니다. 실제로 바뀌는 내용을 입력해 주세요.'); return; }
    const n = countOccurrences(g.content ?? '', d.before);
    if (n !== 1) { alert(n ? `수정 전 구간이 원문에 ${n}곳 있습니다. 한 곳만 가리키도록 더 길게 선택해 주세요.` : '수정 전 구간을 현재 지침 원문에서 찾을 수 없습니다.'); return; }
    Object.assign(payload, {
      guidelineItemId: g.guidelineItemId,
      baseVersionId: g.versionId,       // 지침이 그 사이 바뀌었는지 서버가 이 값으로 확인한다
      beforeSentence: d.before,
      afterSentence: d.after,
    });
  } else if (d.mode === 'COMPLETE_NO_CHANGE' && !confirm('지침을 바꾸지 않고 이 신고를 처리완료합니다. 신고자에게 결과가 안내됩니다. 계속할까요?')) {
    return;
  }

  const btn = document.getElementById('btnManualSubmit');
  const label = btn?.textContent;
  lockActions(btn);
  if (btn) btn.textContent = '처리 중…';
  try {
    const data = await postJson(CONFIG.MANUAL_REVIEW_PATH, payload);
    if (d.mode === 'SAVE_NOTE') {
      state.busy = false;
      alert(data.message || '검토 메모를 저장했습니다.');
      state.manualDraft.reason = '';
      renderManualDetail(m);
    } else {
      alert(data.message || '처리했습니다.');
      await reloadAll(); // 새 개정안이 '지침 개정 대기'에 올라오거나, 완료된 신고가 목록에서 빠진다
    }
  } catch (e) {
    alert('수동검토 처리에 실패했습니다: ' + e.message);
    unlockActions();
    if (btn) btn.textContent = label;
    refreshIfStale(e);
  }
}

/* 현재 선택 항목을 목록에서 제거하고 상세 닫기 */
function removeSelected() {
  state.busy = false;
  if (state.selectedKind === 'MANUAL') {
    state.manualItems = state.manualItems.filter(m => m.reportId !== state.selectedId);
  } else if (state.selectedKind === 'TECH') {
    state.techItems = state.techItems.filter(t => t.reportId !== state.selectedId);
  } else {
    state.items = state.items.filter(i => i.revisionId !== state.selectedId);
  }
  state.selectedKind = null;
  state.selectedId = null;
  state.rejecting = false;
  state.manualDraft = null;
  document.getElementById('layout').classList.remove('detail-open');
  document.getElementById('detailWrap').innerHTML = '';
  renderList();
}

/* ---------------------------------------------------------------------------
 * 7. 초기화
 * ------------------------------------------------------------------------- */
async function init() {
  if (CONFIG.N8N_BASE_URL.includes('YOUR-N8N-HOST')) {
    document.getElementById('listWrap').innerHTML =
      `<div class="rounded-2xl bg-white p-6 text-center text-salmon shadow-card">
         dashboard.js의 <b>CONFIG.N8N_BASE_URL</b>을 실제 n8n 주소로 바꿔주세요.
       </div>`;
    return;
  }
  try {
    const data = await fetchPending();
    state.items = Array.isArray(data.items) ? data.items : [];
    state.techItems = Array.isArray(data.techItems) ? data.techItems : [];
    state.manualItems = Array.isArray(data.manualItems) ? data.manualItems : [];
    state.guidelines = Array.isArray(data.guidelines) ? data.guidelines : [];
    if (data.techConfirmApi && data.techConfirmApi.path) CONFIG.TECH_CONFIRM_PATH = data.techConfirmApi.path;
    if (data.manualReviewApi && data.manualReviewApi.path) CONFIG.MANUAL_REVIEW_PATH = data.manualReviewApi.path;
    renderList();
    window.AIMMUNE_TOUR?.maybeAutoStart(); // 첫 방문이면 가이드 시작
  } catch (e) {
    console.error('[A-IMMUNE] 조회 실패:', e);
    document.getElementById('listWrap').innerHTML =
      `<div class="rounded-2xl bg-white p-6 text-[15px] leading-relaxed text-ink shadow-card">
         <div class="mb-2 text-[17px] font-semibold text-salmon">데이터를 불러오지 못했습니다</div>
         <div class="mb-3 rounded-lg bg-canvas p-3 text-ink/80">${esc(e.message)}</div>
         <div class="text-ink/60">
           확인: ① 워크플로 Active 여부 ② 운영 URL 직접 열기
           <span class="break-all">(${esc(CONFIG.N8N_BASE_URL + CONFIG.PENDING_PATH)})</span>
           ③ n8n Executions에서 MySQL 노드 에러 ④ Respond 노드 CORS 헤더
         </div>
       </div>`;
    if (CONFIG.USE_SAMPLE_ON_FAIL) { state.items = SAMPLE_ITEMS; renderList(); }
    if (/[?&]tour=1\b/.test(location.search)) window.AIMMUNE_TOUR?.maybeAutoStart(); // 처리 내역에서 가이드 요청
  }
}

/* ---------------------------------------------------------------------------
 * 8. 샘플 데이터 (n8n 연결 전 화면 확인용, USE_SAMPLE_ON_FAIL=true일 때)
 * ------------------------------------------------------------------------- */
const SAMPLE_ITEMS = [
  {
    revisionId: 'REV-0001', agentId: 'JOY',
    guideline: { itemId: 'G-004', title: '상품·요금제 안내' },
    currentVersion: { versionNumber: 'v1.0', content: '1. 고객의 요구사항을 정확히 파악한다.\n2. 단말, 요금제, 부가서비스를 안내할 때는 현재 유효한 근거자료에서 확인된 정보만 사용한다.' },
    candidateVersion: { versionNumber: 'v1.1', content: '1. 고객의 요구사항을 정확히 파악한다.\n2. 단말, 요금제, 부가서비스를 안내할 때는 현재 유효한 근거자료에서 확인된 정보만 사용하며, 확인되지 않는 상품이나 요금제를 임의로 생성하거나 추천하지 않는다.' },
    change: { beforeSentence: '단말, 요금제, 부가서비스를 안내할 때는 현재 유효한 근거자료에서 확인된 정보만 사용한다.', afterSentence: '단말, 요금제, 부가서비스를 안내할 때는 현재 유효한 근거자료에서 확인된 정보만 사용하며, 확인되지 않는 상품이나 요금제를 임의로 생성하거나 추천하지 않는다.', reason: '잘못된 요금제를 추천함으로써 고객에게 오류를 발생시킴.' },
    evidence: { count: 1, reportIds: ['RPT-20260930-014'] },
    risk: { level: 'HIGH', reason: '잘못된 정보로 인해 고객 피해 가능' },
    priority: { rank: 1, reason: '동일 지침 신고 3건 / 검토순위 1' },
    manager: { id: 'M-001', name: '테스트담당자' },
    createdAt: '2026-09-30 14:40:39',
  },
];

/* ---------------------------------------------------------------------------
 * 9. 가이드(Product Tour)용 훅 — js/tour.js에서 사용
 *    목록이 비어 있으면 예시 카드를 잠시 보여주고, 가이드가 끝나면 실제 목록으로 되돌린다.
 * ------------------------------------------------------------------------- */
const DEMO_TAG = '<span class="rounded-[12px] bg-[#fff7e2] px-3 py-1 text-[18px] font-semibold text-[#d99a00]">예시</span>';
const DEMO_MANUAL = {
  type: 'MANUAL', demo: true, reportId: 'DEMO-MANUAL', agentName: 'JOY', agentId: 'JOY', complaintType: '확인 필요',
  userPrompt: '이번 달 데이터 사용량이 얼마나 남았는지 알려줘', agentResponse: '정확한 잔여량은 확인이 어렵습니다.',
  issueRequest: '잔여량 확인 방법을 안내해 주면 좋겠어요', resolution: '개정안 반려 - 재검토 필요', guidelineItemId: 'G-004', createdAt: '예시',
};
const DEMO_TECH = {
  type: 'TECH', demo: true, reportId: 'DEMO-TECH', agentName: 'JOY', complaintType: '응답 지연',
  issueRequest: '답변이 30초 넘게 나오지 않아요', classificationReason: '응답 지연은 지침 개정이 아니라 기술 확인 대상', risk: { level: 'MEDIUM', reason: '상담 진행이 늦어짐' }, createdAt: '예시',
};
let tourBackup = null;
window.AIMMUNE_DASH = {
  isBusy: () => !!state.busy,
  has: (kind) => (kind === 'MANUAL' ? state.manualItems : kind === 'TECH' ? state.techItems : state.items).length > 0,
  open(kind) {
    const list = kind === 'MANUAL' ? state.manualItems : kind === 'TECH' ? state.techItems : sortByRisk(state.items);
    const first = list[0]; if (!first) return false;
    const id = kind === 'REVISION' ? first.revisionId : first.reportId;
    if (state.selectedKind !== kind || state.selectedId !== id) selectItem(kind, id);
    return true;
  },
  close() {
    state.selectedKind = null; state.selectedId = null; state.rejecting = false; state.manualDraft = null;
    document.getElementById('layout').classList.remove('detail-open');
    document.getElementById('detailWrap').innerHTML = '';
    renderList();
  },
  useDemoIfEmpty() {
    if (state.items.length || state.manualItems.length || state.techItems.length) return false;
    tourBackup = { items: state.items, manualItems: state.manualItems, techItems: state.techItems };
    state.items = SAMPLE_ITEMS.map(x => ({ ...x, demo: true }));
    state.manualItems = [DEMO_MANUAL];
    state.techItems = [DEMO_TECH];
    renderList();
    return true;
  },
  restore() {
    if (!tourBackup) return;
    Object.assign(state, tourBackup); tourBackup = null;
    this.close();
  },
};

// DOM 준비 여부와 무관하게 실행
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

document.getElementById('btnHistory')?.addEventListener('click', () => {
  window.location.href = '/history.html';
});

document.getElementById('btnHome')?.addEventListener('click', () => {
  window.location.href = '/dashboard.html';
});

// 설정 버튼 → 처음 화면(챗봇)
document.getElementById('btnSettings')?.addEventListener('click', () => {
  window.location.href = 'https://aimmune-chatbot-frontend-production.up.railway.app/';
});
