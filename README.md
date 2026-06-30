# Firebase Add-On for School-_of_nursing CBT App

This folder adds **Firebase Authentication (login/signup)** and **full Firestore CRUD**
(Create, Read, Update, Delete) for exam attempts and user profiles to your existing
static app, without touching your existing exam logic.

## Files

| File | Purpose |
|---|---|
| `firebase-config.js` | Your Firebase project keys + SDK init |
| `auth.js` | Login, signup, logout, password reset |
| `firestore.js` | CRUD functions: `ExamDB.saveAttempt/getAttempts/getAttempt/updateAttempt/deleteAttempt/clearHistory`, plus profile read/update |
| `firestore.rules` | Security rules — each user can only access their own data |
| `login-screen.html` | The login/signup screen markup |
| `auth-styles.css` | Styling for the login screen |
| `app-auth-integration.js` | Glue code: shows/hides screens based on login state, auto-saves exam results |

## Setup steps

### 1. Create the Firebase project
1. Go to https://console.firebase.google.com → **Add project**.
2. In **Build → Authentication → Sign-in method**, enable **Email/Password**.
3. In **Build → Firestore Database**, click **Create database** (production mode, pick a region).
4. In **Project settings → General → Your apps**, click the **Web (`</>`)** icon to register a web app, then copy the `firebaseConfig` object it shows you.
5. Paste those values into `firebase-config.js` in this folder (replace the `YOUR_...` placeholders).

### 2. Publish the security rules
In the Firebase console, go to **Firestore Database → Rules**, paste in the contents of `firestore.rules`, and click **Publish**.

### 3. Copy files into your repo
Copy these into the root of `School-_of_nursing` (same folder as your existing `index.html`):
```
firebase-config.js
auth.js
firestore.js
app-auth-integration.js
```

**Replace your existing `index.html` entirely** with the `index.html` in this folder — it's
your original file with the login screen already inserted, the dashboard no longer set to
auto-show, and all the new `<script>` tags added in the correct order. Nothing else about
your original markup was changed.

### 4. `style.css` is already merged
The `style.css` in this folder is your original stylesheet with the auth screen styles appended
at the end, using your project's actual CSS variables (`--bg-card`, `--accent`, `--r-lg`, etc.)
so it matches your existing dark/light theme automatically. Just replace your repo's `style.css`
with this one — nothing else in it was changed.

### 5. Auto-save is already wired up exactly
I checked your real `script.js` — the hook in `app-auth-integration.js` now wraps
`CBT.computeAndShowResult()` directly, using the exact same `correct/wrong/skipped/pct/
timeSpent/grade` calculation your app already uses, so the Firestore record matches your
localStorage history record field-for-field. No edits needed.

Optional: if you want the "Past Results" screen to also reflect cloud data (e.g. so a user
sees the same history on a different device), call `AppAuthUI.syncHistory('physics')`
(swap in the subject) before `CBT.showHistory(subject)` is invoked, or add a "Sync" button
to the history screen that calls it. `AppAuthUI.deleteHistoryItem(subject, firestoreId)` and
`AppAuthUI.clearCloudHistory(subject)` are also available for deleting cloud records.

### 6. Test it
Open `index.html` in a browser (or push to GitHub Pages). You should see:
- A login/signup screen first.
- After signing up, a new document appears under **Firestore → users → {uid}**.
- After finishing an exam, a new document appears under **users/{uid}/attempts**.
- A 🚪 logout button appears in the header.

## CRUD reference (use anywhere after login)

```js
// CREATE
await ExamDB.saveAttempt({ subject: "physics", score: 85, correct: 51, wrong: 9, skipped: 0, timeSpent: 3200, answers: {} });

// READ all attempts (optionally filter by subject)
const { attempts } = await ExamDB.getAttempts("physics");

// READ one attempt
const { attempt } = await ExamDB.getAttempt(attemptId);

// UPDATE
await ExamDB.updateAttempt(attemptId, { score: 90 });

// DELETE one
await ExamDB.deleteAttempt(attemptId);

// DELETE all (clear history)
await ExamDB.clearHistory("physics");

// Profile
const { profile } = await ExamDB.getProfile();
await ExamDB.updateProfile({ name: "New Name" });
```

## Pushing to GitHub
Since I don't have write access to your repository, commit these changes yourself:
```bash
git add index.html style.css firebase-config.js auth.js firestore.js app-auth-integration.js
git commit -m "Add Firebase auth and Firestore CRUD for exam attempts"
git push
```
