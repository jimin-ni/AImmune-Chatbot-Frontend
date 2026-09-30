/* =========================================================================
 * A-IMMUNE 관리자 대시보드
 * - 진행 대기 목록 / 상세 / 승인·반려 흐름
 * - 데이터는 n8n webhook(WF-04 조회, WF-02 결정)에서 가져온다
 * ========================================================================= */

/* ---------------------------------------------------------------------------
 * 0. 설정 — 본인 n8n 주소로 바꿔주세요
 * ------------------------------------------------------------------------- */
const CONFIG = {
  // n8n Webhook 기본 주소 (끝에 / 없이)
  N8N_BASE_URL: 'https://blitzrattle.app.n8n.cloud',  // 실제 n8n 주소
  PENDING_PATH: '/webhook/a-immune-admin-pending',      // WF-04 조회
  DECISION_PATH: '/webhook/a-immune-revision-decision',  // WF-02 승인/반려
  MANAGER_ID: 'M-001',   // 현재 로그인한 관리자 (담당자 표시/결정 전송용)
  USE_SAMPLE_ON_FAIL: false, // true로 바꾸면 연결 실패 시 샘플 데이터 표시
};

/* ---------------------------------------------------------------------------
 * 1. 전역 상태
 * ------------------------------------------------------------------------- */
const state = {
  items: [],        // 진행 대기 목록
  selectedId: null, // 현재 열린 상세의 revisionId
  rejecting: false, // 반려 사유 입력 모드 여부
};

/* ---------------------------------------------------------------------------
 * 2. 우선순위 뱃지 색상 (1=레드, 2=옐로우, 3=블루, 그외=그레이)
 * ------------------------------------------------------------------------- */
function priorityStyle(rank) {
  const map = {
    1: { text: 'text-salmon',  bg: 'bg-[#ffe6e1]' },
    2: { text: 'text-[#ffbc0a]', bg: 'bg-[#fff7e2]' },
    3: { text: 'text-[#25a0e2]', bg: 'bg-[#eaf8ff]' },
  };
  return map[rank] || { text: 'text-ink', bg: 'bg-canvas' };
}

/* HTML 이스케이프 (사용자/DB 텍스트 안전 출력) */
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 전체 지침 content를 번호 목록으로 렌더 (줄바꿈 기준).
 * highlight 문장이 있으면 굵게 강조해 diff를 표현한다. */
function renderContent(content, highlight) {
  const lines = String(content ?? '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const hl = (text) => {
    let out = esc(text);
    if (highlight) {
      const key = esc(highlight.trim());
      if (key && out.includes(key)) {
        out = out.replace(key, `<strong class="font-semibold">${key}</strong>`);
      }
    }
    return out;
  };

  if (lines.length <= 1) return `<p class="leading-relaxed">${hl(content)}</p>`;

  return `<ol class="list-decimal space-y-1.5 pl-5 leading-relaxed">${
    lines.map(line => `<li>${hl(line.replace(/^\d+[.)]\s*/, ''))}</li>`).join('')
  }</ol>`;
}

/* ---------------------------------------------------------------------------
 * 3. 데이터 가져오기
 * ------------------------------------------------------------------------- */
async function fetchPending() {
  const url = CONFIG.N8N_BASE_URL + CONFIG.PENDING_PATH;
  console.log('[A-IMMUNE] 조회 요청 →', url);

  // 15초 안에 응답 없으면 강제 중단 (무한 로딩 방지)
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(url, { method: 'GET', signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('응답 시간 초과(15초). n8n 워크플로가 Active인지, MySQL 노드가 에러 없이 Respond까지 도달하는지 확인하세요.');
    }
    // TypeError: Failed to fetch → 대부분 CORS 또는 주소/네트워크 문제
    throw new Error('네트워크/CORS 오류(' + e.message + '). 운영 URL을 브라우저에 직접 열어 확인하세요.');
  } finally {
    clearTimeout(timer);
  }

  console.log('[A-IMMUNE] 응답 status →', res.status);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' — 워크플로 Active 여부 / 웹훅 경로를 확인하세요.');

  const data = await res.json();
  console.log('[A-IMMUNE] 응답 본문 →', data);
  // WF-04 응답 형태: { ok, count, items:[...] }
  return Array.isArray(data.items) ? data.items : [];
}

/* ---------------------------------------------------------------------------
 * 4. 진행 대기 목록 렌더
 * ------------------------------------------------------------------------- */
function renderList() {
  const wrap = document.getElementById('listWrap');

  if (!state.items.length) {
    wrap.innerHTML = `<div class="py-16 text-center text-muted">진행 대기 중인 개정안이 없습니다.</div>`;
    return;
  }

  wrap.innerHTML = state.items.map(item => {
    const p = priorityStyle(item.priority?.rank);
    const active = item.revisionId === state.selectedId;
    const title = `${esc(item.guideline?.itemId || '')} ${esc(item.guideline?.title || '')}`.trim();

    return `
      <button data-id="${esc(item.revisionId)}"
        class="card-item w-full rounded-[20px] bg-white p-5 text-left shadow-card transition
               ${active ? 'ring-2 ring-salmon bg-[#fffaf9]' : 'hover:bg-[#fafafa]'}">
        <div class="mb-4 flex items-center justify-between">
          <span class="inline-flex items-center gap-1.5 rounded-[14px] ${p.bg} px-3 py-1 text-[15px] font-medium ${p.text}">
            우선순위 <span>${esc(item.priority?.rank ?? '-')}</span>
          </span>
          <span class="text-[15px] text-muted">${esc(item.createdAt || '')}</span>
        </div>
        <div class="mb-1 text-[21px] font-semibold">${title}</div>
        <p class="mb-4 line-clamp-1 text-[15px] text-ink/70">${esc(item.change?.reason || '')}</p>
        <span class="inline-flex items-center gap-2 rounded-[14px] bg-canvas px-3 py-1 text-[15px] font-medium">
          AGENT <span>${esc(item.agentId || '-')}</span>
        </span>
      </button>`;
  }).join('');

  // 카드 클릭 → 상세 열기
  wrap.querySelectorAll('.card-item').forEach(el => {
    el.addEventListener('click', () => selectItem(el.dataset.id));
  });
}

/* ---------------------------------------------------------------------------
 * 5. 상세 열기 / 렌더
 * ------------------------------------------------------------------------- */
function selectItem(id) {
  state.selectedId = id;
  state.rejecting = false;
  document.getElementById('layout').classList.add('detail-open'); // 목록 왼쪽으로 슬라이드
  renderList();      // 선택 카드 강조 갱신
  renderDetail();
}

function getSelected() {
  return state.items.find(i => i.revisionId === state.selectedId) || null;
}

function renderDetail() {
  const item = getSelected();
  const box = document.getElementById('detailWrap');
  if (!item) { box.innerHTML = ''; return; }

  const p = priorityStyle(item.priority?.rank);
  const title = `${esc(item.guideline?.itemId || '')} ${esc(item.guideline?.title || '')}`.trim();
  const curVer = esc(item.currentVersion?.versionNumber || 'v1.0');
  const candVer = esc(item.candidateVersion?.versionNumber || 'v1.1');

  // 우선순위 이유 + 위험도(risk.level) 결합 → "동일 지침 신고 3건 / CRITICAL"
  const priorityReason = [item.priority?.reason, item.risk?.level]
    .filter(Boolean).map(esc).join(' / ');

  const evidenceIds = Array.isArray(item.evidence?.reportIds) ? item.evidence.reportIds : [];

  box.innerHTML = `
    <!-- 헤더 -->
    <div class="flex items-start justify-between">
      <div class="flex flex-wrap items-center gap-3">
        <h3 class="text-[28px] font-semibold">${title}</h3>
        <span class="inline-flex items-center gap-1.5 rounded-[14px] ${p.bg} px-3 py-1 text-[15px] font-medium ${p.text}">
          우선순위 <span>${esc(item.priority?.rank ?? '-')}</span>
        </span>
        <span class="inline-flex items-center gap-2 rounded-[14px] bg-ink px-3 py-1 text-[15px] font-medium text-white">
          AGENT <span>${esc(item.agentId || '-')}</span>
        </span>
      </div>
      <div class="text-right text-[14px] text-muted">
        <div>요청일: ${esc(item.createdAt || '')}</div>
        <div>사건 발생일: ${esc(item.createdAt || '')}</div>
      </div>
    </div>
    <div class="mt-2 text-[16px] text-ink/70">
      지침서 버전: ${curVer} → ${candVer}
      <span class="mx-2 text-muted">|</span>
      근거 신고 ${esc(item.evidence?.count ?? evidenceIds.length)}건
    </div>

    <!-- 개정 사유 -->
    <section class="mt-8">
      <h4 class="mb-3 text-[20px] font-semibold">개정 사유</h4>
      <p class="text-[16px] leading-relaxed text-ink/90">${esc(item.change?.reason || '')}</p>
    </section>

    <!-- 개정 제안 (문장 비교) -->
    <section class="mt-8">
      <h4 class="mb-3 text-[20px] font-semibold">개정 제안</h4>
      <div class="flex items-stretch gap-4">
        <div class="flex-1 rounded-[16px] bg-canvas p-5">
          <div class="mb-3 text-[15px] font-medium text-ink/60">수정 전 <span class="ml-1">${curVer}</span></div>
          <p class="text-[16px] leading-relaxed">${esc(item.change?.beforeSentence || '')}</p>
        </div>
        <div class="flex items-center text-2xl text-muted">→</div>
        <div class="flex-1 rounded-[16px] border-2 border-salmon bg-[#fff6f4] p-5">
          <div class="mb-3 text-[15px] font-medium text-salmon">수정 제안 <span class="ml-1">${candVer}</span></div>
          <p class="text-[16px] font-semibold leading-relaxed">${esc(item.change?.afterSentence || '')}</p>
        </div>
      </div>
    </section>

    <!-- 개정 제안 상세 (전체 지침 비교) -->
    <section class="mt-8">
      <h4 class="mb-3 text-[20px] font-semibold">개정 제안 상세</h4>
      <div class="flex items-stretch gap-4">
        <div class="flex-1 overflow-hidden rounded-[16px] bg-canvas">
          <div class="bg-ink px-5 py-3 text-[15px] font-semibold text-white">전체 현재 지침 <span class="ml-1 font-normal opacity-80">${curVer}</span></div>
          <div class="p-5 text-[15px]">${renderContent(item.currentVersion?.content, item.change?.beforeSentence)}</div>
        </div>
        <div class="flex items-center text-2xl text-muted">→</div>
        <div class="flex-1 overflow-hidden rounded-[16px] bg-canvas">
          <div class="bg-brand px-5 py-3 text-[15px] font-semibold text-white">전체 후보 지침 <span class="ml-1 font-normal opacity-80">${candVer}</span></div>
          <div class="p-5 text-[15px]">${renderContent(item.candidateVersion?.content, item.change?.afterSentence)}</div>
        </div>
      </div>
    </section>

    <!-- 반려 사유 입력 (반려 모드에서만 표시) -->
    <section id="rejectBox" class="mt-8 ${state.rejecting ? '' : 'hidden'}">
      <h4 class="mb-3 text-center text-[20px] font-semibold">반려 사유를 기입해 주세요.</h4>
      <textarea id="rejectReason" rows="3"
        class="w-full resize-none rounded-[16px] bg-canvas p-5 text-[16px] outline-none focus:ring-2 focus:ring-salmon"
        placeholder="반려 사유를 입력하세요."></textarea>
    </section>

    <!-- 근거 및 추가 정보 -->
    <section class="mt-8">
      <h4 class="mb-4 text-[20px] font-semibold">근거 및 추가 정보</h4>
      <div class="space-y-3 text-[16px]">
        <div class="flex gap-6">
          <span class="w-28 shrink-0 text-ink/60">근거 신고</span>
          <span class="flex flex-wrap gap-2">
            ${evidenceIds.length
              ? evidenceIds.map(id => `<span class="rounded-[12px] bg-canvas px-3 py-1 text-[14px]">${esc(id)}</span>`).join('')
              : '<span class="text-muted">-</span>'}
          </span>
        </div>
        <div class="flex gap-6">
          <span class="w-28 shrink-0 text-ink/60">우선순위 이유</span>
          <span>${priorityReason || '-'}</span>
        </div>
        <div class="flex gap-6">
          <span class="w-28 shrink-0 text-ink/60">담당자</span>
          <span>${esc(item.manager?.name || '')} ${esc(item.manager?.id || '')}</span>
        </div>
        ${item.risk?.reason ? `
        <div class="flex gap-6">
          <span class="w-28 shrink-0 text-ink/60">위험 사유</span>
          <span>${esc(item.risk.reason)}</span>
        </div>` : ''}
      </div>
    </section>

    <!-- 플로팅 승인/반려 박스 -->
    <div class="sticky bottom-4 mt-10 flex justify-center">
      <div id="actionBar" class="flex items-center gap-4 rounded-[20px] bg-white px-6 py-4 shadow-[0_4px_24px_rgba(0,0,0,0.12)]">
        ${renderActionButtons()}
      </div>
    </div>
  `;

  bindActions();
}

/* 상태에 따른 버튼 묶음 */
function renderActionButtons() {
  if (state.rejecting) {
    return `
      <span class="mr-2 text-[16px] font-medium text-ink/70">이 개정안을 반려할까요?</span>
      <button id="btnCancel" class="rounded-[14px] bg-canvas px-7 py-3 text-[20px] font-semibold text-ink/70 hover:bg-[#ececec]">취소</button>
      <button id="btnRejectSubmit" class="rounded-[14px] bg-ink px-7 py-3 text-[20px] font-semibold text-white hover:opacity-90">반려 제출</button>`;
  }
  return `
    <span class="mr-2 text-[16px] font-medium text-ink/70">해당 개정 제안과 수정에 동의하시나요?</span>
    <button id="btnApprove" class="rounded-[14px] bg-brand px-9 py-3 text-[20px] font-semibold text-white hover:opacity-90">승인</button>
    <button id="btnReject" class="rounded-[14px] bg-ink px-9 py-3 text-[20px] font-semibold text-white hover:opacity-90">반려</button>`;
}

/* ---------------------------------------------------------------------------
 * 6. 승인 / 반려 동작
 * ------------------------------------------------------------------------- */
function bindActions() {
  const $ = (id) => document.getElementById(id);

  if (state.rejecting) {
    $('btnCancel')?.addEventListener('click', () => {
      state.rejecting = false;
      renderDetail();
    });
    $('btnRejectSubmit')?.addEventListener('click', submitReject);
  } else {
    $('btnApprove')?.addEventListener('click', approve);
    $('btnReject')?.addEventListener('click', () => {
      state.rejecting = true;
      renderDetail();
      // 사유 입력창으로 스크롤 + 포커스
      const t = document.getElementById('rejectReason');
      t?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      t?.focus();
    });
  }
}

/* 결정 전송 공통 */
async function sendDecision(payload) {
  const url = CONFIG.N8N_BASE_URL + CONFIG.DECISION_PATH;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json().catch(() => ({}));
}

async function approve() {
  const item = getSelected();
  if (!item) return;
  const btn = document.getElementById('btnApprove');
  if (btn) { btn.disabled = true; btn.textContent = '처리 중…'; }

  try {
    await sendDecision({
      revisionId: item.revisionId,
      decision: 'APPROVE',        // WF-02는 'APPROVE'/'REJECT'를 기대 (한글 '승인' 아님)
      rejectionReason: '',        // WF-02가 읽는 필드명은 rejectionReason
      managerId: CONFIG.MANAGER_ID,
    });
    removeFromList(item.revisionId);
  } catch (e) {
    alert('승인 처리에 실패했습니다: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '승인'; }
  }
}

async function submitReject() {
  const item = getSelected();
  if (!item) return;
  const reason = (document.getElementById('rejectReason')?.value || '').trim();
  if (!reason) {
    alert('반려 사유를 입력해 주세요.');
    document.getElementById('rejectReason')?.focus();
    return;
  }
  const btn = document.getElementById('btnRejectSubmit');
  if (btn) { btn.disabled = true; btn.textContent = '처리 중…'; }

  try {
    await sendDecision({
      revisionId: item.revisionId,
      decision: 'REJECT',         // WF-02는 'APPROVE'/'REJECT'를 기대
      rejectionReason: reason,    // WF-02가 읽는 필드명은 rejectionReason
      managerId: CONFIG.MANAGER_ID,
    });
    removeFromList(item.revisionId);
  } catch (e) {
    alert('반려 처리에 실패했습니다: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '반려 제출'; }
  }
}

/* 목록에서 제거하고 상세 닫기 */
function removeFromList(id) {
  state.items = state.items.filter(i => i.revisionId !== id);
  state.selectedId = null;
  state.rejecting = false;
  document.getElementById('layout').classList.remove('detail-open');
  document.getElementById('detailWrap').innerHTML = '';
  renderList();
}

/* ---------------------------------------------------------------------------
 * 7. 초기화
 * ------------------------------------------------------------------------- */
async function init() {
  // 설정을 안 바꾼 경우 바로 안내
  if (CONFIG.N8N_BASE_URL.includes('YOUR-N8N-HOST')) {
    document.getElementById('listWrap').innerHTML =
      `<div class="rounded-2xl bg-white p-6 text-center text-salmon shadow-card">
         dashboard.js의 <b>CONFIG.N8N_BASE_URL</b>을 실제 n8n 주소로 바꿔주세요.
       </div>`;
    return;
  }
  try {
    state.items = await fetchPending();
    renderList();
  } catch (e) {
    console.error('[A-IMMUNE] 조회 실패:', e);
    // 실패 원인을 화면에 그대로 노출 (무엇이 문제인지 바로 파악)
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
    // 화면 레이아웃만 보고 싶으면 CONFIG.USE_SAMPLE_ON_FAIL=true 로 샘플 표시
    if (CONFIG.USE_SAMPLE_ON_FAIL) {
      state.items = SAMPLE_ITEMS;
      renderList();
    }
  }
}

/* ---------------------------------------------------------------------------
 * 8. 샘플 데이터 (n8n 연결 전 화면 확인용)
 * ------------------------------------------------------------------------- */
const SAMPLE_ITEMS = [
  {
    revisionId: 'REV-0001', agentId: 'JOY',
    guideline: { itemId: 'G-018', title: '대체 상품 추천' },
    currentVersion: { versionNumber: 'v1.0', content:
      '1. 고객의 요구사항을 정확히 파악한다.\n2. 고객 조건에 정확히 일치하는 상품이 없는 경우 상품 조회 또는 추가 확인이 필요함을 안내한다.\n3. 상품 추천 시에는 가격, 혜택, 주요 사양을 함께 안내한다.\n4. 불확실한 정보는 임의로 안내하지 않으며, 필요한 경우 담당자 확인을 요청한다.\n5. 고객의 추가 문의가 있을 경우, 관련 정보를 재확인하여 안내한다.' },
    candidateVersion: { versionNumber: 'v1.1', content:
      '1. 고객의 요구사항을 정확히 파악한다.\n2. 고객 조건에 정확히 일치하는 상품이 없는 경우 현재 카탈로그에서 가장 가까운 대체 상품을 찾아 제안한다.\n3. 상품 추천 시에는 가격, 혜택, 주요 사양을 함께 안내한다.\n4. 불확실한 정보는 임의로 안내하지 않으며, 필요한 경우 담당자 확인을 요청한다.\n5. 고객의 추가 문의가 있을 경우, 관련 정보를 재확인하여 안내한다.' },
    change: {
      beforeSentence: '고객 조건에 정확히 일치하는 상품이 없는 경우 상품 조회 또는 추가 확인이 필요함을 안내한다.',
      afterSentence: '고객 조건에 정확히 일치하는 상품이 없는 경우 현재 카탈로그에서 가장 가까운 대체 상품을 찾아 제안한다.',
      reason: '고객 조건과 정확히 일치하는 상품이 없을 때 대체 상품을 제시하지 못하는 사례가 반복되어 기준 보완이 필요합니다.',
    },
    evidence: { count: 3, reportIds: ['RPT-20260929-001', 'RPT-20260929-002', 'RPT-20260929-003'] },
    risk: { level: 'CRITICAL', reason: '동일 지침 관련 신고가 단기간 반복 발생' },
    priority: { rank: 1, reason: '동일 지침 신고 3건' },
    manager: { id: 'M-001', name: '김지민 차장' },
    createdAt: '2026-09-29 13:05',
  },
  {
    revisionId: 'REV-0002', agentId: 'SAM',
    guideline: { itemId: 'G-018', title: '대체 상품 추천' },
    currentVersion: { versionNumber: 'v1.0', content: '1. 고객의 요구사항을 정확히 파악한다.\n2. 대체 상품은 안내하지 않는다.' },
    candidateVersion: { versionNumber: 'v1.1', content: '1. 고객의 요구사항을 정확히 파악한다.\n2. 유사 상품이 있으면 대체 상품으로 안내한다.' },
    change: { beforeSentence: '대체 상품은 안내하지 않는다.', afterSentence: '유사 상품이 있으면 대체 상품으로 안내한다.', reason: '대체 상품 제안 기준 보완 필요' },
    evidence: { count: 2, reportIds: ['RPT-20260929-010', 'RPT-20260929-011'] },
    risk: { level: 'MEDIUM', reason: '경미한 반복 신고' },
    priority: { rank: 2, reason: '동일 지침 신고 2건' },
    manager: { id: 'M-001', name: '김지민 차장' },
    createdAt: '2026-09-29 13:05',
  },
  {
    revisionId: 'REV-0003', agentId: '흥부장',
    guideline: { itemId: 'G-018', title: '대체 상품 추천' },
    currentVersion: { versionNumber: 'v1.0', content: '1. 대체 상품 기준 없음.' },
    candidateVersion: { versionNumber: 'v1.1', content: '1. 대체 상품 기준을 명확히 한다.' },
    change: { beforeSentence: '대체 상품 기준 없음.', afterSentence: '대체 상품 기준을 명확히 한다.', reason: '대체 상품 제안 기준 보완 필요' },
    evidence: { count: 1, reportIds: ['RPT-20260929-020'] },
    risk: { level: 'LOW', reason: '단건 신고' },
    priority: { rank: 3, reason: '동일 지침 신고 1건' },
    manager: { id: 'M-001', name: '김지민 차장' },
    createdAt: '2026-09-29 13:05',
  },
];

// DOM이 이미 준비됐으면 즉시 실행 (script 로드 타이밍에 따른 미실행 방지)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}