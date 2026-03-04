import { jsonResponse } from '../../_shared.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const userId = Number(url.searchParams.get('userId') || 0);
  if (!userId) {
    return jsonResponse({ ok: false, error: '缺少 userId' }, 400);
  }

  const { results } = await env.DB.prepare(
    'SELECT id, industry, level, jd_text, resume_text, result_json, created_at FROM analyses WHERE user_id = ?1 ORDER BY created_at DESC'
  ).bind(userId).all();

  const data = (results || []).map(row => ({
    ...row,
    result: JSON.parse(row.result_json)
  }));

  return jsonResponse({ ok: true, data });
}
