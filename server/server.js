import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '2mb' }));

const db = new Database(path.join(__dirname, 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    industry TEXT NOT NULL,
    level TEXT NOT NULL,
    jd_text TEXT NOT NULL,
    resume_text TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

function hashPassword(password, salt) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512');
  return hash.toString('hex');
}

const RegisterSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6)
});

const LoginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6)
});

app.post('/api/auth/register', (req, res) => {
  const data = RegisterSchema.safeParse(req.body);
  if (!data.success) {
    return res.status(400).json({ ok: false, error: '用户名或密码格式不正确' });
  }

  const { username, password } = data.data;
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ ok: false, error: '用户名已存在' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const createdAt = new Date().toISOString();

  const info = db
    .prepare('INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)')
    .run(username, passwordHash, salt, createdAt);

  return res.json({ ok: true, userId: info.lastInsertRowid });
});

app.post('/api/auth/login', (req, res) => {
  const data = LoginSchema.safeParse(req.body);
  if (!data.success) {
    return res.status(400).json({ ok: false, error: '用户名或密码格式不正确' });
  }

  const { username, password } = data.data;
  const user = db.prepare('SELECT id, password_hash, salt FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(404).json({ ok: false, error: '用户不存在' });
  }

  const passwordHash = hashPassword(password, user.salt);
  if (passwordHash !== user.password_hash) {
    return res.status(401).json({ ok: false, error: '密码错误' });
  }

  return res.json({ ok: true, userId: user.id });
});

const AnalyzeSchema = z.object({
  userId: z.number().int(),
  industry: z.string(),
  level: z.string(),
  jdText: z.string().min(20),
  resumeText: z.string().min(50),
  apiKey: z.string().min(10),
  apiBase: z.string().url()
});

const AnalysisResultSchema = z.object({
  score: z.object({
    total: z.number(),
    dimensions: z.array(
      z.object({
        name: z.string(),
        score: z.number(),
        reason: z.string()
      })
    )
  }),
  hr_focus: z.object({
    must_have: z.array(z.string()),
    nice_to_have: z.array(z.string()),
    risk_points: z.array(z.string()),
    verify_questions: z.array(z.string())
  }),
  standard_answers: z.array(
    z.object({
      focus: z.string(),
      answer_template: z.string(),
      customized_hint: z.string()
    })
  ),
  resume_suggestions: z.array(
    z.object({
      issue: z.string(),
      suggestion: z.string(),
      rewrite: z.string()
    })
  )
});

app.post('/api/analysis/run', async (req, res) => {
  const data = AnalyzeSchema.safeParse(req.body);
  if (!data.success) {
    return res.status(400).json({ ok: false, error: '分析参数不完整或格式错误' });
  }

  const { userId, industry, level, jdText, resumeText, apiKey, apiBase } = data.data;
  const prompt = buildPrompt({ industry, level, jdText, resumeText });

  const { ok, data: parsedData, error } = await callModelWithRetry({
    apiBase,
    apiKey,
    prompt,
    maxAttempts: 2
  });

  if (!ok) {
    return res.status(500).json({ ok: false, error: error || '模型输出解析失败，请重试或调整JD/简历内容' });
  }

  const resultJson = JSON.stringify(parsedData);
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO analyses (user_id, industry, level, jd_text, resume_text, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, industry, level, jdText, resumeText, resultJson, createdAt);

  return res.json({ ok: true, data: parsedData });
});

app.get('/api/analysis/list', (req, res) => {
  const userId = Number(req.query.userId || 0);
  if (!userId) {
    return res.status(400).json({ ok: false, error: '缺少 userId' });
  }
  const rows = db
    .prepare('SELECT id, industry, level, jd_text, resume_text, result_json, created_at FROM analyses WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
  const data = rows.map(row => ({
    ...row,
    result: JSON.parse(row.result_json)
  }));
  return res.json({ ok: true, data });
});

function systemPrompt() {
  return `你是一位资深HRBP，擅长通过JD与简历进行岗位匹配与候选人评估。你必须只输出JSON，不得包含任何解释、注释、前后缀文本。`;
}

function buildPrompt({ industry, level, jdText, resumeText }) {
  return `\n【行业】${industry}\n【职级】${level}\n\n【JD】\n${jdText}\n\n【简历】\n${resumeText}\n\n请输出以下JSON结构（字段必须齐全，不得新增字段）：\n{\n  "score": {\n    "total": number,\n    "dimensions": [\n      {"name":"岗位匹配度","score":number,"reason":string},\n      {"name":"关键词覆盖","score":number,"reason":string},\n      {"name":"项目影响力","score":number,"reason":string},\n      {"name":"表达清晰度","score":number,"reason":string},\n      {"name":"成长轨迹与稳定性","score":number,"reason":string},\n      {"name":"风险项","score":number,"reason":string},\n      {"name":"文化适配","score":number,"reason":string}\n    ]\n  },\n  "hr_focus": {\n    "must_have": [string],\n    "nice_to_have": [string],\n    "risk_points": [string],\n    "verify_questions": [string]\n  },\n  "standard_answers": [\n    {"focus": string, "answer_template": string, "customized_hint": string}\n  ],\n  "resume_suggestions": [\n    {"issue": string, "suggestion": string, "rewrite": string}\n  ]\n}\n\n评分规则：总分100，各维度评分0-100，输出时请结合行业与职级权重影响（例如高级岗位更看重影响力与岗位匹配度）。`;
}

function parseJsonSafe(content) {
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

async function callModelWithRetry({ apiBase, apiKey, prompt, maxAttempts }) {
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
    if (!parsed.ok) {
      lastError = '模型输出解析失败';
      continue;
    }

    const validated = AnalysisResultSchema.safeParse(parsed.data);
    if (!validated.success) {
      lastError = '模型输出结构不符合要求';
      continue;
    }

    return { ok: true, data: validated.data };
  }
  return { ok: false, error: lastError };
}

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
