# Static PWA in plain HTML/CSS/JS, self-hosted

The app is a Progressive Web App (manifest + service worker) written in plain HTML, CSS and JavaScript with no framework and no build step, hosted as static files (GitHub Pages / Netlify). This gives home-screen install, full screen and offline use without App Store, Xcode or a developer account, and keeps hosting trivial.

## Considered Options

- Native iOS app: rejected, needs Xcode and an Apple developer account.
- Claude Artifact only: kept for quick testing, but offline and standalone mode are not reliable there.
- Framework + bundler: rejected, a build step adds friction for a small, self-contained app.
