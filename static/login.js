// ==========================================
// GitRecruit – Login Page Scripts (Clean)
// ==========================================

// Utility selector
const $ = (id) => document.getElementById(id);

// ================= PASSWORD TOGGLE =================
function setupPasswordToggle(btnId, inputId, iconId) {
  const btn = $(btnId);
  const input = $(inputId);
  const icon = $(iconId);

  if (!btn || !input || !icon) return;

  btn.addEventListener('click', () => {
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';

    icon.innerHTML = isHidden
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  });
}

// Apply toggles
setupPasswordToggle('eyebtn', 'pw', 'eyesvg');
setupPasswordToggle('su-eyebtn', 'su-pw', 'su-eyesvg');

// ================= NAVIGATION =================
const redirect = (url) => window.location.href = url;

// ================= LOGIN =================
$('signinBtn')?.addEventListener('click', async () => {
  const email = $('email')?.value.trim();
  const pw = $('pw')?.value;
  
  if (!email || !pw) {
    return alert('Please enter both email and password');
  }
  
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, pw })
    });
    
    if (res.ok) {
      redirect('/dashboard.html');
    } else {
      const data = await res.json();
      alert(data.error || 'Login failed');
    }
  } catch (err) {
    console.error(err);
    alert('An error occurred during login');
  }
});

// ================= OAUTH =================
$('googleBtn')?.addEventListener('click', () => {
  redirect('http://localhost:5000/auth/google');
});

document.querySelectorAll('.gh-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    redirect('http://localhost:5000/auth/github');
  });
});

$('signupGoogle')?.addEventListener('click', () => {
  redirect('http://localhost:5000/auth/google');
});

// ================= MODAL =================
const modal = $('signupModal');

function openModal() {
  modal?.classList.add('active');
}
function closeModal() {
  modal?.classList.remove('active');
}

$('openSignup')?.addEventListener('click', (e) => {
  e.preventDefault();
  openModal();
});

$('closeModal')?.addEventListener('click', closeModal);
$('switchToLogin')?.addEventListener('click', closeModal);

modal?.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

// ================= SIGNUP =================
$('doSignup')?.addEventListener('click', async () => {
  const fname = $('su-fname')?.value.trim();
  const lname = $('su-lname')?.value.trim();
  const email = $('su-email')?.value.trim();
  const pw = $('su-pw')?.value;

  if (!fname || !lname || !email || !pw) {
    return alert('Please fill all fields');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return alert('Invalid email');
  }

  if (pw.length < 6) {
    return alert('Password must be at least 6 characters');
  }

  try {
    const res = await fetch('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fname, lname, email, pw })
    });
    
    if (res.ok) {
      closeModal();
      const toast = $('toast');
      toast?.classList.add('show');
      setTimeout(() => {
        toast?.classList.remove('show');
        redirect('/dashboard.html');
      }, 2000);
    } else {
      const data = await res.json();
      alert(data.error || 'Signup failed');
    }
  } catch (err) {
    console.error(err);
    alert('An error occurred during signup');
  }
});