# Padel Tournament

A phone-first web app for local Americano / Mexicano padel tournaments.
No build step, no server code: three static files (`index.html`, `app.js`, `logic.js`) plus a free
Firebase Realtime Database to sync phones.

## How it works

1. **Create** (organiser): name, mode, number of players, courts, points per match, rounds. Minutes per
   round are estimated from the points (~30 s per point + 4 min changeover) and the total time estimate
   updates live. **Create tournament & invite players** gives a 5-letter code + QR code.
2. **Join** (everyone): players scan the QR (or open the shared link, or type the code) on their own phones
   and enter their name. The organiser can also add players who have no phone, and can still edit the rules.
3. Rounds follow the number of players who actually joined, unless the organiser set them by hand.
4. **Start**: each round shows who plays on which court and who sits out. Anyone can enter a score by
   scrolling (or tapping) the number wheel; setting one side fills the other (e.g. to 24: 15 → 9).
   Standings update on every phone.
5. **Next round** unlocks only when every match has a result. **End tournament now** works at any time
   and freezes the current standings (organiser only).
6. The final screen shows the podium and a "Tournament wrapped" with random fun achievements
   (Demolition, Nail-biter, On fire, Dream team, The Wall, …). **Share results picture** creates a
   story-sized PNG and opens the phone's share sheet (or downloads it on desktop).

- **Americano**: partners are picked to avoid repeated partners and opponents.
- **Mexicano**: round 1 is random, then players are grouped by ranking (1st + 4th vs 2nd + 3rd).
- More players than court spots: sit-outs rotate so everyone sits out equally often.
- Organiser controls live on the phone that created the tournament. If that phone dies, tap
  **I'm the organiser** at the bottom of any other phone.

## Free hosting (about 10 minutes, once)

### 1. Firebase database (sync between phones)

1. Go to <https://console.firebase.google.com>, **Add project** (Google Analytics not needed). The free Spark plan is enough.
2. **Build → Realtime Database → Create database** (pick the region closest to you, start in *locked mode*).
3. **Rules** tab: paste the contents of [database.rules.json](database.rules.json), **Publish**.
4. **Project settings (gear) → Your apps → Web (`</>`)**: register an app (no hosting needed), copy the `firebaseConfig` object.
5. In [index.html](index.html), replace `window.FIREBASE_CONFIG = null` with that object, e.g.
   ```js
   window.FIREBASE_CONFIG = { apiKey: "...", authDomain: "...", databaseURL: "https://...firebasedatabase.app", projectId: "...", appId: "..." }
   ```
   Make sure `databaseURL` is included. The web config is not a secret; access is controlled by the rules.

Without a config the app still works, but on one device only (useful for testing).

### 2. Host the files (pick one)

- **GitHub Pages**: push this folder to a GitHub repo → Settings → Pages → Deploy from branch `main` / root.
  URL: `https://<user>.github.io/<repo>/`.
- **Netlify Drop**: drag this folder onto <https://app.netlify.com/drop>.
- **Firebase Hosting**: `npm i -g firebase-tools`, `firebase init hosting` (public dir `.`), `firebase deploy`.

On the phone, "Add to Home Screen" makes it feel like an app.

## Run locally

```powershell
python -m http.server 8765
```

Open <http://localhost:8765>. Tests for the pairing/standings logic:

```powershell
node logic.test.mjs
```

## Known limits

- Anyone with a tournament code can read and edit that tournament (fine for a club evening; codes are random, 31⁵ ≈ 28 M).
- Old tournaments are never deleted. The free tier (1 GB) holds hundreds of thousands of them; delete in the Firebase console if needed.
- If the player count is not a multiple of 4, some players can end with one match fewer. Standings show *Played* so this is visible.
