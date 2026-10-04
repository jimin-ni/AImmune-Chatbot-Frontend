/* =========================================================================
 * A-IMMUNE 민원 처리 내역 (조회 전용) · Figma 120:1819 "관리자 대시보드 - 민원처리 내역"
 * - M-001 관리자가 처리 완료된 민원 항목을 조회
 * - 승인 처리 항목 / 반려 처리 항목 두 섹션으로 구분, 4열 카드 그리드
 * ========================================================================= */

/* ---------------------------------------------------------------------------
 * 0. 설정
 * ------------------------------------------------------------------------- */
const CONFIG = {
  N8N_BASE_URL: 'https://blitzrattle.app.n8n.cloud',
  HISTORY_PATH: '/webhook/a-immune-admin-history', // 처리 내역 조회
  MANAGER_ID: 'M-001',
  USE_SAMPLE_ON_FAIL: true, // 엔드포인트 생성 전엔 샘플로 화면 확인. 연결 후 false 권장
};

/* ---------------------------------------------------------------------------
 * 1. 전역 상태
 * ------------------------------------------------------------------------- */
const state = { items: [] };

/* ---------------------------------------------------------------------------
 * 2. 유틸
 * ------------------------------------------------------------------------- */
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 긴급도(위험도) 뱃지 색상 — Figma: CRITICAL/HIGH 살구, MEDIUM 노랑, LOW 파랑 */
function riskStyle(level) {
  const map = {
    CRITICAL: { text: '#f0322e', bg: '#ffe7e2' },
    HIGH:     { text: '#f06548', bg: '#ffe7e2' },
    MEDIUM:   { text: '#f5a623', bg: '#fff4de' },
    LOW:      { text: '#25a0e2', bg: '#ebf8ff' },
  };
  return map[String(level || '').toUpperCase()] || { text: '#808080', bg: '#f4f4f4' };
}

/* 승인/반려 값 정규화 */
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
    duplicateCount: Number(raw.duplicateCount ?? raw.evidenceCount ?? raw.evidence?.count ?? 0),
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
 * 4. 카드 렌더 (Figma 민원처리내역_승인 / _반려)
 * ------------------------------------------------------------------------- */
function metaPill(label, value) {
  return `
    <span class="flex h-[36px] min-w-[141px] w-fit items-center gap-[6px] whitespace-nowrap rounded-[20px] bg-canvas px-[12px] text-[20px] font-medium text-ink">
      ${label} <span>${esc(value)}</span>
    </span>`;
}

function riskPill(level) {
  if (!level) return '';
  const r = riskStyle(level);
  return `
    <span class="flex w-fit items-center gap-[6px] whitespace-nowrap rounded-[20px] px-[12px] py-[6px] text-[20px] font-medium"
          style="background:${r.bg};color:${r.text}">
      긴급도 <span>${esc(String(level).toUpperCase())}</span>
    </span>`;
}

function renderCard(item) {
  const isReject = item.decision === 'REJECT';
  const badge = isReject
    ? `<span class="rounded-[20px] bg-ink px-[12px] py-[6px] text-[22px] font-bold leading-none text-white">반려</span>`
    : `<span class="rounded-[20px] bg-approve px-[12px] py-[6px] text-[22px] font-bold leading-none text-white">승인</span>`;

  const rejectBox = isReject ? `
      <div class="flex h-[64px] w-full items-center rounded-[20px] bg-canvas px-[24px]">
        <p class="text-[17px] font-semibold leading-snug text-[#e10412]">${esc(item.rejectionReason || '사유 미기재')}</p>
      </div>` : '';

  return `
    <article class="flex w-full flex-col gap-[30px] rounded-[20px] bg-white p-[20px] shadow-card">
      <!-- 상단: 상태 뱃지 + 처리일 -->
      <div class="flex h-[39px] w-full items-center justify-between">
        ${badge}
        <span class="text-[20px] font-medium text-[#c4c4c4]">${esc(item.decidedAt || '')}</span>
      </div>

      <!-- 요약글 -->
      <h3 class="line-clamp-2 min-h-[72px] text-[28px] font-semibold leading-normal text-ink">${esc(item.summary)}</h3>

      ${rejectBox}

      <!-- 긴급도 / AGENT / 중복 민원 -->
      <div class="flex flex-col gap-[10px]">
        ${riskPill(item.riskLevel)}
        <div class="flex flex-wrap items-center gap-[10px]">
          ${metaPill('AGENT', item.agent)}
          ${metaPill('중복 민원', item.duplicateCount + '건')}
        </div>
      </div>
    </article>`;
}

/* ---------------------------------------------------------------------------
 * 5. 섹션 렌더
 * ------------------------------------------------------------------------- */
function renderSection(title, list, emptyText) {
  const cards = list.length
    ? list.map(renderCard).join('')
    : `<div class="col-span-4 py-10 text-[22px] text-muted">${emptyText}</div>`;
  return `
    <section class="mb-[60px]">
      <h3 class="mb-[30px] text-[34px] font-semibold leading-none">
        ${title} <span class="text-muted">${list.length}개</span>
      </h3>
      <div class="grid grid-cols-4 gap-[18px]">
        ${cards}
      </div>
    </section>`;
}

function render() {
  const root = document.getElementById('sections');
  const approved = state.items.filter(i => i.decision === 'APPROVE');
  const rejected = state.items.filter(i => i.decision === 'REJECT');
  root.innerHTML =
    renderSection('승인 처리 항목', approved, '승인 처리된 항목이 없습니다.') +
    renderSection('반려 처리 항목', rejected, '반려 처리된 항목이 없습니다.');
}

/* ---------------------------------------------------------------------------
 * 6. 초기화
 * ------------------------------------------------------------------------- */
async function init() {
  try {
    state.items = await fetchHistory();
  } catch (e) {
    console.warn('[A-IMMUNE] 내역 조회 실패:', e.message);
    if (CONFIG.USE_SAMPLE_ON_FAIL) {
      state.items = SAMPLE_HISTORY.map(normalizeItem);
    } else {
      document.getElementById('sections').innerHTML =
        `<div class="rounded-[20px] bg-white p-6 text-center text-salmon shadow-card">
           내역을 불러오지 못했습니다: ${esc(e.message)}
         </div>`;
      return;
    }
  }
  render();
}

/* ---------------------------------------------------------------------------
 * 7. 샘플 데이터 (n8n 엔드포인트 생성 전 화면 확인용)
 * ------------------------------------------------------------------------- */
const SAMPLE_HISTORY = [
  { revisionId: 'REV-0012', summary: '할인 결합 혜택 안내 문구의 조건 누락 보완', agentId: 'JOY',
    risk: { level: 'CRITICAL' }, evidenceCount: 3, decision: 'APPROVE', decidedAt: '2026-09-29 13:05', managerId: 'M-001' },
  { revisionId: 'REV-0031', summary: '요금제 안내 시 확인되지 않은 요금제를 임의 생성하지 않도록 명시', agentId: 'JOY',
    risk: { level: 'HIGH' }, evidenceCount: 2, decision: 'APPROVE', decidedAt: '2026-09-29 11:22', managerId: 'M-001' },
  { revisionId: 'REV-0055', summary: '할인·결합 혜택 안내 문구에 조건 누락 보완', agentId: '흥부장',
    risk: { level: 'LOW' }, evidenceCount: 1, decision: 'APPROVE', decidedAt: '2026-09-28 17:51', managerId: 'M-001' },
  { revisionId: 'REV-0072', summary: '응답 지연 시 안내 멘트 표준화', agentId: 'SAM',
    risk: { level: 'LOW' }, evidenceCount: 2, decision: 'APPROVE', decidedAt: '2026-09-28 10:02', managerId: 'M-001' },
  { revisionId: 'REV-0090', summary: '고객 조건과 일치하는 상품이 없을 때 대체 상품을 제안하도록 기준 보완', agentId: 'JOY',
    risk: { level: 'MEDIUM' }, evidenceCount: 2, decision: 'APPROVE', decidedAt: '2026-09-27 15:40', managerId: 'M-001' },
  { revisionId: 'REV-0048', summary: '할인 결합 혜택 안내 문구의 조건 누락 보완', agentId: 'JOY',
    risk: { level: 'LOW' }, evidenceCount: 3, decision: 'REJECT',
    rejectionReason: '개인정보 보호 지침 위반 소지', decidedAt: '2026-09-29 13:05', managerId: 'M-001' },
  { revisionId: 'REV-0061', summary: '경쟁사 비교 안내 범위를 과도하게 확장한 개정안', agentId: 'SAM',
    risk: { level: 'MEDIUM' }, evidenceCount: 1, decision: 'REJECT',
    rejectionReason: '경쟁사 직접 비교는 내부 정책상 불가. 자사 혜택 중심 안내로 재작성 필요.', decidedAt: '2026-09-28 16:14', managerId: 'M-001' },
];

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* ---------------------------------------------------------------------------
 * 8. NavBar 네비게이션 (두 화면 공통)
 * ------------------------------------------------------------------------- */
document.getElementById('btnHistory')?.addEventListener('click', () => {
  window.location.href = '/history.html';
});
document.getElementById('btnHome')?.addEventListener('click', () => {
  window.location.href = '/dashboard.html';
});
