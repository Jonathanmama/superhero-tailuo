import { jsonResponse, parseJson, randomSalt, hashPassword } from '../../_shared.js';

export async function onRequestPost({ request, env }) {
  const parsed = await parseJson(request);
  if (!parsed.ok) {
    return jsonResponse({ ok: false, error: parsed.error }, 400);
  }

  const { username, password } = parsed.data || {};
  if (!username || !password || username.length < 3 || password.length < 6) {
    return jsonResponse({ ok: false, error: '用户名或密码格式不正确' }, 400);
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?1')
    .bind(username)
    .first();
  if (existing) {
    return jsonResponse({ ok: false, error: '用户名已存在' }, 409);
  }

  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  const createdAt = new Date().toISOString();

  const result = await env.DB.prepare(
    'INSERT INTO users (username, password_hash, salt, created_at) VALUES (?1, ?2, ?3, ?4)'
  ).bind(username, passwordHash, salt, createdAt).run();

  return jsonResponse({ ok: true, userId: result.meta.last_row_id });
}
