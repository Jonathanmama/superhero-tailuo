import { jsonResponse, parseJson, buildPrompt, callModelWithRetry } from '../../_shared.js';

export async function onRequestPost({ request, env }) {
  const parsed = await parseJson(request);
  if (!parsed.ok) {
    return jsonResponse({ ok: false, error: parsed.error }, 400);
  }

  const { userId, industry, level, jdText, resumeText, apiKey, apiBase } = parsed.data || {};
  if (!userId || !industry || !level || !jdText || !resumeText || !apiKey || !apiBase) {
    return jsonResponse({ ok: false, error: '分析参数不完整或格式错误' }, 400);
  }

  if (jdText.length < 20 || resumeText.length < 50 || apiKey.length < 10) {
    return jsonResponse({ ok: false, error: '分析参数不完整或格式错误' }, 400);
  }

  const prompt = buildPrompt({ industry, level, jdText, resumeText });
  const { ok, data, error } = await callModelWithRetry({
    apiBase,
    apiKey,
    prompt,
    maxAttempts: 2
  });

  if (!ok) {
    return jsonResponse({ ok: false, error: error || '模型输出解析失败，请重试或调整JD/简历内容' }, 500);
  }

  const createdAt = new Date().toISOString();
  const resultJson = JSON.stringify(data);

  await env.DB.prepare(
    `INSERT INTO analyses (user_id, industry, level, jd_text, resume_text, result_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(userId, industry, level, jdText, resumeText, resultJson, createdAt).run();

  return jsonResponse({ ok: true, data });
}
