/* ════════════════════════════════════════════════════════
   APP-AUTH-INTEGRATION.JS
   Wires the login screen to Firebase Auth, gates the app
   behind login, and hooks exam submission into Firestore.

   Load order in index.html (just before </body>, AFTER
   questions.js and script.js, and AFTER the Firebase SDK):

     <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
     <script src="firebase-config.js"></script>
     <script src="auth.js"></script>
     <script src="firestore.js"></script>
     <script src="questions.js"></script>
     <script src="script.js"></script>
     <script src="app-auth-integration.js"></script>
   ════════════════════════════════════════════════════════ */

const AppAuthUI = {
  mode: "login", // "login" | "signup"

  toggleMode(e) {
    if (e) e.preventDefault();
    AppAuthUI.mode = AppAuthUI.mode === "login" ? "signup" : "login";
    const isSignup = AppAuthUI.mode === "signup";

    document.getElementById("auth-title").textContent = isSignup ? "Create Account" : "Sign In";
    document.getElementById("auth-submit-btn").textContent = isSignup ? "Sign Up" : "Sign In";
    document.getElementById("auth-name-group").style.display = isSignup ? "block" : "none";
    document.getElementById("auth-toggle-text").textContent = isSignup
      ? "Already have an account?"
      : "Don't have an account?";
    document.getElementById("auth-toggle-link").textContent = isSignup ? "Sign In" : "Sign Up";
    AppAuthUI.clearError();
  },

  showError(msg) {
    const el = document.getElementById("auth-error");
    el.textContent = msg;
    el.style.display = "block";
  },

  clearError() {
    document.getElementById("auth-error").style.display = "none";
  },

  async submit() {
    AppAuthUI.clearError();
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;

    if (!email || !password) {
      AppAuthUI.showError("Please fill in all fields.");
      return;
    }

    const btn = document.getElementById("auth-submit-btn");
    btn.disabled = true;
    btn.textContent = "Please wait…";

    let result;
    if (AppAuthUI.mode === "signup") {
      const name = document.getElementById("auth-name").value.trim();
      if (!name) {
        AppAuthUI.showError("Please enter your name.");
        btn.disabled = false;
        btn.textContent = "Sign Up";
        return;
      }
      result = await Auth.signup(name, email, password);
    } else {
      result = await Auth.login(email, password);
    }

    btn.disabled = false;
    btn.textContent = AppAuthUI.mode === "signup" ? "Sign Up" : "Sign In";

    if (!result.success) {
      AppAuthUI.showError(result.error);
    }
    // onAuthStateChanged (Auth.init below) handles the screen switch on success
  },

  async forgotPassword() {
    const email = document.getElementById("auth-email").value.trim();
    if (!email) {
      AppAuthUI.showError("Enter your email above first, then click 'Forgot password?'");
      return;
    }
    const result = await Auth.resetPassword(email);
    if (result.success) {
      AppAuthUI.showError("Password reset email sent. Check your inbox.");
    } else {
      AppAuthUI.showError(result.error);
    }
  }
};

// ── Screen switching helpers ──────────────────────────────
function showLoginScreen() {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-login").classList.add("active");
}

function showAppAfterLogin(user) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-dashboard").classList.add("active");

  // Inject a small user badge + logout button into the header, if not present
  const headerActions = document.querySelector(".header-actions");
  if (headerActions && !document.getElementById("user-badge")) {
    const badge = document.createElement("div");
    badge.id = "user-badge";
    badge.className = "user-badge";
    badge.innerHTML = `
      <span>👤 ${user.displayName || user.email}</span>
      <button class="btn-icon" title="Log out" aria-label="Log out" onclick="Auth.logout()">🚪</button>
    `;
    headerActions.prepend(badge);
  }
}

// ── Gate the whole app behind auth state ──────────────────
Auth.init(
  (user) => showAppAfterLogin(user),
  () => showLoginScreen()
);

/* ────────────────────────────────────────────────────────
   Hook into exam submission so every finished attempt is
   saved to Firestore automatically (in addition to the
   localStorage history script.js already keeps).

   Verified against your actual script.js: the real result
   numbers are computed inside CBT.computeAndShowResult(),
   which also calls Store.set(`history_${subject}`, ...) with
   { score: pct, correct, wrong, skipped, timeSpent, grade }.
   We wrap that exact function so the Firestore record matches
   the localStorage history record field-for-field. Relies on
   TOTAL_QUESTIONS, EXAM_DURATION, getGrade() being globally
   available (they are, since script.js loads before this file).
   ──────────────────────────────────────────────────────── */
(function hookExamSubmit() {
  if (typeof CBT === "undefined" || !CBT.computeAndShowResult) return;

  const originalCompute = CBT.computeAndShowResult.bind(CBT);

  CBT.computeAndShowResult = function () {
    try {
      const qs = this.state.questions;
      const ans = this.state.answers;
      let correct = 0, wrong = 0, skipped = 0;

      qs.forEach((q, i) => {
        const userAns = ans[i];
        if (!userAns) skipped++;
        else if (userAns === q.correct) correct++;
        else wrong++;
      });

      const pct = Math.round((correct / TOTAL_QUESTIONS) * 100);
      const grade = getGrade(pct);
      const timeSpent = this.state.examEndTime
        ? Math.round((this.state.examEndTime - this.state.examStartTime) / 1000)
        : EXAM_DURATION - this.state.timerSecondsLeft;

      if (Auth.isLoggedIn()) {
        ExamDB.saveAttempt({
          subject: this.state.subject,
          score: pct,
          correct,
          wrong,
          skipped,
          timeSpent,
          grade: grade.label,
          answers: ans
        }).catch(e => console.warn("Firestore saveAttempt failed:", e));
      }
    } catch (e) {
      console.warn("Could not auto-save attempt to Firestore:", e);
    }

    // Run the original, untouched result rendering / localStorage save.
    return originalCompute();
  };
})();

/* ────────────────────────────────────────────────────────
   Optional: pull Firestore history into the existing
   "Past Results" screen so it reflects cloud data too
   (useful if the user switches devices). Call this from
   the console or wire a button to it — e.g. add
   onclick="AppAuthUI.syncHistory('physics')" to the
   history screen's header.
   ──────────────────────────────────────────────────────── */
AppAuthUI.syncHistory = async function (subject) {
  if (!Auth.isLoggedIn()) return;
  const { success, attempts } = await ExamDB.getAttempts(subject);
  if (!success) return;

  const histKey = `cbt_v1_history_${subject}`;
  const localFormat = attempts.map(a => ({
    date: a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().toISOString() : new Date().toISOString(),
    score: a.score,
    correct: a.correct,
    wrong: a.wrong,
    skipped: a.skipped,
    timeSpent: a.timeSpent,
    grade: a.grade,
    firestoreId: a.id
  }));
  localStorage.setItem(histKey, JSON.stringify(localFormat));

  // Re-render if currently viewing this subject's history
  if (CBT.state.mode === "history") CBT.showHistory(subject);
};

/* Delete a single cloud attempt and refresh the history view */
AppAuthUI.deleteHistoryItem = async function (subject, firestoreId) {
  if (!Auth.isLoggedIn() || !firestoreId) return;
  await ExamDB.deleteAttempt(firestoreId);
  await AppAuthUI.syncHistory(subject);
};

/* Clear all cloud attempts for a subject and refresh the history view */
AppAuthUI.clearCloudHistory = async function (subject) {
  if (!Auth.isLoggedIn()) return;
  if (!confirm(`Delete all saved ${subject} attempts from your account? This cannot be undone.`)) return;
  await ExamDB.clearHistory(subject);
  await AppAuthUI.syncHistory(subject);
};
