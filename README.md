# 📍 Nearby — Consent-Based Location Sharing

A "Find My Friends"–style web app where **everyone opts in**. Your live location is shared only with members of a group you choose to join, sharing is mutual and transparent, and you can pause or leave in one tap.

**This is not a covert tracker.** It only works with the informed consent of everyone whose location is shared. Tracking a person without their knowledge is prohibited.

## Live demo

Runs in **demo mode** out of the box (your real GPS + a few simulated contacts) so the live link works with zero setup. Enable real cross-device sharing by pasting your own free Firebase config.

## Features

- Consent gate before anything is shared
- Real device location via the browser Geolocation API
- Live map (Leaflet + OpenStreetMap)
- Group codes — share a code, everyone with it is mutually visible
- Pause / resume sharing and leave anytime
- Optional live sync via Firebase Realtime Database
- Front-end only — deployable free on GitHub Pages

## Enable real cross-device sharing (Firebase)

1. Create a free project at console.firebase.google.com.
2. Add a **Realtime Database**.
3. Copy the `firebaseConfig` object from Project settings.
4. In the app: **Settings → paste config → Save & connect.**

Suggested Realtime Database rules:

```json
{
  "rules": {
    "groups": { "$group": { "members": { ".read": true, ".write": true } } }
  }
}
```

## Run locally

```bash
python3 -m http.server 8080
```

Geolocation requires HTTPS or localhost — GitHub Pages provides HTTPS automatically.

## Privacy & ethics

- Nothing is shared until you consent and tap **Start sharing**.
- Location data lives only in your Firebase project (or nowhere, in demo mode).
- Use only with the knowledge and consent of everyone involved.

## License

MIT
