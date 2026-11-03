ULTIMATE ONLINE BACKEND
Upload everything in this zip to the root of the backend repo (src/, public/, wrangler.jsonc, tools/) and redeploy.
public/ must exist: wrangler.jsonc points its static assets at ./public and the deploy fails without it.
Keep the Worker name "ultimate-online" so the existing accounts (Durable Object storage) are kept.
The game talks to https://ultimate-online.ezjgabin.workers.dev - if you deploy under another name, paste the new address into
the game's sign-in box ("server settings / test connection").
