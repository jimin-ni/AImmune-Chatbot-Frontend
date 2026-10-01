/* =========================================================================
 * A-IMMUNE 민원 처리 내역 (조회 전용)
 * - M-001 관리자가 처리 완료된 민원 항목을 카드로 조회
 * - 카드 표시: 요약글 / 에이전트 / 긴급도 / 중복횟수 / 승인·반려 / 반려사유
 * ========================================================================= */

/* ---------------------------------------------------------------------------
 * 0. 설정
 * ------------------------------------------------------------------------- */
const CONFIG = {
  N8N_BASE_URL: 'https://blitzrattle.app.n8n.cloud',
  HISTORY_PATH: '/webhook/a-immune-admin-history', // 처리 내역 조회 (아직 n8n에 없으면 샘플 표시)
  MANAGER_ID: 'M-001',
  USE_SAMPLE_ON_FAIL: true, // 엔드포인트 생성 전엔 샘플로 화면 확인. 연결 후 false 권장
};

/* ---------------------------------------------------------------------------
 * 1. 전역 상태
 * ------------------------------------------------------------------------- */
const state = {
  items: [],       // 전체 내역
  filter: 'ALL',   // ALL | APPROVE | REJECT
};

/* ---------------------------------------------------------------------------
 * 2. 유틸
 * ------------------------------------------------------------------------- */
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 긴급도(위험도) 뱃지 색상 */
function riskStyle(level) {
  const map = {
    CRITICAL: { text: 'text-[#f0322e]', bg: 'bg-[#ffe6e1]' },
    HIGH:     { text: 'text-[#f06548]', bg: 'bg-[#ffe6e1]' },
    MEDIUM:   { text: 'text-[#ffbc0a]', bg: 'bg-[#fff7e2]' },
    LOW:      { text: 'text-[#25a0e2]', bg: 'bg-[#eaf8ff]' },
  };
  return map[String(level || '').toUpperCase()] || { text: 'text-ink/60', bg: 'bg-canvas' };
}

/* 승인/반려 값 정규화 (APPROVE/승인 → APPROVE) */
function normDecision(d) {
  const s = String(d || '').toUpperCase();
  if (s === 'APPROVE' || s === '승인' || s === 'APPROVED') return 'APPROVE';
  if (s === 'REJECT' || s === '반려' || s === 'REJECTED') return 'REJECT';
  return s;
}

/* 여러 필드명을 흡수해서 공통 형태로 매핑 */
function normalizeItem(raw) {
  const decision = normDecision(raw.decision ?? raw.status ?? raw.approvalStatus);
  return {
    id: raw.revisionId || raw.reportId || raw.id || '',
    summary: raw.summary || raw.change?.reason || raw.revisionReason
             || `${raw.guideline?.itemId || ''} ${raw.guideline?.title || ''}`.trim() || '요약 없음',
    agent: raw.agentId || raw.agentName || raw.agent || '-',
    riskLevel: raw.risk?.level || raw.riskLevel || null,
    duplicateCount: Number(
      raw.duplicateCount ?? raw.evidenceCount ?? raw.evidence?.count ?? 0
    ),
    decision, // 'APPROVE' | 'REJECT'
    rejectionReason: raw.rejectionReason || raw.rejectReason || raw.reject_reason || '',
    decidedAt: raw.decidedAt || raw.createdAt || raw.decided_at || '',
    managerId: raw.managerId || raw.manager?.id || raw.decisionMakerId || '',
  };
}

/* ---------------------------------------------------------------------------
 * 3. 데이터 가져오기
 * ------------------------------------------------------------------------- */
async function fetchHistory() {
  const url = CONFIG.N8N_BASE_URL + CONFIG.HISTORY_PATH;
  console.log('[A-IMMUNE] 내역 조회 →', url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(url, { method: 'GET', signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const list = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
  return list.map(normalizeItem);
}

/* ---------------------------------------------------------------------------
 * 4. 필터 바
 * ------------------------------------------------------------------------- */
function renderFilter() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    const active = btn.dataset.filter === state.filter;
    btn.className = 'filter-btn rounded-[12px] px-5 py-2 text-[16px] font-medium transition '
      + (active ? 'bg-ink text-white' : 'text-ink/60 hover:bg-canvas');
  });
}

function bindFilter() {
  document.getElementById('filterBar').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    renderFilter();
    renderCards();
  });
}

/* ---------------------------------------------------------------------------
 * 5. 카드 렌더
 * ------------------------------------------------------------------------- */
function filteredItems() {
  if (state.filter === 'ALL') return state.items;
  return state.items.filter(i => i.decision === state.filter);
}

function statusBadge(decision) {
  if (decision === 'APPROVE') {
    return `<span class="inline-flex items-center gap-1 rounded-[14px] bg-[#e7f7ef] px-3 py-1 text-[15px] font-semibold text-approve">● 승인</span>`;
  }
  if (decision === 'REJECT') {
    return `<span class="inline-flex items-center gap-1 rounded-[14px] bg-[#ffe6e1] px-3 py-1 text-[15px] font-semibold text-brand">● 반려</span>`;
  }
  return `<span class="inline-flex items-center rounded-[14px] bg-canvas px-3 py-1 text-[15px] font-medium text-ink/60">처리</span>`;
}

function renderCard(item) {
  const r = riskStyle(item.riskLevel);
  const isReject = item.decision === 'REJECT';
  return `
    <article class="flex flex-col rounded-[20px] bg-white p-6 shadow-card">
      <!-- 상단: 긴급도 + 승인/반려 -->
      <div class="mb-4 flex items-center justify-between">
        ${item.riskLevel
          ? `<span class="inline-flex items-center rounded-[14px] ${r.bg} px-3 py-1 text-[14px] font-medium ${r.text}">긴급도 ${esc(item.riskLevel)}</span>`
          : `<span></span>`}
        ${statusBadge(item.decision)}
      </div>

      <!-- 요약글 -->
      <h3 class="mb-4 line-clamp-2 text-[20px] font-semibold leading-snug">${esc(item.summary)}</h3>

      <!-- 메타: 에이전트 / 중복횟수 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <span class="inline-flex items-center gap-2 rounded-[14px] bg-canvas px-3 py-1 text-[14px] font-medium">
          AGENT <span>${esc(item.agent)}</span>
        </span>
        <span class="inline-flex items-center gap-1 rounded-[14px] bg-canvas px-3 py-1 text-[14px] font-medium">
          중복 <span>${esc(item.duplicateCount)}</span>건
        </span>
      </div>

      <!-- 반려 사유 (반려일 때만) -->
      ${isReject ? `
        <div class="mb-4 rounded-[14px] bg-[#fff6f4] p-4">
          <div class="mb-1 text-[13px] font-semibold text-brand">반려 사유</div>
          <p class="text-[15px] leading-relaxed text-ink/80">${esc(item.rejectionReason || '사유 미기재')}</p>
        </div>` : ''}

      <!-- 하단: 처리일 / 담당자 -->
      <div class="mt-auto flex items-center justify-between pt-2 text-[13px] text-muted">
        <span>${esc(item.decidedAt || '')}</span>
        <span>${esc(item.managerId || '')}</span>
      </div>
    </article>`;
}

function renderCards() {
  const grid = document.getElementById('cardGrid');
  const list = filteredItems();
  if (!list.length) {
    grid.innerHTML = `<div class="col-span-full py-16 text-center text-muted">해당 내역이 없습니다.</div>`;
    return;
  }
  grid.innerHTML = list.map(renderCard).join('');
}

/* ---------------------------------------------------------------------------
 * 6. 초기화
 * ------------------------------------------------------------------------- */
async function init() {
  renderFilter();
  bindFilter();
  try {
    state.items = await fetchHistory();
  } catch (e) {
    console.warn('[A-IMMUNE] 내역 조회 실패:', e.message);
    if (CONFIG.USE_SAMPLE_ON_FAIL) {
      state.items = SAMPLE_HISTORY.map(normalizeItem); // 샘플도 동일 정규화
    } else {
      document.getElementById('cardGrid').innerHTML =
        `<div class="col-span-full rounded-2xl bg-white p-6 text-center text-salmon shadow-card">
           내역을 불러오지 못했습니다: ${esc(e.message)}
         </div>`;
      return;
    }
  }
  renderCards();
}

/* ---------------------------------------------------------------------------
 * 7. 샘플 데이터 (n8n 엔드포인트 생성 전 화면 확인용)
 * ------------------------------------------------------------------------- */
const SAMPLE_HISTORY = [
  {
    revisionId: 'REV-1759300000-0012',
    summary: '고객 조건과 일치하는 상품이 없을 때 대체 상품을 제안하도록 기준 보완',
    agentId: 'JOY', risk: { level: 'CRITICAL' }, evidenceCount: 3,
    decision: 'APPROVE', decidedAt: '2026-10-01 14:40:39', managerId: 'M-001',
  },
  {
    revisionId: 'REV-1759300000-0031',
    summary: '요금제 안내 시 확인되지 않은 요금제를 임의 생성하지 않도록 명시',
    agentId: 'JOY', risk: { level: 'HIGH' }, evidenceCount: 2,
    decision: 'APPROVE', decidedAt: '2026-10-01 13:22:10', managerId: 'M-001',
  },
  {
    revisionId: 'REV-1759300000-0048',
    summary: '경쟁사 비교 안내 범위를 과도하게 확장한 개정안',
    agentId: 'SAM', risk: { level: 'MEDIUM' }, evidenceCount: 1,
    decision: 'REJECT', rejectionReason: '경쟁사 직접 비교는 내부 정책상 불가. 자사 혜택 중심 안내로 재작성 필요.',
    decidedAt: '2026-10-01 11:05:47', managerId: 'M-001',
  },
  {
    revisionId: 'REV-1759300000-0055',
    summary: '할인·결합 혜택 안내 문구에 조건 누락 보완',
    agentId: '흥부장', risk: { level: 'LOW' }, evidenceCount: 1,
    decision: 'APPROVE', decidedAt: '2026-09-30 17:51:02', managerId: 'M-001',
  },
  {
    revisionId: 'REV-1759300000-0061',
    summary: '개인정보 수집 동의 안내를 생략하는 방향의 개정안',
    agentId: 'JOY', risk: { level: 'CRITICAL' }, evidenceCount: 4,
    decision: 'REJECT', rejectionReason: '개인정보 보호 지침 위반 소지. 동의 안내는 반드시 유지해야 함.',
    decidedAt: '2026-09-30 16:14:33', managerId: 'M-001',
  },
  {
    revisionId: 'REV-1759300000-0072',
    summary: '응답 지연 시 안내 멘트 표준화',
    agentId: 'SAM', risk: { level: 'LOW' }, evidenceCount: 2,
    decision: 'APPROVE', decidedAt: '2026-09-30 10:02:19', managerId: 'M-001',
  },
];

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