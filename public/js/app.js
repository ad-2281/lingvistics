// public/js/app.js
// Main router & role-based view controller for Modular Course Platform.

import { supabase } from './supabaseClient.js';
import { initAuth, getCurrentProfile, renderAuthUI, renderPendingUI, signOut, fetchProfile } from './auth.js';
import { renderLesson } from './lessonRunner.js';
import { renderHomework } from './homeworkRunner.js';
import { renderTeacherDashboard } from './teacherDashboard.js';

// Application State
let state = {
  profile: null,
  modules: [],
  selectedModule: null,
  selectedLesson: null,
  activeView: 'lesson', // 'lesson' | 'homework' | 'dashboard'
  previewRole: null // 'student' | 'teacher' | 'admin' (only for admin user preview)
};

/**
 * Bootstraps the application.
 */
async function initApp() {
  const rootApp = document.getElementById('app');
  if (!rootApp) return;

  rootApp.innerHTML = `
    <div class="min-h-screen flex items-center justify-center bg-slate-50">
      <div class="text-center">
        <div class="inline-block animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent mb-3"></div>
        <p class="text-sm font-semibold text-slate-600">Se încarcă platforma...</p>
      </div>
    </div>
  `;

  const { user, profile } = await initAuth();

  if (!user) {
    // Unauthenticated View
    renderAuthUI(rootApp, onAuthSuccess);
    return;
  }

  state.profile = profile;

  // Pending or Rejected View
  if (!profile || profile.status !== 'approved') {
    renderPendingUI(
      rootApp,
      profile,
      async () => {
        const updated = await fetchProfile(user.id);
        if (updated && updated.status === 'approved') {
          state.profile = updated;
          await mountAppShell(rootApp);
        } else {
          renderPendingUI(rootApp, updated, () => initApp(), handleLogout);
        }
      },
      handleLogout
    );
    return;
  }

  // Approved User -> Mount App Shell
  await mountAppShell(rootApp);
}

function onAuthSuccess({ profile }) {
  state.profile = profile;
  initApp();
}

async function handleLogout() {
  await signOut();
  state = {
    profile: null,
    modules: [],
    selectedModule: null,
    selectedLesson: null,
    activeView: 'lesson',
    previewRole: null
  };
  initApp();
}

/**
 * Mounts the main layout: Header, Sidebar, and Content Viewer.
 */
async function mountAppShell(rootApp) {
  const profile = state.profile;
  const isAdmin = profile.role === 'admin';
  const effectiveRole = state.previewRole || profile.role;
  const isTeacherOrAdmin = (effectiveRole === 'teacher' || effectiveRole === 'admin');

  rootApp.innerHTML = `
    <div class="min-h-screen flex flex-col bg-slate-50 text-slate-800">
      
      <!-- Top Header Navigation -->
      <header class="h-16 bg-white border-b border-slate-200 sticky top-0 z-30 px-4 sm:px-6 flex items-center justify-between shadow-xs">
        <div class="flex items-center gap-3">
          <button type="button" id="sidebar-toggle-btn" class="lg:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 focus:outline-none">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          
          <div class="flex items-center gap-2.5 cursor-pointer" id="brand-logo-btn">
            <div class="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-lg shadow-sm">
              Ω
            </div>
            <div>
              <span class="font-black text-slate-900 tracking-tight text-base block leading-tight">Lingvistică</span>
              <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Curs & Teme</span>
            </div>
          </div>
        </div>

        <!-- Center / Right Controls -->
        <div class="flex items-center gap-3">
          
          <!-- Admin Preview Role Selector (Strictly restricted to admin accounts) -->
          ${
            isAdmin
              ? `
                <div class="hidden sm:flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
                  <span class="text-[11px] font-bold text-slate-500 pl-2">Mod Vizualizare:</span>
                  <select id="admin-preview-select" class="bg-white border border-slate-300 rounded-lg px-2 py-1 font-bold text-slate-700 text-xs focus:outline-none">
                    <option value="admin" ${effectiveRole === 'admin' ? 'selected' : ''}>Administrator</option>
                    <option value="teacher" ${effectiveRole === 'teacher' ? 'selected' : ''}>Profesor (Preview)</option>
                    <option value="student" ${effectiveRole === 'student' ? 'selected' : ''}>Elev (Preview)</option>
                  </select>
                </div>
              `
              : ''
          }

          <!-- User Profile Pill -->
          <div class="flex items-center gap-2 pl-2">
            <div class="text-right hidden md:block">
              <div class="text-xs font-bold text-slate-900 leading-tight">${profile.full_name}</div>
              <div class="text-[10px] text-slate-500 font-medium">
                ${profile.class_group ? `Clasa ${profile.class_group} • ` : ''}
                <span class="font-bold text-blue-700">${effectiveRole.toUpperCase()}</span>
              </div>
            </div>

            <button type="button" id="btn-header-logout" class="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition" title="Deconectare">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
            </button>
          </div>

        </div>
      </header>

      <!-- Main Body: Sidebar + Content -->
      <div class="flex-1 flex overflow-hidden">
        
        <!-- Sidebar Navigation -->
        <aside id="app-sidebar" class="w-72 bg-white border-r border-slate-200 flex flex-col fixed inset-y-0 left-0 pt-16 z-20 lg:static lg:pt-0 transform -translate-x-full lg:translate-x-0 transition-transform duration-200">
          
          <!-- Teacher/Admin Dashboard Button -->
          ${
            isTeacherOrAdmin
              ? `
                <div class="p-3 border-b border-slate-100">
                  <button type="button" id="btn-nav-dashboard" class="w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-between transition ${state.activeView === 'dashboard' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
                    <span class="flex items-center gap-2">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                      Panou Profesor / Admin
                    </span>
                    <span class="text-[10px] font-mono opacity-80">⚙</span>
                  </button>
                </div>
              `
              : ''
          }

          <!-- Modules & Lessons List -->
          <div class="flex-1 overflow-y-auto p-3 space-y-4" id="sidebar-curriculum-list">
            <div class="text-center py-8 text-xs text-slate-400">Se încarcă modulele...</div>
          </div>

        </aside>

        <!-- Main Content Area -->
        <main class="flex-1 flex flex-col overflow-y-auto bg-slate-50" id="main-content-scroll">
          
          <!-- View Tabs Bar (Only when viewing a lesson) -->
          <div id="lesson-view-tabs-bar" class="h-12 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-10 ${state.activeView === 'dashboard' ? 'hidden' : ''}">
            <div class="flex gap-2">
              <button type="button" id="tab-btn-lesson" class="px-4 py-2 text-xs font-bold rounded-lg transition ${state.activeView === 'lesson' ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:text-slate-800'}">
                Lecție & Exemple
              </button>
              <button type="button" id="tab-btn-homework" class="px-4 py-2 text-xs font-bold rounded-lg transition ${state.activeView === 'homework' ? 'bg-purple-50 text-purple-600' : 'text-slate-500 hover:text-slate-800'}">
                Temă pentru Acasă
              </button>
            </div>
            
            <div class="text-xs text-slate-400 hidden sm:block" id="active-lesson-breadcrumb">
              ${state.selectedLesson ? state.selectedLesson.title : ''}
            </div>
          </div>

          <!-- Dynamic Mount -->
          <div class="flex-1 p-4 sm:p-8" id="primary-view-mount"></div>

        </main>

      </div>
    </div>
  `;

  // Attach Top-Level Event Handlers
  const logoutBtn = rootApp.querySelector('#btn-header-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  const sidebarToggleBtn = rootApp.querySelector('#sidebar-toggle-btn');
  const sidebar = rootApp.querySelector('#app-sidebar');
  if (sidebarToggleBtn && sidebar) {
    sidebarToggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('-translate-x-full');
    });
  }

  // Admin Preview Mode Switcher
  const previewSelect = rootApp.querySelector('#admin-preview-select');
  if (previewSelect) {
    previewSelect.addEventListener('change', async () => {
      state.previewRole = previewSelect.value;
      await mountAppShell(rootApp);
    });
  }

  // Dashboard Nav Button
  const dashBtn = rootApp.querySelector('#btn-nav-dashboard');
  if (dashBtn) {
    dashBtn.addEventListener('click', () => {
      state.activeView = 'dashboard';
      updateViewTabsVisibility();
      renderActiveView();
      updateSidebarActiveItem();
    });
  }

  // Lesson vs Homework Tab Buttons
  const tabLessonBtn = rootApp.querySelector('#tab-btn-lesson');
  const tabHomeworkBtn = rootApp.querySelector('#tab-btn-homework');

  if (tabLessonBtn && tabHomeworkBtn) {
    tabLessonBtn.addEventListener('click', () => {
      state.activeView = 'lesson';
      tabLessonBtn.className = "px-4 py-2 text-xs font-bold rounded-lg transition bg-blue-50 text-blue-600";
      tabHomeworkBtn.className = "px-4 py-2 text-xs font-bold rounded-lg transition text-slate-500 hover:text-slate-800";
      renderActiveView();
    });

    tabHomeworkBtn.addEventListener('click', () => {
      state.activeView = 'homework';
      tabHomeworkBtn.className = "px-4 py-2 text-xs font-bold rounded-lg transition bg-purple-50 text-purple-600";
      tabLessonBtn.className = "px-4 py-2 text-xs font-bold rounded-lg transition text-slate-500 hover:text-slate-800";
      renderActiveView();
    });
  }

  // Load Curriculum and render
  await loadCurriculum(rootApp);
}

/**
 * Loads published modules and lessons from Supabase.
 */
async function loadCurriculum(rootApp) {
  const sidebarList = rootApp.querySelector('#sidebar-curriculum-list');
  if (!sidebarList) return;

  try {
    const { data: modules, error } = await supabase
      .from('modules')
      .select(`
        *,
        lessons (*)
      `)
      .order('order_index');

    if (error) throw error;

    state.modules = modules || [];

    if (state.modules.length === 0) {
      sidebarList.innerHTML = `<div class="text-center py-8 text-xs text-slate-400 italic">Nu există module accesibile în acest moment.</div>`;
      renderEmptyState(rootApp.querySelector('#primary-view-mount'));
      return;
    }

    // Render Sidebar Curriculum
    let html = '';
    state.modules.forEach(mod => {
      const lessons = (mod.lessons || []).sort((a, b) => a.order_index - b.order_index);
      html += `
        <div class="mb-4">
          <div class="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider px-2 py-1">
            ${mod.title}
          </div>
          <div class="space-y-1 mt-1">
      `;

      if (lessons.length === 0) {
        html += `<div class="text-[11px] text-slate-400 italic px-2">Fără lecții</div>`;
      } else {
        lessons.forEach(les => {
          const isSelected = state.selectedLesson && state.selectedLesson.id === les.id;
          html += `
            <button type="button" class="sidebar-lesson-item w-full text-left px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-between ${
              isSelected ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-700 hover:bg-slate-100'
            }" data-lesson-id="${les.id}" data-mod-id="${mod.id}">
              <span class="truncate">${les.title}</span>
            </button>
          `;
        });
      }

      html += `
          </div>
        </div>
      `;
    });

    sidebarList.innerHTML = html;

    // Attach click listeners to lesson items
    sidebarList.querySelectorAll('.sidebar-lesson-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const lesId = btn.dataset.lessonId;
        const modId = btn.dataset.modId;
        selectLesson(modId, lesId);
      });
    });

    // Auto-select first lesson if none selected
    if (!state.selectedLesson && state.modules.length > 0) {
      for (const mod of state.modules) {
        if (mod.lessons && mod.lessons.length > 0) {
          selectLesson(mod.id, mod.lessons[0].id);
          break;
        }
      }
    }

  } catch (err) {
    sidebarList.innerHTML = `<div class="text-xs text-red-600 p-2">Eroare la încărcarea curriculum-ului: ${err.message}</div>`;
  }
}

/**
 * Selects a lesson and switches view to it.
 */
function selectLesson(modId, lesId) {
  const mod = state.modules.find(m => m.id === modId);
  const les = mod ? (mod.lessons || []).find(l => l.id === lesId) : null;

  if (les) {
    state.selectedModule = mod;
    state.selectedLesson = les;
    if (state.activeView === 'dashboard') {
      state.activeView = 'lesson';
    }
    updateViewTabsVisibility();
    updateSidebarActiveItem();
    renderActiveView();

    // Close mobile sidebar if open
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar && window.innerWidth < 1024) {
      sidebar.classList.add('-translate-x-full');
    }
  }
}

function updateViewTabsVisibility() {
  const tabsBar = document.getElementById('lesson-view-tabs-bar');
  if (tabsBar) {
    if (state.activeView === 'dashboard') {
      tabsBar.classList.add('hidden');
    } else {
      tabsBar.classList.remove('hidden');
      const breadcrumb = document.getElementById('active-lesson-breadcrumb');
      if (breadcrumb && state.selectedLesson) {
        breadcrumb.textContent = state.selectedLesson.title;
      }
    }
  }
}

function updateSidebarActiveItem() {
  const items = document.querySelectorAll('.sidebar-lesson-item');
  items.forEach(btn => {
    const isSelected = state.activeView !== 'dashboard' && state.selectedLesson && btn.dataset.lessonId === state.selectedLesson.id;
    btn.className = `sidebar-lesson-item w-full text-left px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-between ${
      isSelected ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-700 hover:bg-slate-100'
    }`;
  });

  const dashBtn = document.getElementById('btn-nav-dashboard');
  if (dashBtn) {
    dashBtn.className = `w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-between transition ${
      state.activeView === 'dashboard' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
    }`;
  }
}

/**
 * Renders the active view in the primary container.
 */
function renderActiveView() {
  const mount = document.getElementById('primary-view-mount');
  if (!mount) return;

  const profile = state.profile;
  const effectiveRole = state.previewRole || profile.role;

  // Scroll to top
  const scrollContainer = document.getElementById('main-content-scroll');
  if (scrollContainer) scrollContainer.scrollTop = 0;

  if (state.activeView === 'dashboard') {
    renderTeacherDashboard(mount, profile, () => {
      // Reload curriculum on update
      loadCurriculum(document.getElementById('app'));
    });
  } else if (state.activeView === 'lesson') {
    if (state.selectedLesson) {
      renderLesson(mount, state.selectedLesson, profile, effectiveRole);
    } else {
      renderEmptyState(mount);
    }
  } else if (state.activeView === 'homework') {
    if (state.selectedLesson) {
      renderHomework(mount, state.selectedLesson, profile);
    } else {
      renderEmptyState(mount);
    }
  }
}

function renderEmptyState(mount) {
  mount.innerHTML = `
    <div class="max-w-md mx-auto text-center py-20">
      <div class="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 font-black text-2xl">
        📚
      </div>
      <h2 class="text-xl font-bold text-slate-800 mb-1">Nicio lecție selectată</h2>
      <p class="text-sm text-slate-500">Alegeți o lecție din meniul lateral pentru a începe studiul.</p>
    </div>
  `;
}

// Start on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
