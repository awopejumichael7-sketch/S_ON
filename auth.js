/* ════════════════════════════════════════════════════════
   AUTH.JS — Login / Signup / Logout (Firebase Authentication)
   Depends on firebase-config.js being loaded first.
   ════════════════════════════════════════════════════════ */

const Auth = {
  currentUser: null,

  // Watch login state. Calls onLogin(user) / onLogout() as state changes.
  init(onLogin, onLogout) {
    auth.onAuthStateChanged((user) => {
      Auth.currentUser = user;
      if (user) {
        onLogin && onLogin(user);
      } else {
        onLogout && onLogout();
      }
    });
  },

  async signup(name, email, password) {
    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: name });

      // Create the user's profile document in Firestore (CREATE)
      await db.collection("users").doc(cred.user.uid).set({
        name,
        email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      return { success: true, user: cred.user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async login(email, password) {
    try {
      const cred = await auth.signInWithEmailAndPassword(email, password);
      return { success: true, user: cred.user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async logout() {
    await auth.signOut();
  },

  async resetPassword(email) {
    try {
      await auth.sendPasswordResetEmail(email);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  isLoggedIn() {
    return !!Auth.currentUser;
  },

  getUserId() {
    return Auth.currentUser ? Auth.currentUser.uid : null;
  }
};
