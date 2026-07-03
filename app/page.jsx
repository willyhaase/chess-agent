'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Chess, validateFen } from 'chess.js';

const SF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
const PIECES = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export default function Page() {
  const gameRef = useRef(null);
  if (!gameRef.current) gameRef.current = new Chess();
  const game = gameRef.current;

  const playerRef = useRef(null);   // воркер, который играет ходы
  const analystRef = useRef(null);  // воркер непрерывного анализа
  const searchIdRef = useRef(0);
  const sideAtSearchRef = useRef('w');
  const humanSideRef = useRef('w');

  const [, force] = useState(0);
  const rerender = () => force(x => x + 1);

  const [engReady, setEngReady] = useState(false);
  const [engError, setEngError] = useState('');
  const [engineBusy, setEngineBusy] = useState(false);
  const engineBusyRef = useRef(false);
  const [flipped, setFlipped] = useState(false);
  const [selected, setSelected] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [level, setLevel] = useState('10');
  const levelRef = useRef('10');
  const [side, setSide] = useState('w');
  const [fenText, setFenText] = useState('');
  const [ev, setEv] = useState({ cp: 0, mate: null, depth: 0, pvSan: '' });
  const evRef = useRef(ev);
  const [chat, setChat] = useState([
    { role: 'agent', text: 'Я агент с встроенным Stockfish: он считает варианты, я объясняю их по-человечески. Сделайте ход, вставьте FEN или загрузите фото диаграммы.' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const historyRef = useRef([]);
  const chatBottomRef = useRef(null);
  const fileRef = useRef(null);

  const setBusy = v => { engineBusyRef.current = v; setEngineBusy(v); };

  /* ---------- движок: два воркера из одного blob ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const code = await (await fetch(SF_CDN)).text();
        if (cancelled) return;
        const blob = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
        const player = new Worker(blob);
        const analyst = new Worker(blob);
        playerRef.current = player;
        analystRef.current = analyst;
        player.postMessage('uci');
        analyst.postMessage('uci');

        analyst.onmessage = e => {
          const s = String(e.data || '');
          const m = s.match(/^info .*depth (\d+) .*score (cp|mate) (-?\d+)(?: .*)? pv (.+)$/);
          if (!m) return;
          let val = +m[3];
          const isMate = m[2] === 'mate';
          if (sideAtSearchRef.current === 'b') val = -val; // оценка от стороны на ходу → к белым
          const pvSan = pvToSan(m[4].trim().split(/\s+/).slice(0, 8));
          const next = { depth: +m[1], mate: isMate ? val : null, cp: isMate ? null : val, pvSan };
          evRef.current = next;
          setEv(next);
        };

        player.onmessage = e => {
          const s = String(e.data || '');
          const bm = s.match(/^bestmove (\S+)/);
          if (!bm) return;
          setBusy(false);
          if (bm[1] !== '(none)') {
            try {
              const mv = game.move({ from: bm[1].slice(0, 2), to: bm[1].slice(2, 4), promotion: bm[1][4] || 'q' });
              setLastMove({ from: mv.from, to: mv.to });
            } catch { /* устаревший результат после сброса позиции */ }
          }
          afterMoveRef.current();
        };

        setEngReady(true);
        setTimeout(() => analyzeRef.current(), 100);
      } catch (err) {
        setEngError(err.message);
      }
    })();
    return () => {
      cancelled = true;
      playerRef.current?.terminate();
      analystRef.current?.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pvToSan = uciMoves => {
    const c = new Chess(game.fen());
    const out = [];
    for (const u of uciMoves) {
      try {
        const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
        out.push(mv.san);
      } catch { break; }
    }
    return out.join(' ');
  };

  const moveTimeFor = l => (+l >= 20 ? 1500 : +l >= 10 ? 800 : +l >= 5 ? 400 : 200);
  const engineTurn = () =>
    humanSideRef.current !== 'none' && game.turn() !== humanSideRef.current && !game.isGameOver();

  const analyze = () => {
    const a = analystRef.current;
    if (!a) return;
    a.postMessage('stop');
    if (game.isGameOver()) return;
    sideAtSearchRef.current = game.turn();
    a.postMessage('position fen ' + game.fen());
    a.postMessage('go depth 18'); // воркер не блокирует UI — можно считать глубоко
  };
  const analyzeRef = useRef(analyze);
  analyzeRef.current = analyze;

  const maybeEngineMove = () => {
    const p = playerRef.current;
    if (!p || !engineTurn() || engineBusyRef.current) return;
    setBusy(true);
    p.postMessage('setoption name Skill Level value ' + levelRef.current);
    p.postMessage('position fen ' + game.fen());
    p.postMessage('go movetime ' + moveTimeFor(levelRef.current));
  };

  const afterMove = () => {
    setSelected(null);
    rerender();
    analyzeRef.current();
    if (game.isGameOver()) {
      let msg = 'Партия окончена: ';
      if (game.isCheckmate()) msg += 'мат, победили ' + (game.turn() === 'w' ? 'чёрные' : 'белые') + '.';
      else if (game.isStalemate()) msg += 'пат.';
      else if (game.isThreefoldRepetition()) msg += 'троекратное повторение.';
      else msg += 'ничья.';
      pushChat({ role: 'agent', text: msg });
      return;
    }
    setTimeout(maybeEngineMove, 120);
  };
  const afterMoveRef = useRef(afterMove);
  afterMoveRef.current = afterMove;

  /* ---------- доска ---------- */
  const clickSq = sq => {
    if (engineBusyRef.current || game.isGameOver()) return;
    if (humanSideRef.current !== 'none' && game.turn() !== humanSideRef.current) return;
    const piece = game.get(sq);
    if (selected) {
      try {
        const mv = game.move({ from: selected, to: sq, promotion: 'q' });
        setLastMove({ from: mv.from, to: mv.to });
        afterMove();
        return;
      } catch { /* нелегальный ход — переносим выделение */ }
      setSelected(piece && piece.color === game.turn() ? sq : null);
    } else if (piece && piece.color === game.turn()) {
      setSelected(sq);
    }
  };

  /* ---------- агент (Claude через наш API route) ---------- */
  const pushChat = m => setChat(c => [...c, m]);
  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat, thinking]);

  const positionContext = () => {
    const e = evRef.current;
    const evText = e.mate !== null ? (e.mate > 0 ? '#' : '#-') + Math.abs(e.mate) : (e.cp > 0 ? '+' : '') + (e.cp / 100).toFixed(2);
    return (
      'FEN: ' + game.fen() +
      '\nХоды партии: ' + (game.history().join(' ') || '(начальная позиция)') +
      '\nОценка Stockfish (глубина ' + e.depth + '): ' + evText + ' (с точки зрения белых)' +
      '\nЛучший вариант Stockfish: ' + (e.pvSan || '—') +
      '\nХод: ' + (game.turn() === 'w' ? 'белых' : 'чёрных')
    );
  };

  const askAgent = async userText => {
    setThinking(true);
    historyRef.current.push({
      role: 'user',
      content: '=== ДАННЫЕ ДВИЖКА ===\n' + positionContext() + '\n\n=== ВОПРОС ===\n' + userText,
    });
    try {
      const r = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: historyRef.current }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.status);
      historyRef.current.push({ role: 'assistant', content: data.text });
      if (historyRef.current.length > 16) historyRef.current.splice(0, historyRef.current.length - 16);
      pushChat({ role: 'agent', text: data.text, tag: 'Stockfish ' + evText() });
    } catch (err) {
      pushChat({ role: 'agent', text: 'Ошибка обращения к агенту: ' + err.message });
    } finally {
      setThinking(false);
    }
  };

  const send = () => {
    const v = chatInput.trim();
    if (!v || thinking) return;
    setChatInput('');
    pushChat({ role: 'user', text: v });
    askAgent(v);
  };

  /* ---------- FEN и фото ---------- */
  const loadFen = fen => {
    if (!validateFen(fen).ok) {
      pushChat({ role: 'agent', text: 'FEN не распознан — проверьте строку.' });
      return false;
    }
    game.load(fen);
    searchIdRef.current++;
    setBusy(false);
    setLastMove(null); setSelected(null); setFlipped(false);
    humanSideRef.current = 'none'; setSide('none'); // режим анализа: ходим за обе стороны
    playerRef.current?.postMessage('stop');
    analystRef.current?.postMessage('stop');
    rerender();
    pushChat({ role: 'agent', text: 'Позиция загружена, ход ' + (game.turn() === 'w' ? 'белых' : 'чёрных') + '. Считаю…' });
    setTimeout(() => analyzeRef.current(), 100);
    setTimeout(() => askAgent('Это позиция из задачи. Найди по данным Stockfish решающий ход и объясни его идею.'), 3000);
    return true;
  };

  const onPhoto = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    pushChat({ role: 'agent', text: 'Распознаю диаграмму с фото…' });
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = () => rej(new Error('не удалось прочитать файл'));
      r.readAsDataURL(file);
    });
    try {
      const r = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: b64, media_type: file.type || 'image/jpeg' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.status);
      setFenText(data.fen);
      pushChat({ role: 'agent', text: 'Распознал: ' + data.fen + (data.note ? '\n' + data.note : '') });
      loadFen(data.fen);
    } catch (err) {
      pushChat({ role: 'agent', text: 'Не удалось распознать диаграмму: ' + err.message });
    }
  };

  /* ---------- управление ---------- */
  const newGame = (s = side) => {
    game.reset();
    searchIdRef.current++;
    setBusy(false);
    setLastMove(null); setSelected(null);
    humanSideRef.current = s;
    setFlipped(s === 'b');
    playerRef.current?.postMessage('ucinewgame');
    analystRef.current?.postMessage('ucinewgame');
    const zero = { cp: 0, mate: null, depth: 0, pvSan: '' };
    evRef.current = zero; setEv(zero);
    rerender();
    setTimeout(() => { analyzeRef.current(); maybeEngineMove(); }, 150);
  };

  const undo = () => {
    if (engineBusyRef.current) return;
    game.undo();
    if (humanSideRef.current !== 'none' && game.turn() !== humanSideRef.current) game.undo();
    setLastMove(null);
    afterMove();
  };

  /* ---------- отрисовка ---------- */
  const evText = () => (ev.mate !== null ? (ev.mate > 0 ? '#' : '#-') + Math.abs(ev.mate) : (ev.cp > 0 ? '+' : '') + (ev.cp / 100).toFixed(2));
  const cpNum = ev.mate !== null ? (ev.mate > 0 ? 9999 : -9999) : ev.cp;
  let verdict = 'равная позиция';
  if (cpNum > 60) verdict = 'перевес белых';
  if (cpNum > 250) verdict = 'белые выигрывают';
  if (cpNum < -60) verdict = 'перевес чёрных';
  if (cpNum < -250) verdict = 'чёрные выигрывают';
  if (ev.mate !== null) verdict = 'форсированный мат';
  const whiteShare = ev.mate !== null ? (ev.mate > 0 ? 100 : 0) : 100 / (1 + Math.pow(10, -cpNum / 400));

  const rows = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const cols = flipped ? [...FILES].reverse() : FILES;
  const legal = selected ? game.moves({ square: selected, verbose: true }).map(m => m.to) : [];
  let checkSq = null;
  if (game.inCheck()) {
    const brd = game.board();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = brd[r][c];
      if (p && p.type === 'k' && p.color === game.turn()) checkSq = FILES[c] + (8 - r);
    }
  }
  const history = game.history();
  const movePairs = [];
  for (let i = 0; i < history.length; i += 2) movePairs.push([i / 2 + 1, history[i], history[i + 1]]);

  return (
    <div className="wrap">
      <header>
        <h1>Шахматный <em>агент</em></h1>
        <span className="hint">Stockfish в Web Worker · Claude комментирует его расчёты</span>
        <span className={'engineState' + (engReady ? ' ok' : '')}>
          {engError ? 'движок: ' + engError : engReady ? 'Stockfish · готов' : 'загрузка движка…'}
        </span>
      </header>

      <div className="layout">
        <div>
          <div className="boardZone">
            <div className="evalBar">
              <div className="white" style={{ height: Math.max(3, Math.min(97, whiteShare)) + '%' }} />
              <div className="tick" />
            </div>

            <div className="board">
              {rows.map((rank, ri) => cols.map((file, ci) => {
                const sq = file + rank;
                const piece = game.get(sq);
                const cls = ['sq', (ri + ci) % 2 === 0 ? 'l' : 'd'];
                if (selected === sq) cls.push('sel');
                if (lastMove && (lastMove.from === sq || lastMove.to === sq)) cls.push('last');
                if (checkSq === sq) cls.push('chk');
                if (piece) cls.push(piece.color === 'w' ? 'pw' : 'pb');
                return (
                  <div key={sq} className={cls.join(' ')} onClick={() => clickSq(sq)}>
                    {piece ? PIECES[piece.type] : ''}
                    {legal.includes(sq) && (piece ? <div className="ring" /> : <div className="dot" />)}
                    {ci === 0 && <span className="coord cr">{rank}</span>}
                    {ri === 7 && <span className="coord cf">{file}</span>}
                  </div>
                );
              }))}
            </div>

            <div className="ticker">
              <b>{evText()}</b>
              <span>d{ev.depth}</span>
              <span className="pv">{ev.pvSan || 'движок думает над позицией…'}</span>
            </div>

            <div className="controls">
              <button className="primary" onClick={() => newGame()}>Новая партия</button>
              <select value={side} onChange={e => { setSide(e.target.value); newGame(e.target.value); }}>
                <option value="w">Я играю белыми</option>
                <option value="b">Я играю чёрными</option>
                <option value="none">Только анализ (2 игрока)</option>
              </select>
              <select value={level} onChange={e => { setLevel(e.target.value); levelRef.current = e.target.value; }}>
                <option value="1">Уровень: новичок</option>
                <option value="5">Уровень: любитель</option>
                <option value="10">Уровень: клубный</option>
                <option value="20">Уровень: максимум</option>
              </select>
              <button onClick={undo}>↩ Ход назад</button>
              <button onClick={() => setFlipped(f => !f)}>⇅ Перевернуть</button>
            </div>

            <div className="controls" style={{ marginTop: 8 }}>
              <input
                className="fenInput"
                value={fenText}
                onChange={e => setFenText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadFen(fenText.trim())}
                placeholder="Вставьте FEN, чтобы загрузить задачу или позицию…"
              />
              <button onClick={() => loadFen(fenText.trim())}>Загрузить</button>
              <button onClick={() => fileRef.current?.click()}>📷 Фото диаграммы</button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPhoto} />
            </div>
          </div>
        </div>

        <div className="side">
          <div className="card">
            <h2>Оценка позиции</h2>
            <div className="evalBig">{evText()}</div>
            <div className="evalSub">{verdict} · глубина {ev.depth}</div>
          </div>

          <div className="card">
            <h2>Партия</h2>
            <div className="moves">
              {movePairs.length === 0
                ? <span className="hint">Ходов пока нет — начните партию.</span>
                : movePairs.map(([n, w, b]) => (
                    <span key={n} className="mv"><span className="n">{n}.</span>{w}{b ? ' ' + b : ''}</span>
                  ))}
            </div>
          </div>

          <div className="card chat">
            <h2>Разговор с агентом</h2>
            <div className="chatLog">
              {chat.map((m, i) => (
                <div key={i} className={'msg ' + (m.role === 'user' ? 'user' : 'agent')}>
                  {m.role === 'agent' && <span className="tag">Агент{m.tag ? ' · ' + m.tag : ''}</span>}
                  {m.text}
                </div>
              ))}
              {thinking && <div className="msg think">агент сверяется со Stockfish…</div>}
              <div ref={chatBottomRef} />
            </div>
            <div className="chatRow">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && send()}
                placeholder="Спросите о позиции, плане, ошибке…"
              />
              <button className="primary" onClick={send} disabled={thinking}>→</button>
            </div>
            <button
              disabled={thinking}
              onClick={() => { pushChat({ role: 'user', text: 'Прокомментируй позицию' }); askAgent('Прокомментируй текущую позицию: кто лучше, какой план у обеих сторон, на что обратить внимание.'); }}
            >
              Прокомментировать текущую позицию
            </button>
            <div className="hint">Агент получает FEN, ходы партии, оценку и лучший вариант Stockfish — и отвечает на их основе.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
