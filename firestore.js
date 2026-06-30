/* ════════════════════════════════════════════════════════
   FIRESTORE.JS — Full CRUD for exam attempts & user profiles
   Depends on firebase-config.js and auth.js being loaded first.

   Firestore structure:
     users/{uid}                       -> { name, email, createdAt }
     users/{uid}/attempts/{attemptId}  -> { subject, score, correct,
                                            wrong, skipped, timeSpent,
                                            answers, createdAt }
   ════════════════════════════════════════════════════════ */

const ExamDB = {

  // ── CREATE ────────────────────────────────────────────
  // Save a finished exam attempt for the logged-in user.
  async saveAttempt(attempt) {
    const uid = Auth.getUserId();
    if (!uid) return { success: false, error: "Not logged in" };

    try {
      const ref = await db
        .collection("users").doc(uid)
        .collection("attempts").add({
          subject: attempt.subject,
          score: attempt.score,
          correct: attempt.correct,
          wrong: attempt.wrong,
          skipped: attempt.skipped,
          timeSpent: attempt.timeSpent,
          answers: attempt.answers || {},
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      return { success: true, id: ref.id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // ── READ (all attempts, optionally filtered by subject) ─
  async getAttempts(subject = null) {
    const uid = Auth.getUserId();
    if (!uid) return { success: false, error: "Not logged in" };

    try {
      let query = db.collection("users").doc(uid).collection("attempts");
      if (subject) query = query.where("subject", "==", subject);
      query = query.orderBy("createdAt", "desc");

      const snap = await query.get();
      const attempts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return { success: true, attempts };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // ── READ (single attempt by id) ──────────────────────
  async getAttempt(attemptId) {
    const uid = Auth.getUserId();
    if (!uid) return { success: false, error: "Not logged in" };

    try {
      const doc = await db
        .collection("users").doc(uid)
        .collection("attempts").doc(attemptId).get();

      if (!doc.exists) return { success: false, error: "Attempt not found" };
      return { success: true, attempt: { id: doc.id, ...doc.data() } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // ── UPDATE (e.g. edit a saved attempt's notes/score) ──
  async updateAttempt(attemptId, updates) {
    const uid = Auth.getUserId();
    if (!uid) return { success: false, error: "Not logged in" };

    try {
      await db
        .collection("users").doc(uid)
        .collection("attempts").doc(attemptId)
        .update(updates);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // ── DELETE (single attempt) ──────────────────────────
  async deleteAttempt(attemptId) {
    const uid = Auth.getUserId();
    if (!uid) return { success: false, error: "Not logged in" };

    try {
      await db
        .collection("users").doc(uid)
        .collection("attempts").doc(attemptId).delete();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // ── DELETE (clear all attempt history for a subject) ─
  async clearHistory(subject = null) {
    const uid = Auth.getUserId();
    if (!uid) return { success: false, error: "Not logged in" };

    try {
      let query = db.collection("users").doc(uid).collection("attempts");
      if (subject) query = query.where("subject", "==", subject);

      const snap = await query.get();
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      return { success: true, deleted: snap.size };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // ── User profile: READ ────────────────────────────────
  async getProfile() {
    const uid = Auth.getUserId();
    if (!uid) return { success: false, error: "Not logged in" };

    try {
      const doc = await db.collection("users").doc(uid).get();
      if (!doc.exists) return { success: false, error: "Profile not found" };
      return { success: true, profile: doc.data() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // ── User profile: UPDATE ──────────────────────────────
  async updateProfile(updates) {
    const uid = Auth.getUserId();
    if (!uid) return { success: false, error: "Not logged in" };

    try {
      await db.collection("users").doc(uid).update(updates);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};
