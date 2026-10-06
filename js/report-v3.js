/* =========================================================================
 * 건의 접수 V3 — 1화면 1문항 + 뮤니
 *
 * 문항은 n8n 건의 접수 폼(report_form.html / V2)과 같은 8개이며 순서도 같다.
 * 답은 n8n 웹훅으로 보낸다. 키 이름은 V2와 같다:
 *   agent, eventDate, eventTime, category, uiIssue, problem, requestContent, submittedAt
 *   + 첨부가 있으면 attachment (파일)
 * ========================================================================= */
import { createMuni } from './muni-sheet.js';

/* ---------------------------------------------------------------------------
 * 0. 설정
 * ------------------------------------------------------------------------- */
const CONFIG = {
  // WF-01 건의 접수 웹훅. V3 전용 워크플로우를 만들면 이 주소만 바꾸면 된다.
  WEBHOOK_URL: 'https://blitzrattle.app.n8n.cloud/webhook/a-immune-report-v2',
  TIMEOUT_MS: 45000,              // 접수 응답이 AI 분석 뒤에 오면 오래 걸릴 수 있다
  MAX_TEXT: 2000,
  MAX_FILE_BYTES: 10 * 1024 * 1024,
};

/* ---------------------------------------------------------------------------
 * 1. 문항
 * ------------------------------------------------------------------------- */
const STEPS = [
  {
    key: 'agent', type: 'choice', required: true,
    title: '어떤 Agent를 사용하셨나요?',
    error: '사용한 Agent를 선택해 주세요.',
    options: [
      { value: 'JOY', label: "I'M JOY", desc: '영업지원 AI' },
      { value: 'A-Immune', label: 'A-Immune 핵심 Agent' },
    ],
  },
  {
    key: 'eventDate', type: 'date', required: true,
    title: '언제 있었던 일인가요?',
    error: '발생한 날짜를 선택해 주세요.',
  },
  {
    key: 'eventTime', type: 'time', required: true,
    title: '몇 시쯤이었나요?',
    error: '발생한 시간을 입력해 주세요.',
  },
  {
    key: 'category', type: 'choice', required: true,
    title: '어떤 종류의 의견인가요?',
    error: '의견 종류를 선택해 주세요.',
    options: [
      { value: 'UI/화면', label: 'UI/화면 오류' },
      { value: 'AI 답변 품질', label: 'AI 답변 오답 및 불만족' },
      { value: '기능 장애', label: '기능 동작 불가/오류' },
      { value: '기타 건의', label: '기타 개선 건의' },
    ],
  },
  {
    key: 'uiIssue', type: 'text', required: false,
    title: '화면에서 불편했던 점이 있나요?',
    placeholder: '화면 관련 특이사항이 있다면 적어 주세요.',
  },
  {
    key: 'problem', type: 'text', required: true,
    title: '어떤 문제가 있었나요?',
    placeholder: '발생한 문제 상황을 자세히 적어 주세요.',
    error: '문제 상황을 적어 주세요.',
  },
  {
    key: 'requestContent', type: 'text', required: true,
    title: '어떻게 개선되면 좋을까요?',
    placeholder: '개선되기를 바라는 내용을 적어 주세요.',
    error: '요청 내용을 적어 주세요.',
  },
  {
    key: 'attachment', type: 'file', required: false,
    title: '오류 화면이 있다면 첨부해 주세요',
  },
];
const LAST = STEPS.length - 1;

/* ---------------------------------------------------------------------------
 * 2. 상태와 요소
 * ------------------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
const form = $('#report-form');
const host = $('#step-host');
const progress = $('#progress');
const count = $('#count');
const btnBack = $('#btn-back');
const btnNext = $('#btn-next');

const answers = {};          // key -> 문자열 / File
let idx = 0;                 // 현재 문항
let reached = 0;             // 가장 멀리 간 문항 (진행바로 되돌아갈 수 있는 범위)
let sending = false;

/* ---------------------------------------------------------------------------
 * 3. 뮤니
 * ------------------------------------------------------------------------- */
const noMuni = { aimAt() {}, aimAtElement() {}, react() {}, thinking() {} };
let muni = noMuni;
try {
  muni = await createMuni({ canvas: $('#muni-canvas'), fx: $('#fx'), glow: $('#spot') });
} catch (err) {
  console.warn('[건의 접수] 뮤니를 불러오지 못했어요:', err);
  $('#stage').hidden = true;        // 폼은 뮤니 없이도 그대로 쓸 수 있다
}

// 커서를 따라본다. 입력 중이거나 창을 벗어나면 입력창을 바라본다.
let pointer = null;
let pointerQueued = false;
window.addEventListener('pointermove', (e) => {
  pointer = [e.clientX, e.clientY];
  if (pointerQueued) return;
  pointerQueued = true;
  requestAnimationFrame(() => { pointerQueued = false; muni.aimAt(pointer[0], pointer[1]); });
}, { passive: true });
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') muni.aimAt(e.clientX, e.clientY);
}, { passive: true });
document.documentElement.addEventListener('mouseleave', lookAtField);

function lookAtField() { muni.aimAtElement(host.querySelector('.field, .choices, .drop, .picked, .q')); }

/* ---------------------------------------------------------------------------
 * 4. 문항 그리기
 * ------------------------------------------------------------------------- */
function todayLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
const fmtSize = (n) => (n >= 1048576 ? Number((n / 1048576).toFixed(1)) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
const hintOf = (s) => (s.required ? '필수 항목' : '선택 항목이에요. 건너뛰어도 괜찮아요.');

function controlHtml(s) {
  const lab = 'aria-labelledby="q-title" aria-describedby="hint err"';
  switch (s.type) {
    case 'choice':
      return `<div class="choices" role="radiogroup" aria-labelledby="q-title" aria-describedby="hint err">${
        s.options.map((o, i) => `
          <label class="choice">
            <input type="radio" name="${s.key}" value="${o.value}" data-i="${i}" />
            <span class="choice-text"><b>${o.label}</b>${o.desc ? `<small>${o.desc}</small>` : ''}</span>
            <span class="tick" aria-hidden="true"></span>
          </label>`).join('')}</div>`;
    case 'date':
      return `<input class="field" id="ctl" type="date" max="${todayLocal()}" ${lab} />`;
    case 'time':
      return `<input class="field" id="ctl" type="time" ${lab} />`;
    case 'text':
      return `<textarea class="field" id="ctl" rows="5" maxlength="${CONFIG.MAX_TEXT}" placeholder="${s.placeholder}" ${lab}></textarea>
              <p class="counter" id="counter" aria-hidden="true"></p>`;
    case 'file':
      return `<div id="file-area"></div>`;
    default:
      return '';
  }
}

function render(dir = 1, moveFocus = true) {
  const s = STEPS[idx];
  host.innerHTML = `
    <div class="step" style="--from:${dir >= 0 ? 20 : -20}px">
      <h2 class="q" id="q-title" tabindex="-1">${s.title}</h2>
      <p class="hint" id="hint">${hintOf(s)}</p>
      ${controlHtml(s)}
      <p class="error" id="err" role="alert"></p>
    </div>`;

  // 저장된 답 복원
  const v = answers[s.key];
  if (s.type === 'choice') {
    const input = [...host.querySelectorAll('input[type=radio]')].find((r) => r.value === v);
    if (input) input.checked = true;
  } else if (s.type === 'file') {
    renderFile();
  } else {
    const ctl = $('#ctl');
    ctl.value = v || '';
    if (s.type === 'text') updateCounter();
  }

  renderProgress();
  renderNav();
  count.textContent = `${idx + 1} / ${STEPS.length}`;
  if (moveFocus) focusControl();
  lookAtField();
}

function focusControl() {
  const s = STEPS[idx];
  const el = s.type === 'choice'
    ? (host.querySelector('input:checked') || host.querySelector('input'))
    : s.type === 'file' ? host.querySelector('.drop input, .btn-text') : $('#ctl');
  (el || $('#q-title')).focus({ preventScroll: true });
}

function renderProgress() {
  progress.innerHTML = STEPS.map((s, i) => {
    const cls = i === idx ? 'now' : i <= reached ? 'past' : '';
    return `<li><button type="button" class="seg ${cls}" data-i="${i}" ${i > reached ? 'disabled' : ''}
      aria-label="${i + 1}번째 질문${i === idx ? ', 현재' : ''}" ${i === idx ? 'aria-current="step"' : ''}></button></li>`;
  }).join('');
}

function renderNav() {
  btnBack.style.visibility = idx === 0 ? 'hidden' : 'visible';
  const s = STEPS[idx];
  const empty = isEmpty(answers[s.key]);
  btnNext.textContent = sending ? '접수 중…'
    : idx === LAST ? '접수하기'
    : !s.required && empty ? '건너뛰기' : '다음';
  btnNext.disabled = sending;
  btnBack.disabled = sending;
}

function updateCounter() {
  const el = $('#counter');
  if (el) el.textContent = `${(answers[STEPS[idx].key] || '').length.toLocaleString()} / ${CONFIG.MAX_TEXT.toLocaleString()}`;
}

/* 첨부 */
function renderFile() {
  const area = $('#file-area');
  const f = answers.attachment;
  if (f) {
    area.innerHTML = `
      <div class="picked">
        <span class="picked-name"></span>
        <span class="picked-size">${fmtSize(f.size)}</span>
        <button type="button" class="btn-text" id="file-remove">삭제</button>
      </div>`;
    area.querySelector('.picked-name').textContent = f.name;
  } else {
    area.innerHTML = `
      <label class="drop" id="drop">
        <input type="file" id="ctl" accept="image/*,application/pdf" aria-labelledby="q-title" aria-describedby="hint err" />
        <strong>이미지나 PDF를 끌어다 놓거나 눌러서 선택하세요</strong>
        <span>${fmtSize(CONFIG.MAX_FILE_BYTES)} 이하</span>
      </label>`;
  }
}
function takeFile(f) {
  if (!f) return;
  const okType = f.type.startsWith('image/') || f.type === 'application/pdf';
  if (!okType) return showError('이미지나 PDF 파일만 첨부할 수 있어요.');
  if (f.size > CONFIG.MAX_FILE_BYTES) return showError(`${fmtSize(CONFIG.MAX_FILE_BYTES)} 이하 파일만 첨부할 수 있어요.`);
  answers.attachment = f;
  showError('');
  renderFile();
  renderNav();
  muni.react('happy');
  focusControl();
}

/* ---------------------------------------------------------------------------
 * 5. 검증과 이동
 * ------------------------------------------------------------------------- */
function isEmpty(v) { return v == null || (typeof v === 'string' && v.trim() === ''); }

function showError(msg) {
  const el = $('#err');
  if (el) el.textContent = msg;
  const ctl = $('#ctl');
  if (ctl) ctl.setAttribute('aria-invalid', msg ? 'true' : 'false');
}

function validate(s) {
  if (s.required && isEmpty(answers[s.key])) return s.error;
  if (s.type === 'date' && answers.eventDate && answers.eventDate > todayLocal()) return '오늘 이후 날짜는 선택할 수 없어요.';
  return '';
}

function go(next, dir) {
  idx = Math.max(0, Math.min(LAST, next));
  reached = Math.max(reached, idx);
  render(dir);
}

function advance() {
  if (sending) return;
  const s = STEPS[idx];
  const msg = validate(s);
  if (msg) {
    showError(msg);
    muni.react('oops');
    focusControl();
    return;
  }
  showError('');
  muni.react(isEmpty(answers[s.key]) ? 'nod' : 'happy');
  if (idx === LAST) return submit();
  go(idx + 1, 1);
}

form.addEventListener('submit', (e) => { e.preventDefault(); advance(); });
btnBack.addEventListener('click', () => { if (idx > 0 && !sending) go(idx - 1, -1); });
progress.addEventListener('click', (e) => {
  const b = e.target.closest('.seg');
  if (b && !b.disabled && !sending) go(Number(b.dataset.i), Number(b.dataset.i) >= idx ? 1 : -1);
});

/* ---------------------------------------------------------------------------
 * 6. 입력 이벤트
 * ------------------------------------------------------------------------- */
let lastNod = 0;
form.addEventListener('input', (e) => {
  const s = STEPS[idx];
  const t = e.target;
  if (s.type === 'text' || s.type === 'date' || s.type === 'time') {
    answers[s.key] = t.value;
    showError('');
    renderNav();
    if (s.type === 'text') {
      updateCounter();
      muni.aimAtElement(t);
      if (t.value && Date.now() - lastNod > 1400 && t.value.length % 12 === 0) { lastNod = Date.now(); muni.react('nod'); }
    }
  }
});

form.addEventListener('change', (e) => {
  const s = STEPS[idx];
  const t = e.target;
  if (s.type === 'choice' && t.matches('input[type=radio]')) {
    answers[s.key] = t.value;
    showError('');
    renderNav();
    muni.react('happy');
  } else if (s.type === 'date' || s.type === 'time') {
    if (t.value) muni.react('nod');
  } else if (s.type === 'file' && t.type === 'file') {
    takeFile(t.files[0]);
  }
});

// 마우스로 선택지를 누르면 잠깐 반응을 보여 준 뒤 다음 문항으로 넘어간다 (키보드 방향키로는 넘어가지 않는다)
form.addEventListener('click', (e) => {
  const s = STEPS[idx];
  if (s.type === 'choice') {
    const label = e.target.closest('.choice');
    if (label && e.detail > 0 && !sending) setTimeout(() => { if (STEPS[idx] === s && answers[s.key]) advance(); }, 380);
  }
  if (e.target.id === 'file-remove') {
    delete answers.attachment;
    renderFile(); renderNav(); focusControl();
  }
});

form.addEventListener('focusin', (e) => { if (e.target.matches('input, textarea')) muni.aimAtElement(e.target); });
form.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.matches('textarea')) { e.preventDefault(); advance(); }
});

// 끌어다 놓기
form.addEventListener('dragover', (e) => { const d = e.target.closest('.drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
form.addEventListener('dragleave', (e) => { const d = e.target.closest('.drop'); if (d) d.classList.remove('over'); });
form.addEventListener('drop', (e) => {
  const d = e.target.closest('.drop');
  if (!d) return;
  e.preventDefault();
  takeFile(e.dataTransfer.files[0]);
});

/* ---------------------------------------------------------------------------
 * 7. n8n로 보내기
 * ------------------------------------------------------------------------- */
async function submit() {
  sending = true;
  renderNav();
  muni.thinking(true);

  const body = new FormData();
  body.append('agent', answers.agent || '');
  body.append('eventDate', answers.eventDate || '');
  body.append('eventTime', answers.eventTime || '');
  body.append('category', answers.category || '');
  body.append('uiIssue', (answers.uiIssue || '').trim());
  body.append('problem', (answers.problem || '').trim());
  body.append('requestContent', (answers.requestContent || '').trim());
  body.append('submittedAt', new Date().toISOString());
  if (answers.attachment) body.append('attachment', answers.attachment, answers.attachment.name);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.TIMEOUT_MS);
  try {
    const res = await fetch(CONFIG.WEBHOOK_URL, { method: 'POST', body, signal: ctrl.signal });
    if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
    const data = await res.json().catch(() => null);
    sending = false;
    muni.thinking(false);
    showDone(data);
  } catch (err) {
    console.error('[건의 접수] 전송 실패:', err);
    sending = false;
    muni.thinking(false);
    renderNav();
    btnNext.textContent = '다시 접수하기';
    showError(err.name === 'AbortError'
      ? '응답이 늦어지고 있어요. 입력한 내용은 그대로 있으니 다시 접수해 주세요.'
      : err.status
        ? `접수하지 못했어요(오류 코드 ${err.status}). 입력한 내용은 그대로 있으니 다시 접수해 주세요.`
        : '서버에 연결하지 못했어요. 네트워크를 확인하고 다시 접수해 주세요.');
    muni.react('sorry');
  } finally {
    clearTimeout(timer);
  }
}

function showDone(data) {
  $('#flow-form').hidden = true;
  $('#done').hidden = false;
  const id = data && (data.reportId || data.report_id || data.id);
  const idEl = $('#done-id');
  idEl.hidden = !id;
  if (id) idEl.textContent = `접수 번호 ${id}`;
  $('#done-title').focus({ preventScroll: true });
  muni.react('cheer');
}

$('#btn-again').addEventListener('click', () => {
  Object.keys(answers).forEach((k) => delete answers[k]);
  idx = 0; reached = 0;
  $('#done').hidden = true;
  $('#flow-form').hidden = false;
  render(1);
});

/* ---------------------------------------------------------------------------
 * 8. 시작
 * ------------------------------------------------------------------------- */
render(1, false);    // 처음엔 포커스를 옮기지 않는다 (모바일 키보드가 갑자기 뜨지 않게)
