require('dotenv').config();

const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');

const app = express();

app.use(express.static('static'));
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}));

app.use(express.json()); // To parse JSON bodies

// In-memory mock DB for testing email login
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
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code
    }, {
      headers: { accept: 'application/json' }
    });

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
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: `${process.env.BASE_URL}/auth/google/callback`,
      grant_type: 'authorization_code'
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
  
  if (users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'User already exists' });
  }

  const newUser = { id: Date.now(), name: `${fname} ${lname}`, email, password: pw };
  users.push(newUser);
  
  req.session.user = { id: newUser.id, name: newUser.name, email: newUser.email };
  res.json({ success: true, user: req.session.user });
});

app.post('/auth/login', (req, res) => {
  const { email, pw } = req.body;
  if (!email || !pw) return res.status(400).json({ error: 'Missing fields' });

  const user = users.find(u => u.email === email && u.password === pw);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

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
  console.log(`Server running on http://localhost:${process.env.PORT}`);
});         