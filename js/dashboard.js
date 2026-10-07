/* =========================================================================
 * A-IMMUNE 관리자 대시보드
 * - 진행 대기 목록(지침 개정) + 기술 문제(TECH) 확인
 * - 데이터: n8n webhook (WF-04 조회, WF-02 승인/반려, WF-04 기술확인)
 * ========================================================================= */

/* ---------------------------------------------------------------------------
 * 0. 설정 — 본인 n8n 주소로 바꿔주세요
 * ------------------------------------------------------------------------- */
const CONFIG = {
  N8N_BASE_URL: 'https://blitzrattle.app.n8n.cloud',   // 실제 n8n 주소
  PENDING_PATH: '/webhook/a-immune-admin-pending',      // WF-04 조회
  DECISION_PATH: '/webhook/a-immune-revision-decision',  // WF-02 승인/반려
  TECH_CONFIRM_PATH: '/webhook/a-immune-tech-confirm',   // WF-04 기술 문제 확인
  MANAGER_ID: window.AIMMUNE_MANAGER?.get() ?? 'M-001',   // 현재 담당자 (화면 왼쪽 '관리자 아이디'에서 선택)
  USE_SAMPLE_ON_FAIL: false, // true면 연결 실패 시 샘플 데이터 표시
};

/* ---------------------------------------------------------------------------
 * 1. 전역 상태
 * ------------------------------------------------------------------------- */
const state = {
  items: [],          // 지침 개정 대기 (type GUIDELINE_REVISION)
  techItems: [],      // 기술 문제 (type TECH)
  selectedKind: null, // 'REVISION' | 'TECH'
  selectedId: null,   // revisionId 또는 reportId
  rejecting: false,   // 반려 사유 입력 모드
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

/* 전체 지침 content를 번호 목록으로 렌더 (줄바꿈 기준) + diff 강조 */
function renderContent(content, highlight) {
  const lines = String(content ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const hl = (text) => {
    let out = esc(text);
    if (highlight) {
      const key = esc(highlight.trim());
      if (key && out.includes(key)) out = out.replace(key, `<strong class="font-semibold">${key}</strong>`);
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
  const hasAny = state.items.length || state.techItems.length;

  if (!hasAny) {
    wrap.innerHTML = `<div class="py-16 text-center text-muted">진행 대기 중인 항목이 없습니다.</div>`;
    return;
  }

  let html = '';

  // 지침 개정 대기
  if (state.items.length) {
    if (state.techItems.length) {
      html += `<div class="mb-1 mt-1 px-1 text-[15px] font-semibold text-ink/50">지침 개정 대기 (${state.items.length})</div>`;
    }
    html += sortByRisk(state.items).map(renderRevisionCard).join('');
  }

  // 기술 문제 (별도 영역)
  if (state.techItems.length) {
    html += `<div class="mb-1 mt-4 px-1 text-[15px] font-semibold text-ink/50">기술 문제 (${state.techItems.length})</div>`;
    html += sortByRisk(state.techItems).map(renderTechCard).join('');
  }

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
        <span class="text-[20px] text-muted">${esc(item.createdAt || '')}</span>
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
        <span class="text-[20px] text-muted">${esc(t.createdAt || '')}</span>
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

/* ---------------------------------------------------------------------------
 * 5. 상세 열기 / 렌더
 * ------------------------------------------------------------------------- */
function selectItem(kind, id) {
  state.selectedKind = kind;
  state.selectedId = id;
  state.rejecting = false;
  document.getElementById('layout').classList.add('detail-open');
  renderList();
  renderDetail();
}

function getSelected() {
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
  if (h) h.textContent = state.selectedKind === 'TECH' ? '기술 문제 확인' : '지침서 개정 승인';

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

    <section class="mt-8">
      <h4 class="mb-3 text-[27px] font-semibold">개정 제안</h4>
      <div class="flex items-stretch gap-4">
        <div class="flex-1 rounded-[16px] bg-canvas p-5">
          <div class="mb-3 text-[22px] font-medium text-ink/60">수정 전 <span class="ml-1">${curVer}</span></div>
          <p class="text-[23px] leading-relaxed">${esc(item.change?.beforeSentence || '')}</p>
        </div>
        <div class="flex items-center text-[31px] text-muted">→</div>
        <div class="flex-1 rounded-[16px] border-2 border-salmon bg-[#fff6f4] p-5">
          <div class="mb-3 text-[22px] font-medium text-salmon">수정 제안 <span class="ml-1">${candVer}</span></div>
          <p class="text-[23px] font-semibold leading-relaxed">${esc(item.change?.afterSentence || '')}</p>
        </div>
      </div>
    </section>

    <section class="mt-8">
      <h4 class="mb-3 text-[27px] font-semibold">개정 제안 상세</h4>
      <div class="flex items-stretch gap-4">
        <div class="flex-1 overflow-hidden rounded-[16px] bg-canvas">
          <div class="bg-ink px-5 py-3 text-[22px] font-semibold text-white">전체 현재 지침 <span class="ml-1 font-normal opacity-80">${curVer}</span></div>
          <div class="p-5 text-[22px]">${renderContent(item.currentVersion?.content, item.change?.beforeSentence)}</div>
        </div>
        <div class="flex items-center text-[31px] text-muted">→</div>
        <div class="flex-1 overflow-hidden rounded-[16px] bg-canvas">
          <div class="bg-brand px-5 py-3 text-[22px] font-semibold text-white">전체 후보 지침 <span class="ml-1 font-normal opacity-80">${candVer}</span></div>
          <div class="p-5 text-[22px]">${renderContent(item.candidateVersion?.content, item.change?.afterSentence)}</div>
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

  const reportBlock = (label, text) => text
    ? `<div class="rounded-[16px] bg-canvas p-5">
         <div class="mb-2 text-[14px] font-medium text-ink/50">${label}</div>
         <p class="text-[16px] leading-relaxed">${esc(text)}</p>
       </div>` : '';

  box.innerHTML = `
    <div class="flex items-start justify-between">
      <div class="flex flex-wrap items-center gap-3">
        <h3 class="text-[28px] font-semibold">${esc(t.complaintType || '기술 문제')}</h3>
        <span class="inline-flex items-center rounded-[14px] bg-[#eaf8ff] px-3 py-1 text-[15px] font-medium text-[#25a0e2]">기술 문제</span>
        <span class="inline-flex items-center gap-2 rounded-[14px] bg-ink px-3 py-1 text-[15px] font-medium text-white">
          AGENT <span>${esc(t.agentName || '-')}</span>
        </span>
        ${t.risk?.level ? `<span class="inline-flex items-center rounded-[14px] ${r.bg} px-3 py-1 text-[15px] font-medium ${r.text}">위험도 ${esc(t.risk.level)}</span>` : ''}
      </div>
      <div class="text-right text-[14px] text-muted">
        <div>요청일: ${esc(t.createdAt || '')}</div>
        <div>사건 발생일: ${esc(t.occurredAt || '-')}</div>
        <div>신고번호: ${esc(t.reportId || '')}</div>
      </div>
    </div>

    <section class="mt-8">
      <h4 class="mb-3 text-[20px] font-semibold">신고 내용</h4>
      <div class="space-y-3">
        ${reportBlock('사용자 질문', t.userPrompt)}
        ${reportBlock('AI 응답', t.agentResponse)}
        ${reportBlock('문제 / 요청', t.issueRequest)}
        ${(!t.userPrompt && !t.agentResponse && !t.issueRequest) ? '<p class="text-muted">신고 상세 내용이 없습니다.</p>' : ''}
      </div>
    </section>

    <section class="mt-8">
      <h4 class="mb-3 text-[20px] font-semibold">분석 이유</h4>
      <p class="text-[16px] leading-relaxed text-ink/90">${esc(t.classificationReason || '-')}</p>
    </section>

    <section class="mt-8">
      <h4 class="mb-3 text-[20px] font-semibold">위험도</h4>
      <div class="flex items-center gap-3">
        ${t.risk?.level
          ? `<span class="inline-flex items-center rounded-[14px] ${r.bg} px-3 py-1 text-[15px] font-medium ${r.text}">${esc(t.risk.level)}</span>`
          : '<span class="text-muted">-</span>'}
        <span class="text-[16px] text-ink/80">${esc(t.risk?.reason || '')}</span>
      </div>
    </section>

    <div class="mt-6 rounded-[16px] bg-[#fff7e2] p-4 text-[14px] leading-relaxed text-ink/70">
      문제를 확인하고 필요한 조치를 완료한 뒤 <b>확인</b>을 눌러 주세요. 확인하면 조치 완료 기록을 저장하고 신고자에게 결과를 안내합니다.    
    </div>

    <div class="sticky bottom-4 mt-10 flex justify-center">
      <div class="flex items-center gap-4 rounded-[20px] bg-white px-6 py-4 shadow-[0_4px_24px_rgba(0,0,0,0.12)]">
        <span class="mr-2 text-[16px] font-medium text-ink/70">이 기술 문제를 확인 처리할까요?</span>
        <button id="btnConfirmTech" class="rounded-[14px] bg-[#25a0e2] px-9 py-3 text-[20px] font-semibold text-white hover:opacity-90">확인</button>
      </div>
    </div>
  `;

  document.getElementById('btnConfirmTech')?.addEventListener('click', confirmTech);
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
      <button id="btnApprove" disabled class="cursor-not-allowed rounded-[14px] bg-brand px-9 py-3 text-[27px] font-semibold text-white opacity-30">승인</button>
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
async function refreshIfStale(e) {
  if (e && (e.status === 403 || e.status === 409)) {
    state.selectedKind = null; state.selectedId = null; state.rejecting = false;
    document.getElementById('layout')?.classList.remove('detail-open');
    const d = document.getElementById('detailWrap'); if (d) d.innerHTML = '';
    try { await init(); } catch (_) {}
  }
}

async function approve() {
  const item = getSelected();
  if (!item) return;
  const btn = document.getElementById('btnApprove');
  if (btn) { btn.disabled = true; btn.textContent = '처리 중…'; }
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
    refreshIfStale(e);
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
    await postJson(CONFIG.DECISION_PATH, {
      revisionId: item.revisionId,
      decision: 'REJECT',
      rejectionReason: reason,
      managerId: CONFIG.MANAGER_ID,
    });
    removeSelected();
  } catch (e) {
    alert('반려 처리에 실패했습니다: ' + e.message);
    refreshIfStale(e);
    if (btn) { btn.disabled = false; btn.textContent = '반려 제출'; }
  }
}

async function confirmTech() {
  const t = getSelected();
  if (!t) return;
  const btn = document.getElementById('btnConfirmTech');
  if (btn) { btn.disabled = true; btn.textContent = '처리 중…'; }
  try {
    await postJson(CONFIG.TECH_CONFIRM_PATH, {
      reportId: t.reportId,
      managerId: CONFIG.MANAGER_ID,
    });
    removeSelected();
  } catch (e) {
    alert('확인 처리에 실패했습니다: ' + e.message);
    refreshIfStale(e);
    if (btn) { btn.disabled = false; btn.textContent = '확인'; }
  }
}

/* 현재 선택 항목을 목록에서 제거하고 상세 닫기 */
function removeSelected() {
  if (state.selectedKind === 'TECH') {
    state.techItems = state.techItems.filter(t => t.reportId !== state.selectedId);
  } else {
    state.items = state.items.filter(i => i.revisionId !== state.selectedId);
  }
  state.selectedKind = null;
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
    if (data.techConfirmApi && data.techConfirmApi.path) CONFIG.TECH_CONFIRM_PATH = data.techConfirmApi.path;
    renderList();
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
