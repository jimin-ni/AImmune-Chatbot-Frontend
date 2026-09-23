document.addEventListener('DOMContentLoaded', () => {
  const homeView = document.getElementById('home-view');
  const chatView = document.getElementById('chat-view');
  const chatContainer = document.getElementById('chat-container');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const btnReset = document.getElementById('btn-reset');
  const btnBack = document.getElementById('btn-back');
  const btnReport = document.getElementById('btn-report');

  let isChatStarted = false;

  // 0. 고유 Session ID 관리 (n8n '입력 정리' 노드 필수 파라미터)
  function getOrCreateSessionId() {
    let sessionId = localStorage.getItem('joy_session_id');
    if (!sessionId) {
      sessionId = 'JOY-SESS-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      localStorage.setItem('joy_session_id', sessionId);
    }
    return sessionId;
  }

  // 1. 유저 질문 말풍선[cite: 9]
  function appendUserMessage(text) {
    const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const userHtml = `
      <div class="flex flex-col items-end my-4">
        <div class="max-w-[70%] p-5 rounded-[24px_24px_0px_24px] bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white shadow-sm">
          <p class="text-base font-medium leading-relaxed">${escapeHtml(text)}</p>
          <p class="text-xs text-right opacity-80 mt-2">${timeStr}</p>
        </div>
      </div>
    `;
    chatContainer.insertAdjacentHTML('beforeend', userHtml);
    scrollToBottom();
  }

  // 2. JOY AI 실시간 응답 카드 (n8n에서 수신한 reply 적용)
  function appendJOYResponse(replyText) {
    // 줄바꿈 문자(\n) 처리
    const formattedReply = escapeHtml(replyText).replace(/\n/g, '<br/>');
    
    const joyHtml = `
      <div class="flex flex-col items-start my-4">
        <div class="w-full max-w-[850px] bg-white rounded-3xl p-8 border border-gray-200 shadow-sm text-gray-800 space-y-6">
          <div class="flex items-center gap-2 mb-2">
            <span class="inline-block w-3 h-3 bg-blue-600 rounded-full"></span>
            <h3 class="text-lg font-bold text-black">JOY의 답변</h3>
          </div>
          <div class="text-sm leading-relaxed text-gray-700">
            ${formattedReply}
          </div>
        </div>
      </div>
    `;
    chatContainer.insertAdjacentHTML('beforeend', joyHtml);
    scrollToBottom();
  }

  // XSS 방지용 이스케이프 함수
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  // 3. 메시지 전송 및 n8n 실연동 처리[cite: 7, 9]
  async function handleSend() {
    const query = chatInput.value.trim();

    if (!query) {
      alert('질문 내용을 입력해주세요.');
      return;
    }

    if (!isChatStarted) {
      homeView.classList.add('hidden');
      chatView.classList.remove('hidden');
      isChatStarted = true;
    }

    appendUserMessage(query);
    chatInput.value = '';

    // 🔥 n8n 주소 설정 
    const n8nWebhookUrl = 'https://blitzrattle.app.n8n.cloud/webhook/41bed9d4-b444-4b4e-b620-1e47bf98a405/chat';

    try {
      const response = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 🔥 n8n '입력 정리' 노드가 요구하는 데이터 형식을 전달
        body: JSON.stringify({
          sessionId: getOrCreateSessionId(),
          chatInput: query
        })
      });

      if (!response.ok) {
        throw new Error(`서버 응답 오류: ${response.status}`);
      }

      const data = await response.json();
      
      // n8n 'JOY 최종 응답' 또는 'JOY 추가 질문' 노드가 반환하는 { reply: "..." } 활용
      if (data && data.reply) {
        appendJOYResponse(data.reply);
      } else {
        appendJOYResponse('답변을 가져오지 못했습니다. 다시 시도해주세요.');
      }

    } catch (error) {
      console.error('API 연동 에러:', error);
      appendJOYResponse('죄송합니다. 현재 AI 답변을 불러올 수 없습니다.');
    }
  }

  // 4. 홈으로 돌아가기 (대화 초기화 시 세션 새발급)[cite: 9]
  function resetToHome() {
    chatContainer.innerHTML = '';
    chatView.classList.add('hidden');
    homeView.classList.remove('hidden');
    isChatStarted = false;
    // 새 세션을 진행하고 싶다면 세션 삭제
    localStorage.removeItem('joy_session_id');
  }

  btnReset.addEventListener('click', resetToHome);
  if (btnBack) btnBack.addEventListener('click', resetToHome);

  // 5. 건의 접수 팝업[cite: 9, 10]
  btnReport.addEventListener('click', () => {
    const n8nFormUrl = 'https://your-n8n-instance.com/form/a-immune-complaint';
    window.open(n8nFormUrl, 'A-Immune 건의접수', 'width=650,height=800,scrollbars=yes');
  });

  // 이벤트 리스너 등록[cite: 9]
  btnSend.addEventListener('click', handleSend);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
  });
});