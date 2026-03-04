import React, { useEffect, useMemo, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';

const industries = [
  '互联网/软件',
  '制造',
  '金融',
  '消费品',
  '医疗',
  '教育',
  '其他'
];

const levels = [
  'P4/初级',
  'P5/中级',
  'P6/高级',
  'P7/专家',
  'P8/管理'
];

const defaultApiBase = 'https://dashscope.aliyuncs.com/compatible-mode';

async function parsePdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, disableWorker: true }).promise;
  const maxPages = pdf.numPages;
  const texts = [];
  for (let i = 1; i <= maxPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str);
    texts.push(strings.join(' '));
  }
  return texts.join('\n');
}

export default function App() {
  const [mode, setMode] = useState('login');
  const [authError, setAuthError] = useState('');
  const [userId, setUserId] = useState(() => Number(localStorage.getItem('userId')) || 0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [industry, setIndustry] = useState(industries[0]);
  const [level, setLevel] = useState(levels[2]);
  const [jdText, setJdText] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [resumePath, setResumePath] = useState('');

  const [apiKey, setApiKey] = useState(localStorage.getItem('apiKey') || '');
  const [apiBase, setApiBase] = useState(localStorage.getItem('apiBase') || defaultApiBase);

  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);

  const isLoggedIn = userId > 0;

  useEffect(() => {
    if (!isLoggedIn) return;
    fetch(`/api/analysis/list?userId=${userId}`)
      .then(res => res.json())
      .then(res => {
        if (res.ok) setHistory(res.data || []);
      });
  }, [isLoggedIn, userId]);

  const canAnalyze = useMemo(() => {
    return jdText.trim().length > 20 && resumeText.trim().length > 50 && apiKey.trim().length > 10;
  }, [jdText, resumeText, apiKey]);

  const handleRegister = async () => {
    setAuthError('');
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then(r => r.json());

    if (!res.ok) {
      setAuthError(res.error || '注册失败');
      return;
    }
    localStorage.setItem('userId', String(res.userId));
    setUserId(res.userId);
  };

  const handleLogin = async () => {
    setAuthError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then(r => r.json());

    if (!res.ok) {
      setAuthError(res.error || '登录失败');
      return;
    }
    localStorage.setItem('userId', String(res.userId));
    setUserId(res.userId);
  };

  const handleLogout = () => {
    localStorage.removeItem('userId');
    setUserId(0);
    setHistory([]);
  };

  const handlePickPdf = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAnalysisError('');
    setResumePath(file.name);
    try {
      const text = await parsePdf(file);
      setResumeText(text || '');
    } catch (err) {
      setAnalysisError('PDF 解析失败，请尝试更清晰的简历文件');
    }
  };

  const handleAnalyze = async () => {
    setAnalysisError('');
    setLoading(true);
    setAnalysisResult(null);
    try {
      localStorage.setItem('apiKey', apiKey);
      localStorage.setItem('apiBase', apiBase);
      const res = await fetch('/api/analysis/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          industry,
          level,
          jdText,
          resumeText,
          apiKey,
          apiBase
        })
      }).then(r => r.json());

      if (!res.ok) {
        setAnalysisError(res.error || '分析失败');
      } else {
        setAnalysisResult(res.data);
        const listRes = await fetch(`/api/analysis/list?userId=${userId}`).then(r => r.json());
        if (listRes.ok) setHistory(listRes.data || []);
      }
    } catch (err) {
      setAnalysisError('分析失败，请检查网络与API配置');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadHistory = (item) => {
    setIndustry(item.industry);
    setLevel(item.level);
    setJdText(item.jd_text);
    setResumeText(item.resume_text);
    setAnalysisResult(item.result);
  };

  if (!isLoggedIn) {
    return (
      <div className="page">
        <header className="topbar">
          <div className="brand">简历修改神器</div>
        </header>
        <div className="auth-card">
          <div className="auth-tabs">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>注册</button>
          </div>
          <div className="auth-form">
            <label>用户名</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="至少3位" />
            <label>密码</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少6位" />
            {authError && <div className="error">{authError}</div>}
            {mode === 'login' ? (
              <button className="primary" onClick={handleLogin}>登录</button>
            ) : (
              <button className="primary" onClick={handleRegister}>注册</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">简历修改神器</div>
        <div className="topbar-actions">
          <button className="ghost" onClick={handleLogout}>退出登录</button>
        </div>
      </header>

      <div className="content">
        <section className="panel">
          <h2>基础信息</h2>
          <div className="grid">
            <div className="field">
              <label>行业</label>
              <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
                {industries.map(item => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>职级</label>
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                {levels.map(item => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>千问 API Key</label>
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="DASHSCOPE_API_KEY" />
          </div>
          <div className="field">
            <label>API Base</label>
            <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder={defaultApiBase} />
            <div className="hint">默认使用 DashScope OpenAI 兼容地址</div>
          </div>
        </section>

        <section className="panel">
          <h2>输入内容</h2>
          <div className="field">
            <label>岗位 JD</label>
            <textarea value={jdText} onChange={(e) => setJdText(e.target.value)} placeholder="粘贴岗位JD..." rows={8} />
          </div>
          <div className="field">
            <label>简历 PDF</label>
            <div className="row">
              <input type="file" accept="application/pdf" onChange={handlePickPdf} />
              <div className="file-path">{resumePath || '未选择文件'}</div>
            </div>
          </div>
          <div className="field">
            <label>简历文本</label>
            <textarea value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="自动解析后可手工调整" rows={8} />
          </div>
          {analysisError && <div className="error">{analysisError}</div>}
          <button className="primary" disabled={!canAnalyze || loading} onClick={handleAnalyze}>
            {loading ? '分析中...' : '一键分析'}
          </button>
        </section>

        <section className="panel">
          <h2>历史记录</h2>
          <div className="history">
            {history.length === 0 && <div className="hint">暂无记录</div>}
            {history.map(item => (
              <button key={item.id} className="history-item" onClick={() => handleLoadHistory(item)}>
                <div>{item.industry} · {item.level}</div>
                <div className="hint">{new Date(item.created_at).toLocaleString()}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>分析结果</h2>
          {!analysisResult && <div className="hint">请先输入JD和简历并分析</div>}
          {analysisResult && (
            <div className="result">
              <div className="score-card">
                <div className="score">{analysisResult.score?.total ?? '--'}</div>
                <div className="hint">综合评分</div>
              </div>

              <div className="result-block">
                <h3>维度评分</h3>
                <div className="list">
                  {analysisResult.score?.dimensions?.map((item, idx) => (
                    <div key={idx} className="list-item">
                      <div className="list-title">{item.name} · {item.score}</div>
                      <div className="hint">{item.reason}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="result-block">
                <h3>HR最关注点</h3>
                <div className="columns">
                  <div>
                    <div className="list-title">必需项</div>
                    <ul>
                      {analysisResult.hr_focus?.must_have?.map((text, idx) => (
                        <li key={idx}>{text}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="list-title">加分项</div>
                    <ul>
                      {analysisResult.hr_focus?.nice_to_have?.map((text, idx) => (
                        <li key={idx}>{text}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="list-title">风险点</div>
                    <ul>
                      {analysisResult.hr_focus?.risk_points?.map((text, idx) => (
                        <li key={idx}>{text}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="list-title">验证问题</div>
                    <ul>
                      {analysisResult.hr_focus?.verify_questions?.map((text, idx) => (
                        <li key={idx}>{text}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="result-block">
                <h3>标准答案</h3>
                <div className="list">
                  {analysisResult.standard_answers?.map((item, idx) => (
                    <div key={idx} className="list-item">
                      <div className="list-title">关注点：{item.focus}</div>
                      <div className="hint">应对话术：{item.answer_template}</div>
                      <div className="hint">个性化填充：{item.customized_hint}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="result-block">
                <h3>简历修改建议</h3>
                <div className="list">
                  {analysisResult.resume_suggestions?.map((item, idx) => (
                    <div key={idx} className="list-item">
                      <div className="list-title">问题：{item.issue}</div>
                      <div>建议：{item.suggestion}</div>
                      <div className="hint">改写示例：{item.rewrite}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
