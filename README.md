# Шахматный агент · Stockfish + Claude

Stockfish считает варианты в Web Worker'ах прямо в браузере, Claude объясняет
его расчёты по-человечески через серверный API route (ключ не попадает на клиент).

## Возможности
- Игра против Stockfish (4 уровня силы) или режим анализа за обе стороны
- Живая оценка позиции: eval-бар, глубина, главный вариант (depth 18)
- Загрузка позиции по FEN
- 📷 Распознавание диаграммы с фото (Claude vision → FEN)
- Чат с агентом: Claude отвечает на основе точных данных движка

## Деплой на Vercel
1. Загрузите проект в GitHub-репозиторий (можно через веб-интерфейс: Add file → Upload files).
2. В Vercel: Add New → Project → импортируйте репозиторий. Настройки по умолчанию (Next.js определится сам).
3. В Settings → Environment Variables добавьте:
   - `ANTHROPIC_API_KEY` — ваш ключ из console.anthropic.com
4. Deploy.

## Локальный запуск
```
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

## Архитектура
- `app/page.jsx` — клиент: доска (chess.js), два воркера Stockfish (игрок + аналитик)
- `app/api/agent/route.js` — прокси к Anthropic API для комментариев
- `app/api/vision/route.js` — фото диаграммы → FEN
- Движок загружается с cdnjs и запускается как blob-worker; чтобы перейти на
  более сильный Stockfish 16 NNUE (WASM), положите файлы сборки в `public/engine/`
  и замените SF_CDN в `page.jsx` на `/engine/stockfish-nnue-16-single.js`.
