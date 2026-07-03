export const runtime = 'edge';

const SYSTEM =
  'Ты — шахматный агент-тренер, полностью интегрированный с движком Stockfish. ' +
  'В каждом сообщении тебе дают точные данные движка: FEN, ходы партии, оценку и главный вариант. ' +
  'Опирайся ТОЛЬКО на эти данные — не выдумывай собственные варианты и не пересчитывай позицию сам. ' +
  'Объясняй идеи по-человечески: планы, слабости, угрозы, мотивы (отвлечение, связка, слабая горизонталь). ' +
  'Отвечай на языке вопроса пользователя (по умолчанию по-русски), кратко — 3-6 предложений, без Markdown.';

export async function POST(req) {
  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: 'messages required' }, { status: 400 });
    }
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
        max_tokens: 1000,
        system: SYSTEM,
        messages: messages.slice(-16),
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return Response.json({ error: data?.error?.message || 'Anthropic API error' }, { status: r.status });
    }
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
    return Response.json({ text });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
