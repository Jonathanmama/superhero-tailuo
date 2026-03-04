import { jsonResponse, parseJson, hashPassword } from '../../_shared.js';

export async function onRequestPost({ request, env }) {
  const parsed = await parseJson(request);
  if (!parsed.ok) {
    return jsonResponse({ ok: false, error: parsed.error }, 400);
  }

  const { username, password } = parsed.data || {};
  if (!username || !password || username.length < 3 || password.length < 6) {
    return jsonResponse({ ok: false, error: '用户名或密码格式不正确' }, 400);
  }

  const user = await env.DB.prepare('SELECT id, password_hash, salt FROM users WHERE username = ?1')
    .bind(username)
    .first();
  if (!user) {
    return jsonResponse({ ok: false, error: '用户不存在' }, 404);
  }

  const passwordHash = await hashPassword(password, user.salt);
  if (passwordHash !== user.password_hash) {
    return jsonResponse({ ok: false, error: '密码错误' }, 401);
  }

  return jsonResponse({ ok: true, userId: user.id });
}
