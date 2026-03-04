const encoder = new TextEncoder();

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

export async function parseJson(request) {
  try {
    const body = await request.json();
    return { ok: true, data: body };
  } catch {
    return { ok: false, error: '请求体不是有效JSON' };
  }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function randomSalt() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(saltHex),
      iterations: 120000,
      hash: 'SHA-512'
    },
    key,
    512
  );

  return bytesToHex(new Uint8Array(bits));
}

export function buildPrompt({ industry, level, jdText, resumeText }) {
  return `\n【行业】${industry}\n【职级】${level}\n\n【JD】\n${jdText}\n\n【简历】\n${resumeText}\n\n请输出以下JSON结构（字段必须齐全，不得新增字段）：\n{\n  "score": {\n    "total": number,\n    "dimensions": [\n      {"name":"岗位匹配度","score":number,"reason":string},\n      {"name":"关键词覆盖","score":number,"reason":string},\n      {"name":"项目影响力","score":number,"reason":string},\n      {"name":"表达清晰度","score":number,"reason":string},\n      {"name":"成长轨迹与稳定性","score":number,"reason":string},\n      {"name":"风险项","score":number,"reason":string},\n      {"name":"文化适配","score":number,"reason":string}\n    ]\n  },\n  "hr_focus": {\n    "must_have": [string],\n    "nice_to_have": [string],\n    "risk_points": [string],\n    "verify_questions": [string]\n  },\n  "standard_answers": [\n    {"focus": string, "answer_template": string, "customized_hint": string}\n  ],\n  "resume_suggestions": [\n    {"issue": string, "suggestion": string, "rewrite": string}\n  ]\n}\n\n评分规则：总分100，各维度评分0-100，输出时请结合行业与职级权重影响（例如高级岗位更看重影响力与岗位匹配度）。`;
}

export function systemPrompt() {
  return '你是一位资深HRBP，擅长通过JD与简历进行岗位匹配与候选人评估。你必须只输出JSON，不得包含任何解释、注释、前后缀文本。';
}

export function parseJsonSafe(content) {
  try {
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      return { ok: false };
    }
    const jsonString = content.slice(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonString);
    return { ok: true, data: parsed };
  } catch {
    return { ok: false };
  }
}

export function isAnalysisResult(data) {
  if (!data || typeof data !== 'object') return false;
  if (!data.score || typeof data.score.total !== 'number') return false;
  if (!Array.isArray(data.score.dimensions)) return false;
  if (!data.hr_focus || !Array.isArray(data.hr_focus.must_have)) return false;
  if (!Array.isArray(data.hr_focus.nice_to_have)) return false;
  if (!Array.isArray(data.hr_focus.risk_points)) return false;
  if (!Array.isArray(data.hr_focus.verify_questions)) return false;
  if (!Array.isArray(data.standard_answers)) return false;
  if (!Array.isArray(data.resume_suggestions)) return false;
  return true;
}

export async function callModelWithRetry({ apiBase, apiKey, prompt, maxAttempts }) {
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`${apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      lastError = `模型请求失败: ${response.status} ${errorText}`;
      continue;
    }

    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content ?? '';
    const parsed = parseJsonSafe(content);
    if (!parsed.ok || !isAnalysisResult(parsed.data)) {
      lastError = '模型输出解析失败或结构不符合要求';
      continue;
    }

    return { ok: true, data: parsed.data };
  }
  return { ok: false, error: lastError };
}
