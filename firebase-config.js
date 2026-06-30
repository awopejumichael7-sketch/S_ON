/* ════════════════════════════════════════════════════════
   FIREBASE CONFIGURATION
   ════════════════════════════════════════════════════════
   1. Go to https://console.firebase.google.com
   2. Create a project (or use an existing one)
   3. Project settings → General → "Your apps" → Add app → Web (</>)
   4. Copy the config object Firebase gives you and paste it below
   5. In the Firebase console, enable:
        - Authentication → Sign-in method → Email/Password (Enable)
        - Firestore Database → Create database (Start in production mode)
   6. Set Firestore Rules (see firestore.rules in this folder) so users
      can only read/write their own data.
   ════════════════════════════════════════════════════════ */

const firebaseConfig = {
  apiKey: "AIzaSyAMpTPa4cGbothg2vu51eLecvZzrnVi6uU",
    authDomain: "schoolofnursing-11d85.firebaseapp.com",
    projectId: "schoolofnursing-11d85",
    storageBucket: "schoolofnursing-11d85.firebasestorage.app",
    messagingSenderId: "939206185545",
    appId: "1:939206185545:web:e46e45d2cff9b1612de598"
};

// Initialize Firebase (using the compat/CDN SDK loaded in index.html)
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
