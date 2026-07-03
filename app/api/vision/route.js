export const runtime = 'edge';

const PROMPT =
  'На изображении шахматная диаграмма. Определи позицию каждой фигуры по координатам на краях доски ' +
  '(если координат нет — считай, что белые внизу). Затем выведи позицию в формате FEN. ' +
  'Если на диаграмме или рядом указано, чей ход, используй это; иначе ставь ход белых. ' +
  'Рокировки ставь "-", en passant "-", счётчики "0 1". ' +
  'Ответь строго в JSON без пояснений и без Markdown: {"fen": "...", "note": "краткое замечание, если в чём-то не уверен, иначе пустая строка"}';

export async function POST(req) {
  try {
    const { image, media_type } = await req.json();
    if (!image) return Response.json({ error: 'image required' }, { status: 400 });
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: 'ANTHROPIC_API_KEY не задан в переменных окружения' }, { status: 500 });
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return Response.json({ error: data?.error?.message || 'Anthropic API error' }, { status: r.status });
    }
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .replace(/```json|```/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return Response.json({ error: 'модель вернула нераспознаваемый ответ' }, { status: 502 });
    }
    if (!parsed.fen || !/^([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+ [wb] /.test(parsed.fen)) {
      return Response.json({ error: 'FEN не прошёл проверку: ' + (parsed.fen || '(пусто)') }, { status: 502 });
    }
    return Response.json({ fen: parsed.fen, note: parsed.note || '' });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
