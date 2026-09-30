const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;


// 1) 정적 파일 제공
app.use(express.static(path.join(__dirname)));
 
// 2) 관리자 대시보드 — 별도 주소 (/admin)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});
 
// 3) 챗봇(I'M JOY) — 메인 주소 (/ 또는 /chat)
app.get(['/', '/chat'], (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
 
// 4) 확장자가 있는 요청(.js / .css / .png ...)이 여기까지 왔다 = 파일 없음 → 진짜 404
//    이렇게 해야 "JS 자리에 HTML이 응답되는" 문제가 조용히 숨지 않는다.
//    (브라우저에서 SyntaxError 대신 명확한 404를 보게 됨)
app.get(/\.[a-zA-Z0-9]+$/, (req, res) => {
  res.status(404).send('Not found: ' + req.path);
});
 
// 5) 그 외 경로는 챗봇으로 (기존 동작 유지)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
 
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});