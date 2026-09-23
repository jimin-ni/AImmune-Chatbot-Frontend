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

  // 1. 유저 질문 말풍선 (우측 그라데이션)
  function appendUserMessage(text) {
    const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const userHtml = `
      <div class="flex flex-col items-end my-4">
        <div class="max-w-[70%] p-5 rounded-[24px_24px_0px_24px] bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white shadow-sm">
          <p class="text-base font-medium leading-relaxed">${text}</p>
          <p class="text-xs text-right opacity-80 mt-2">${timeStr}</p>
        </div>
      </div>
    `;
    chatContainer.insertAdjacentHTML('beforeend', userHtml);
    scrollToBottom();
  }

  // 2. JOY AI 응답 카드 (이미지의 1.상황 진단 / 2.핵심 솔루션 스타일)
  function appendJOYResponse(userQuery) {
    const joyHtml = `
      <div class="flex flex-col items-start my-4">
        <div class="w-full max-w-[850px] bg-white rounded-3xl p-8 border border-gray-200 shadow-sm text-gray-800 space-y-6">
          
          <!-- 상황 진단 -->
          <div>
            <h3 class="text-lg font-bold text-black mb-3 flex items-center gap-2">
              <span class="inline-block w-4 h-4 bg-black"></span> 1. 상황 진단
            </h3>
            <p class="text-sm leading-relaxed text-gray-700">
              "잘 파는 법"의 핵심은 많이 파는 게 아니라, 고객이 스스로 '이건 나한테 필요하네'라고 느끼게 만드는 흐름을 만드는 것입니다.<br/>
              판매가 잘 안 될 때는 보통 상품 설명부터 먼저 들어가서 고객이 방어적으로 변합니다.
            </p>
          </div>

          <hr class="border-gray-100" />

          <!-- 핵심 솔루션 -->
          <div>
            <h3 class="text-lg font-bold text-black mb-3 flex items-center gap-2">
              <span class="inline-block w-4 h-4 bg-black"></span> 2. 핵심 솔루션
            </h3>
            <p class="text-sm font-semibold text-gray-800 mb-2">a. 먼저 팔지 말고, 현재 상황을 물어보세요</p>
            <p class="text-sm text-gray-700 mb-4">바로 상품을 꺼내기보다 고객의 사용 패턴을 파악해야 합니다.</p>
            
            <div class="bg-gray-50 p-4 rounded-xl border border-gray-100 text-sm space-y-2">
              <p class="font-medium text-gray-700">예시 질문:</p>
              <ul class="list-disc list-inside space-y-1 text-gray-600">
                <li>"지금 휴대폰 쓰시면서 제일 불편한 건 뭐예요?"</li>
                <li>"요금은 매달 어느 정도 나오세요?"</li>
              </ul>
            </div>
          </div>

        </div>
      </div>
    `;
    chatContainer.insertAdjacentHTML('beforeend', joyHtml);
    scrollToBottom();
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  // 3. 메시지 전송 처리
  async function handleSend() {
    const query = chatInput.value.trim();

    // R-01: 공백 제출 방지[cite: 9]
    if (!query) {
      alert('질문 내용을 입력해주세요.');
      return;
    }

    // 화면 전환 (Home -> Chat)
    if (!isChatStarted) {
      homeView.classList.add('hidden');
      chatView.classList.remove('hidden');
      isChatStarted = true;
    }

    appendUserMessage(query);
    chatInput.value = '';

    try {
      // n8n 연동 주소 설정
      const n8nWebhookUrl = 'https://your-n8n-instance.com/webhook/chat';

      /* n8n 실연동 시 주석 해제
      const response = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query, agentId: 'JOY' })
      });
      const data = await response.json();
      appendJOYResponse(data.reply);
      */

      // 화면 테스트용 더미 응답
      setTimeout(() => {
        appendJOYResponse(query);
      }, 500);

    } catch (error) {
      console.error('API 연동 에러:', error);
    }
  }

  // 4. 홈으로 돌아가기 (초기화)
  function resetToHome() {
    chatContainer.innerHTML = '';
    chatView.classList.add('hidden');
    homeView.classList.remove('hidden');
    isChatStarted = false;
  }

  btnReset.addEventListener('click', resetToHome);
  if (btnBack) btnBack.addEventListener('click', resetToHome);

  // 5. [F-01] n8n 건의 접수 폼 열기[cite: 9]
  btnReport.addEventListener('click', () => {
    const n8nFormUrl = 'https://your-n8n-instance.com/form/a-immune-complaint';
    window.open(n8nFormUrl, 'A-Immune 건의접수', 'width=650,height=800,scrollbars=yes');
  });

  // 이벤트 리스너
  btnSend.addEventListener('click', handleSend);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
  });
});