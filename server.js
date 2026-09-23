const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

// 현재 폴더의 정적 파일들(index.html, js, Logo, Button 등)을 제공
app.use(express.static(path.join(__dirname)));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});