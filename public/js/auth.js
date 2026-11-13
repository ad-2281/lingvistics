// public/js/auth.js
// Authentication, Registration, App Config Gate, and Session Guard.

import { supabase } from './supabaseClient.js';

let currentUser = null;
let currentProfile = null;
let appConfig = { require_admin_validation: true };

/**
 * Loads current session and associated user profile.
 */
export async function initAuth() {
  if (!supabase) {
    console.error("Supabase client not initialized.");
    return { session: null, user: null, profile: null, config: appConfig };
  }

  // 1. Fetch public app config
  try {
    const { data: configData, error: configErr } = await supabase
      .from('app_config')
      .select('require_admin_validation, bootstrap_admin_email')
      .eq('id', 1)
      .maybeSingle();

    if (!configErr && configData) {
      appConfig = configData;
    }
  } catch (err) {
    console.warn("Could not fetch app_config, falling back to default:", err);
  }

  // 2. Fetch session
  const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr || !session) {
    currentUser = null;
    currentProfile = null;
    return { session: null, user: null, profile: null, config: appConfig };
  }

  currentUser = session.user;
  currentProfile = await fetchProfile(currentUser.id);

  return { session, user: currentUser, profile: currentProfile, config: appConfig };
}

/**
 * Fetches user profile from public.profiles
 */
export async function fetchProfile(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error("Error loading profile:", error);
    return null;
  }
  currentProfile = data;
  return data;
}

export function getCurrentUser() {
  return currentUser;
}

export function getCurrentProfile() {
  return currentProfile;
}

export function getAppConfig() {
  return appConfig;
}

/**
 * Sign in with email and password
 */
export async function signIn(email, password) {
  if (!supabase) throw new Error("Supabase client not initialized");
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  });
  if (error) throw error;
  currentUser = data.user;
  currentProfile = await fetchProfile(data.user.id);
  return { user: currentUser, profile: currentProfile };
}

/**
 * Self-registration with email, password, full_name, class_group
 */
export async function signUp(email, password, fullName, classGroup) {
  if (!supabase) throw new Error("Supabase client not initialized");
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        full_name: fullName.trim(),
        class_group: classGroup ? classGroup.trim() : null
      }
    }
  });

  if (error) throw error;
  if (data.user) {
    currentUser = data.user;
    currentProfile = await fetchProfile(data.user.id);
  }
  return { user: data.user, profile: currentProfile };
}

/**
 * Sign out
 */
export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  currentUser = null;
  currentProfile = null;
}

/**
 * Render the unauthenticated Login / Registration view.
 */
export function renderAuthUI(container, onAuthSuccess) {
  const requireValidation = appConfig?.require_admin_validation !== false;

  container.innerHTML = `
    <div class="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div class="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
        
        <!-- Header -->
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white shadow-lg mb-4">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
            </svg>
          </div>
          <h2 class="text-2xl font-black text-slate-900 tracking-tight">Platformă Lingvistică</h2>
          <p class="text-sm text-slate-500 mt-1">Conectează-te pentru a accesa lecțiile și temele</p>
        </div>

        <!-- Mode Toggle Tabs -->
        <div class="flex border-b border-slate-200 mb-6" id="auth-tab-buttons">
          <button type="button" id="tab-login-btn" class="flex-1 pb-3 text-center font-semibold text-blue-600 border-b-2 border-blue-600 transition">
            Autentificare
          </button>
          <button type="button" id="tab-register-btn" class="flex-1 pb-3 text-center font-semibold text-slate-500 hover:text-slate-700 transition">
            Înregistrare Elev
          </button>
        </div>

        <!-- Feedback Alert Container -->
        <div id="auth-alert" class="hidden mb-4 p-3 rounded-lg text-sm"></div>

        <!-- Status Banner about Admin Validation Requirement -->
        <div class="mb-5 p-3 rounded-xl border text-xs leading-relaxed ${
          requireValidation 
            ? 'bg-amber-50 border-amber-200 text-amber-900' 
            : 'bg-emerald-50 border-emerald-200 text-emerald-900'
        }">
          <div class="flex items-start gap-2">
            <svg class="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
            </svg>
            <div>
              ${
                requireValidation
                  ? '<strong>Validare activă:</strong> Conturile noi necesită aprobarea manuală a unui profesor sau administrator înainte de deblocarea materialelor.'
                  : '<strong>Aprobare automată:</strong> Înregistrarea contului deblochează instant accesul la lecții și teme.'
              }
            </div>
          </div>
        </div>

        <!-- Form: Login -->
        <form id="login-form" class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5" for="login-email">Email</label>
            <input type="email" id="login-email" required class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition" placeholder="elev@exemplu.ro">
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5" for="login-password">Parolă</label>
            <input type="password" id="login-password" required class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition" placeholder="••••••••">
          </div>
          <button type="submit" id="btn-login-submit" class="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2">
            <span>Intră în cont</span>
          </button>
        </form>

        <!-- Form: Register (Hidden by default) -->
        <form id="register-form" class="space-y-4 hidden">
          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5" for="reg-fullname">Nume și Prenume</label>
            <input type="text" id="reg-fullname" required class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition" placeholder="Ex: Popescu Andrei">
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5" for="reg-class">Clasa / Grupa</label>
            <input type="text" id="reg-class" class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition" placeholder="Ex: 7A, 8B, Pregătire OLR">
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5" for="reg-email">Adresă de Email</label>
            <input type="email" id="reg-email" required class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition" placeholder="elev@exemplu.ro">
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5" for="reg-password">Parolă (minim 6 caractere)</label>
            <input type="password" id="reg-password" minlength="6" required class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition" placeholder="••••••••">
          </div>
          <button type="submit" id="btn-register-submit" class="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2">
            <span>Înregistrează contul</span>
          </button>
        </form>

      </div>
    </div>
  `;

  // UI Event Handlers
  const loginTab = container.querySelector('#tab-login-btn');
  const regTab = container.querySelector('#tab-register-btn');
  const loginForm = container.querySelector('#login-form');
  const regForm = container.querySelector('#register-form');
  const alertBox = container.querySelector('#auth-alert');

  function showAlert(msg, isError = true) {
    alertBox.classList.remove('hidden', 'bg-red-50', 'text-red-800', 'border-red-200', 'bg-emerald-50', 'text-emerald-800', 'border-emerald-200');
    if (isError) {
      alertBox.classList.add('bg-red-50', 'text-red-800', 'border', 'border-red-200');
    } else {
      alertBox.classList.add('bg-emerald-50', 'text-emerald-800', 'border', 'border-emerald-200');
    }
    alertBox.textContent = msg;
  }

  loginTab.addEventListener('click', () => {
    loginTab.className = "flex-1 pb-3 text-center font-semibold text-blue-600 border-b-2 border-blue-600 transition";
    regTab.className = "flex-1 pb-3 text-center font-semibold text-slate-500 hover:text-slate-700 transition";
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
    alertBox.classList.add('hidden');
  });

  regTab.addEventListener('click', () => {
    regTab.className = "flex-1 pb-3 text-center font-semibold text-emerald-600 border-b-2 border-emerald-600 transition";
    loginTab.className = "flex-1 pb-3 text-center font-semibold text-slate-500 hover:text-slate-700 transition";
    regForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    alertBox.classList.add('hidden');
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = container.querySelector('#btn-login-submit');
    const email = container.querySelector('#login-email').value;
    const password = container.querySelector('#login-password').value;

    btn.disabled = true;
    btn.innerHTML = `<span>Se conectează...</span>`;

    try {
      const { user, profile } = await signIn(email, password);
      onAuthSuccess({ user, profile });
    } catch (err) {
      showAlert(err.message || "Eroare la autentificare.");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span>Intră în cont</span>`;
    }
  });

  regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = container.querySelector('#btn-register-submit');
    const fullName = container.querySelector('#reg-fullname').value;
    const classGroup = container.querySelector('#reg-class').value;
    const email = container.querySelector('#reg-email').value;
    const password = container.querySelector('#reg-password').value;

    btn.disabled = true;
    btn.innerHTML = `<span>Se înregistrează...</span>`;

    try {
      const { user, profile } = await signUp(email, password, fullName, classGroup);
      showAlert("Înregistrare reușită! Vă redirecționăm...", false);
      setTimeout(() => onAuthSuccess({ user, profile }), 1000);
    } catch (err) {
      showAlert(err.message || "Eroare la înregistrare.");
      btn.disabled = false;
      btn.innerHTML = `<span>Înregistrează contul</span>`;
    }
  });
}

/**
 * Render the Pending Validation / Account Rejected Screen
 */
export function renderPendingUI(container, profile, onRefresh, onLogout) {
  const isRejected = profile?.status === 'rejected';

  container.innerHTML = `
    <div class="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div class="max-w-lg w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
        
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full ${
          isRejected ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
        } mb-4">
          ${
            isRejected
              ? `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`
              : `<svg class="w-8 h-8 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
          }
        </div>

        <h2 class="text-2xl font-black text-slate-900 mb-2">
          ${isRejected ? 'Cont Respins' : 'Cont în Așteptarea Aprobării'}
        </h2>

        <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left text-sm mb-6 space-y-1">
          <div><span class="text-slate-500">Nume:</span> <strong class="text-slate-800">${profile?.full_name || '—'}</strong></div>
          <div><span class="text-slate-500">Email:</span> <strong class="text-slate-800">${profile?.email || '—'}</strong></div>
          <div><span class="text-slate-500">Clasa:</span> <strong class="text-slate-800">${profile?.class_group || 'Nespecificată'}</strong></div>
          <div><span class="text-slate-500">Stare:</span> <span class="inline-flex px-2 py-0.5 rounded text-xs font-bold ${
            isRejected ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
          }">${profile?.status?.toUpperCase()}</span></div>
        </div>

        <p class="text-slate-600 text-sm leading-relaxed mb-6">
          ${
            isRejected
              ? 'Contul tău a fost respins de către administrator. Dacă consideri că este o eroare, te rugăm să iei legătura direct cu profesorul tău.'
              : 'Contul tău a fost înregistrat și așteaptă validarea profesorului/administratorului. Pagina se va debloca automat după aprobare.'
          }
        </p>

        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          ${
            !isRejected
              ? `<button id="btn-refresh-status" class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow transition inline-flex items-center justify-center gap-2">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                  <span>Verifică starea contului</span>
                </button>`
              : ''
          }
          <button id="btn-logout" class="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition">
            Deconectare
          </button>
        </div>

      </div>
    </div>
  `;

  const refreshBtn = container.querySelector('#btn-refresh-status');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = `<span>Se verifică...</span>`;
      await onRefresh();
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = `<span>Verifică starea contului</span>`;
    });
  }

  const logoutBtn = container.querySelector('#btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', onLogout);
  }
}
