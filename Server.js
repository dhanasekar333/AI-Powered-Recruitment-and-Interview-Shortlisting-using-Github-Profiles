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

app.use(express.json());

// ============================
// 🔹 IN-MEMORY JOB STORE
// ============================
// Holds pending/completed n8n jobs.
// Format: { [jobId]: { status: 'pending'|'done'|'error', data, createdAt } }
const jobStore = {};

// Clean up jobs older than 30 minutes so memory doesn't grow forever
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const id of Object.keys(jobStore)) {
    if (jobStore[id].createdAt < cutoff) delete jobStore[id];
  }
}, 5 * 60 * 1000);

// ============================
// 🔹 N8N ASYNC TRIGGER
// ============================

// Step 1 — Browser POSTs here → we fire n8n in the background and return a jobId immediately
app.post('/api/search-candidates', async (req, res) => {
  const N8N_URL = process.env.N8N_WEBHOOK_URL;
  if (!N8N_URL) {
    return res.status(500).json({ error: 'N8N_WEBHOOK_URL not configured in Render environment variables' });
  }

  // Create a unique job ID for this search
  const jobId = crypto.randomUUID();
  jobStore[jobId] = { status: 'pending', data: null, createdAt: Date.now() };

  // Build the callback URL so n8n knows where to POST results when done
  const callbackUrl = `${process.env.BASE_URL}/api/job-result/${jobId}`;

  // Fire-and-forget — we do NOT await this. n8n runs in background.
  axios.post(N8N_URL, {
    ...req.body,
    callback_url: callbackUrl  // n8n will POST here when the workflow finishes
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20 * 60 * 1000  // 20 min safety net on server side, never shown to browser
  })
  .then(() => {
    // n8n returned something directly (some workflows respond inline).
    // We don't rely on this — the callback_url handles real results.
    console.log(`[${jobId}] n8n responded inline (callback still expected)`);
  })
  .catch(err => {
    // Only mark error if job is still pending (callback may have already set it to done)
    if (jobStore[jobId]?.status === 'pending') {
      console.error(`[${jobId}] n8n trigger error:`, err.message);
      jobStore[jobId].status = 'error';
      jobStore[jobId].error  = err.message;
    }
  });

  // Respond immediately with the job ID — browser will poll for results
  res.json({ jobId, status: 'pending' });
});

// ============================
// 🔹 N8N CALLBACK RECEIVER
// ============================

// Step 2 — n8n calls this URL when the workflow finishes
// Add an HTTP Request node at the END of your n8n workflow:
//   Method: POST
//   URL: {{ $json.callback_url }}         (or hardcode: https://your-render-url.onrender.com/api/job-result/{{ $json.jobId }})
//   Body: the final JSON output from your workflow
app.post('/api/job-result/:jobId', (req, res) => {
  const { jobId } = req.params;

  if (!jobStore[jobId]) {
    return res.status(404).json({ error: 'Unknown jobId' });
  }

  jobStore[jobId].status = 'done';
  jobStore[jobId].data   = req.body;
  console.log(`[${jobId}] Results received from n8n ✅`);
  res.json({ ok: true });
});

// ============================
// 🔹 POLL ENDPOINT
// ============================

// Step 3 — Browser polls this every 15 seconds
app.get('/api/job-status/:jobId', (req, res) => {
  const job = jobStore[req.params.jobId];
  if (!job) return res.status(404).json({ status: 'not_found' });
  res.json({ status: job.status, data: job.data || null, error: job.error || null });
});

// ============================
// 🔹 IN-MEMORY USERS (email auth)
// ============================
const users = [];

// ============================
// 🔹 GITHUB AUTH
// ============================

app.get('/auth/github', (req, res) => {
  const redirect_uri = `${process.env.BASE_URL}/auth/github/callback`;
  res.redirect(`https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${redirect_uri}`);
});

app.get('/auth/github/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const tokenRes = await axios.post('https://github.com/login/oauth/access_token', {
      client_id:     process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code
    }, { headers: { accept: 'application/json' } });

    const access_token = tokenRes.data.access_token;
    const userRes = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    req.session.user = userRes.data;
    res.redirect('/dashboard.html');
  } catch (err) {
    res.send('GitHub Auth Failed');
  }
});

// ============================
// 🔹 GOOGLE AUTH
// ============================

app.get('/auth/google', (req, res) => {
  const redirect_uri = `${process.env.BASE_URL}/auth/google/callback`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${redirect_uri}&response_type=code&scope=profile email`;
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri:  `${process.env.BASE_URL}/auth/google/callback`,
      grant_type:    'authorization_code'
    });
    const access_token = tokenRes.data.access_token;
    const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    req.session.user = userRes.data;
    res.redirect('/dashboard.html');
  } catch (err) {
    res.send('Google Auth Failed');
  }
});

// ============================
// 🔹 CHECK LOGIN
// ============================

app.get('/api/user', (req, res) => {
  if (req.session.user) {
    res.json(req.session.user);
  } else {
    res.status(401).json({ error: 'Not logged in' });
  }
});

// ============================
// 🔹 EMAIL AUTH
// ============================

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

// ============================
// 🔹 LOGOUT
// ============================

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

app.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
});