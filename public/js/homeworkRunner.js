// public/js/homeworkRunner.js
// Renders homework exercises, manages attempts/retakes, and executes server-side grading RPC.

import { supabase } from './supabaseClient.js';

/**
 * Loads and renders all homework exercises for a given lesson.
 * @param {HTMLElement} container
 * @param {Object} lesson
 * @param {Object} profile
 */
export async function renderHomework(container, lesson, profile) {
  if (!container || !lesson) return;

  container.innerHTML = `
    <div class="homework-runner-container max-w-4xl mx-auto pb-16">
      
      <!-- Header -->
      <div class="pb-4 mb-6 border-b border-slate-200">
        <span class="text-xs uppercase tracking-wider font-extrabold text-purple-600 block mb-1">
          Temă pentru Acasă
        </span>
        <h1 class="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
          ${lesson.title} — Teme & Evaluare
        </h1>
        <p class="text-sm text-slate-600 mt-1">
          Rezolvați cerințele de mai jos. Răspunsurile sunt evaluate automat pe server.
        </p>
      </div>

      <!-- Loading State -->
      <div id="hw-loading" class="text-center py-12 text-slate-400">
        <svg class="animate-spin h-8 w-8 mx-auto mb-2 text-purple-600" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span class="text-sm font-medium">Se încarcă cerințele temei...</span>
      </div>

      <!-- Homework Exercises Mount -->
      <div id="hw-exercises-list" class="space-y-8 hidden"></div>

    </div>
  `;

  const loadingEl = container.querySelector('#hw-loading');
  const listEl = container.querySelector('#hw-exercises-list');

  try {
    // 1. Fetch homework exercises for this lesson
    const { data: exercises, error: exErr } = await supabase
      .from('exercises')
      .select('*')
      .eq('lesson_id', lesson.id)
      .eq('category', 'homework')
      .order('order_index');

    if (exErr) throw exErr;

    if (!exercises || exercises.length === 0) {
      loadingEl.innerHTML = `
        <div class="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center">
          <p class="text-slate-500 font-medium">Nu există teme alocate pentru această lecție.</p>
        </div>
      `;
      return;
    }

    // 2. Fetch user's existing submissions for these exercises
    const exerciseIds = exercises.map(e => e.id);
    const { data: submissions, error: subErr } = await supabase
      .from('submissions')
      .select('*')
      .eq('user_id', profile.id)
      .in('exercise_id', exerciseIds)
      .order('attempt_number', { ascending: false });

    loadingEl.classList.add('hidden');
    listEl.classList.remove('hidden');
    listEl.innerHTML = '';

    // Render each homework exercise
    exercises.forEach(ex => {
      // Find latest submission for this exercise
      const exSubs = (submissions || []).filter(s => s.exercise_id === ex.id);
      const latestSub = exSubs.length > 0 ? exSubs[0] : null;
      const attemptCount = exSubs.length;

      const card = renderExerciseCard(ex, latestSub, attemptCount);
      listEl.appendChild(card);
    });

  } catch (err) {
    loadingEl.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-800">
        <p class="font-bold">Eroare la încărcarea temei:</p>
        <p class="text-sm mt-1">${err.message}</p>
      </div>
    `;
  }
}

/**
 * Builds the exercise card element with attempt metadata and form handlers.
 */
function renderExerciseCard(exercise, latestSubmission, attemptCount) {
  const card = document.createElement('div');
  card.className = "bg-white border border-slate-200 rounded-2xl p-6 shadow-sm";
  card.id = `exercise-card-${exercise.id}`;

  const allowRetakes = exercise.allow_retakes === true;
  const maxAttempts = exercise.max_attempts || 1;
  const hasSubmissions = attemptCount > 0;
  
  // Can user submit now?
  let canSubmit = true;
  if (hasSubmissions) {
    if (!allowRetakes) {
      canSubmit = false;
    } else if (maxAttempts > 0 && attemptCount >= maxAttempts) {
      canSubmit = false;
    }
  }

  // Attempt Policy Badge text
  let policyBadge = "";
  if (!allowRetakes) {
    policyBadge = `<span class="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full text-xs font-semibold">O singură trimitere permisă</span>`;
  } else if (maxAttempts === 0) {
    policyBadge = `<span class="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold">Reîncercări nelimitate (Încercarea ${attemptCount + 1})</span>`;
  } else {
    policyBadge = `<span class="px-2.5 py-1 bg-purple-50 text-purple-700 rounded-full text-xs font-semibold">Încercarea ${Math.min(attemptCount + (canSubmit ? 1 : 0), maxAttempts)} din ${maxAttempts}</span>`;
  }

  // Score Badge
  let scoreBadge = "";
  if (latestSubmission) {
    const isOverride = latestSubmission.manual_override_score !== null;
    scoreBadge = `
      <span class="px-3 py-1 bg-emerald-100 text-emerald-900 rounded-xl text-sm font-black inline-flex items-center gap-1.5 shadow-sm">
        <svg class="w-4 h-4 text-emerald-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
        Punctaj: ${latestSubmission.final_score} / ${exercise.max_score} p. ${isOverride ? '(Corectat manual)' : ''}
      </span>
    `;
  }

  // Teacher Feedback Banner (if any)
  let feedbackBanner = "";
  if (latestSubmission && (latestSubmission.teacher_feedback || latestSubmission.manual_override_score !== null)) {
    feedbackBanner = `
      <div class="mb-5 bg-amber-50 border border-amber-300 rounded-xl p-4 text-sm text-amber-950">
        <div class="font-bold flex items-center gap-1.5 mb-1 text-amber-900">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>
          Comentariul Profesorului:
        </div>
        <div>${latestSubmission.teacher_feedback || 'Nota a fost revizuită manual de către profesor.'}</div>
      </div>
    `;
  }

  card.innerHTML = `
    <!-- Top Metadata -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-4 border-b border-slate-100 gap-2">
      <div>
        <h2 class="text-xl font-bold text-slate-900">${exercise.title}</h2>
        <div class="flex items-center gap-2 mt-1">
          ${policyBadge}
          <span class="text-xs text-slate-400">Total: ${exercise.max_score} puncte</span>
        </div>
      </div>
      <div>
        ${scoreBadge}
      </div>
    </div>

    ${feedbackBanner}

    <!-- Exercise Form Content Mount -->
    <form class="hw-form space-y-4" onsubmit="return false;">
      <div class="exercise-prompt-mount prose max-w-none">
        ${exercise.prompt_html}
      </div>

      <div class="hw-result-alert hidden mt-4 p-4 rounded-xl text-sm font-semibold"></div>

      <!-- Action Button Area -->
      <div class="pt-4 border-t border-slate-100 flex items-center justify-between">
        <div class="text-xs text-slate-500">
          ${
            !canSubmit 
              ? `<span class="text-slate-500 font-medium">⚠️ Trimiterea este blocată (a fost atins numărul maxim de încercări). Răspunsurile sunt în mod doar-citire.</span>` 
              : `Toate răspunsurile sunt înregistrate la trimitere.`
          }
        </div>

        <button type="button" class="btn-submit-hw px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-md transition inline-flex items-center gap-2 ${
          !canSubmit ? 'hidden' : ''
        }">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
          <span>Trimite Tema</span>
        </button>
      </div>
    </form>
  `;

  // Inject exercise scoped CSS if present
  if (exercise.scoped_css) {
    const styleEl = document.createElement('style');
    styleEl.textContent = exercise.scoped_css;
    card.appendChild(styleEl);
  }

  // Inject exercise scoped JS if present
  if (exercise.scoped_js) {
    const scriptEl = document.createElement('script');
    scriptEl.textContent = `(function() { try { ${exercise.scoped_js} } catch(e) { console.warn(e); } })();`;
    card.appendChild(scriptEl);
  }

  // Populate past answers if student already submitted
  if (latestSubmission && latestSubmission.answers_json) {
    const answers = latestSubmission.answers_json;
    const inputs = card.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      const key = input.name || input.dataset.questionKey || input.id;
      if (key && answers[key] !== undefined) {
        input.value = answers[key];
      }
      if (!canSubmit) {
        input.disabled = true;
        input.classList.add('bg-slate-100', 'cursor-not-allowed', 'text-slate-600');
      }
    });
  }

  // Submit Handler
  const submitBtn = card.querySelector('.btn-submit-hw');
  const alertEl = card.querySelector('.hw-result-alert');

  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      // Gather inputs
      const answers = {};
      const inputs = card.querySelectorAll('input, select, textarea');
      inputs.forEach(input => {
        const key = input.name || input.dataset.questionKey || input.id;
        if (key) {
          answers[key] = input.value.trim();
        }
      });

      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span>Se evaluează pe server...</span>`;

      try {
        const { data, error } = await supabase.rpc('submit_exercise_attempt', {
          p_exercise_id: exercise.id,
          p_answers: answers
        });

        if (error) throw error;

        alertEl.classList.remove('hidden', 'bg-red-50', 'text-red-900', 'border-red-200');
        alertEl.className = "hw-result-alert mt-4 p-4 rounded-xl text-sm font-semibold border bg-emerald-50 text-emerald-950 border-emerald-300";
        alertEl.innerHTML = `
          <div class="flex items-center justify-between">
            <span class="text-base font-black">Tema a fost trimisă și notată!</span>
            <span class="text-sm bg-emerald-200 text-emerald-900 px-3 py-1 rounded-lg">Punctaj: ${data.score} / ${data.max_score} p.</span>
          </div>
          <p class="text-xs text-emerald-800 font-normal mt-1">Încercarea #${data.attempt_number} a fost salvată în sistem pentru evaluarea profesorului.</p>
        `;

        // Check if retakes are disabled or limit reached
        const retakesAllowed = data.allow_retakes === true;
        const reachedLimit = data.max_attempts > 0 && data.attempt_number >= data.max_attempts;

        if (!retakesAllowed || reachedLimit) {
          submitBtn.classList.add('hidden');
          inputs.forEach(input => {
            input.disabled = true;
            input.classList.add('bg-slate-100', 'cursor-not-allowed', 'text-slate-600');
          });
        } else {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<span>Reîncearcă Exercițiul (Încercarea ${data.attempt_number + 1})</span>`;
        }

      } catch (err) {
        alertEl.className = "hw-result-alert mt-4 p-4 rounded-xl text-sm font-semibold border bg-red-50 text-red-900 border-red-300";
        alertEl.textContent = `Eroare: ${err.message}`;
        alertEl.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Trimite din nou</span>`;
      }
    });
  }

  return card;
}
