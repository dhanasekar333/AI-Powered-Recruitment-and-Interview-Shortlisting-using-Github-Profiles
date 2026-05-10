require('dotenv').config();

const express = require('express');
const axios   = require('axios');
const session = require('express-session');
const crypto  = require('crypto');

const app = express();

app.use(express.static('static'));
app.get('/', (req, res) => res.redirect('/login.html'));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}));

app.use(express.json({ limit: '10mb' }));

// ============================
// IN-MEMORY JOB STORE
// ============================
const jobStore = {};

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const id of Object.keys(jobStore)) {
    if (jobStore[id].createdAt < cutoff) delete jobStore[id];
  }
}, 5 * 60 * 1000);

// ============================
// STEP 1 — TRIGGER N8N
// ============================
app.post('/api/search-candidates', async (req, res) => {
  const N8N_URL = process.env.N8N_WEBHOOK_URL;
  if (!N8N_URL) {
    return res.status(500).json({ error: 'N8N_WEBHOOK_URL not set in Render environment variables' });
  }

  const jobId       = crypto.randomUUID();
  const callbackUrl = `${process.env.BASE_URL}/api/job-result/${jobId}`;

  jobStore[jobId] = { status: 'pending', data: null, createdAt: Date.now() };

  console.log(`[${jobId}] Triggering n8n | query: ${req.body.job_query} | callback: ${callbackUrl}`);

  // Fire and forget — browser gets jobId immediately, then polls
  axios.post(N8N_URL, {
    ...req.body,
    callback_url: callbackUrl,
    job_id: jobId
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 25 * 60 * 1000
  })
  .then(() => {
    console.log(`[${jobId}] n8n webhook acknowledged (waiting for callback)`);
  })
  .catch(err => {
    if (jobStore[jobId]?.status === 'pending') {
      console.error(`[${jobId}] n8n trigger error: ${err.message}`);
      jobStore[jobId].status = 'error';
      jobStore[jobId].error  = `n8n workflow error: ${err.message}`;
    }
  });

  res.json({ jobId, status: 'pending' });
});

// ============================
// STEP 2 — N8N CALLBACK
// ============================
app.post('/api/job-result/:jobId', (req, res) => {
  const { jobId } = req.params;

  console.log(`[${jobId}] Callback received | keys: ${Object.keys(req.body).join(', ')}`);

  if (!jobStore[jobId]) {
    console.warn(`[${jobId}] Job not in store (server may have restarted)`);
    return res.status(200).json({ ok: false, reason: 'job_not_found_in_store' });
  }

  // Parse output — handle { output: "JSON string" } or { output: {...} } or plain object
  let parsedData = req.body;

  if (parsedData.output !== undefined) {
    if (typeof parsedData.output === 'string') {
      try {
        parsedData = JSON.parse(parsedData.output);
        console.log(`[${jobId}] Parsed output string OK`);
      } catch (e) {
        console.warn(`[${jobId}] Output string is not valid JSON:`, parsedData.output.substring(0, 100));
      }
    } else if (typeof parsedData.output === 'object' && parsedData.output !== null) {
      parsedData = parsedData.output;
    }
  }

  const topCandidates = parsedData.top_candidates;
  const totalEvaluated = parsedData.total_candidates_evaluated;

  if (!Array.isArray(topCandidates)) {
    // n8n sent something but it has no candidate data — likely an early failure
    console.warn(`[${jobId}] No top_candidates array in payload. Raw:`, JSON.stringify(req.body).substring(0, 400));
    jobStore[jobId].status = 'empty';
    jobStore[jobId].data   = null;
    jobStore[jobId].error  = 'n8n workflow completed but returned no candidate data. Check that all nodes ran successfully in n8n.';
    return res.json({ ok: true, warning: 'no_candidates_in_payload' });
  }

  console.log(`[${jobId}] Done: ${topCandidates.length} candidates (${totalEvaluated} evaluated)`);
  jobStore[jobId].status = 'done';
  jobStore[jobId].data   = parsedData;
  res.json({ ok: true });
});

// ============================
// STEP 3 — BROWSER POLL
// ============================
app.get('/api/job-status/:jobId', (req, res) => {
  const job = jobStore[req.params.jobId];
  if (!job) {
    return res.json({
      status: 'not_found',
      error: 'Server was restarted and lost this job. The n8n workflow is still running — results cannot be recovered. Please search again once n8n finishes.'
    });
  }
  res.json({ status: job.status, data: job.data || null, error: job.error || null });
});

// ============================
// DEBUG — see live job store
// ============================
app.get('/api/debug-jobs', (req, res) => {
  const summary = {};
  for (const [id, job] of Object.entries(jobStore)) {
    summary[id] = {
      status: job.status,
      createdAt: new Date(job.createdAt).toISOString(),
      ageSeconds: Math.floor((Date.now() - job.createdAt) / 1000),
      candidateCount: job.data?.top_candidates?.length ?? 'N/A',
      error: job.error || null
    };
  }
  res.json(summary);
});

// ============================
// IN-MEMORY USERS
// ============================
const users = [];

app.get('/auth/github', (req, res) => {
  const redirect_uri = `${process.env.BASE_URL}/auth/github/callback`;
  res.redirect(`https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${redirect_uri}`);
});

app.get('/auth/github/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const tokenRes = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code
    }, { headers: { accept: 'application/json' } });
    const userRes = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
    });
    req.session.user = userRes.data;
    res.redirect('/dashboard.html');
  } catch { res.send('GitHub Auth Failed'); }
});

app.get('/auth/google', (req, res) => {
  const redirect_uri = `${process.env.BASE_URL}/auth/google/callback`;
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${redirect_uri}&response_type=code&scope=profile email`);
});

app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code, redirect_uri: `${process.env.BASE_URL}/auth/google/callback`, grant_type: 'authorization_code'
    });
    const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
    });
    req.session.user = userRes.data;
    res.redirect('/dashboard.html');
  } catch { res.send('Google Auth Failed'); }
});

app.get('/api/user', (req, res) => {
  if (req.session.user) res.json(req.session.user);
  else res.status(401).json({ error: 'Not logged in' });
});

app.post('/auth/signup', (req, res) => {
  const { fname, lname, email, pw } = req.body;
  if (!email || !pw || !fname || !lname) return res.status(400).json({ error: 'Missing fields' });
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'User already exists' });
  const newUser = { id: Date.now(), name: `${fname} ${lname}`, email, password: pw };
  users.push(newUser);
  req.session.user = { id: newUser.id, name: newUser.name, email: newUser.email };
  res.json({ success: true, user: req.session.user });
});

app.post('/auth/login', (req, res) => {
  const { email, pw } = req.body;
  if (!email || !pw) return res.status(400).json({ error: 'Missing fields' });
  const user = users.find(u => u.email === email && u.password === pw);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  req.session.user = { id: user.id, name: user.name, email: user.email };
  res.json({ success: true, user: req.session.user });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login.html'); });

app.listen(process.env.PORT || 5000, () => console.log(`Server running on port ${process.env.PORT || 5000}`));