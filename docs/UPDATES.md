# Desktop updates (no server)

- Updates are delivered as installer files only; nothing is hosted or published.
- Build on a Windows PC: `git pull`, `npm ci`, bump `version` in `package.json`, `npm run electron:build` → `release/NexSpiro Setup x.y.z.exe`.
- On each target PC either run that .exe directly, or in NexSpiro press Alt → **Help → Update from file…** and pick it:
  version is compared, the Authenticode signer must match the running app (if signed), then it installs silently and relaunches.
- Settings and devices live in `%APPDATA%` and survive updates.
- Unsigned builds cannot be verified and show a warning; sign releases to enable the check and avoid SmartScreen prompts.
