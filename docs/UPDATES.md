# Desktop updates

## Online (automatic)
- Installed app checks GitHub Releases of `studionexify/NexSpiro` on startup and via **Help → Check for updates…** (Alt shows the menu bar).
- New version downloads in the background; user is asked to restart, otherwise it installs on quit.
- Publish a release: bump `version` in `package.json`, then `GH_TOKEN=<token with repo scope> npm run electron:release`.
  This uploads `NexSpiro Setup x.y.z.exe`, `.blockmap` and `latest.yml`; the release must be published (not draft) for clients to see it.
- If the repo is private, clients cannot read releases without a token — publish to a public repo or switch `build.publish` to S3/R2/generic.

## Offline (Windows)
- Copy `release/NexSpiro Setup x.y.z.exe` to the PC (USB etc.).
- **Help → Update from file…**, pick the .exe: version is compared, Authenticode signer must match the running app, then it installs silently and relaunches.
- Unsigned builds cannot be verified; the dialog warns instead. Sign releases (`CSC_LINK`/`CSC_KEY_PASSWORD` or Azure Trusted Signing) to enable the check and avoid SmartScreen prompts.
