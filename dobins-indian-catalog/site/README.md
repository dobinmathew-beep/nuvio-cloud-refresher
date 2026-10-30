# Published service source

The service is a Cloudflare-compatible ESM Worker. Its published URL is https://dobins-indian-catalog.quickfield138.chatgpt.site/.

`worker/server.mjs` implements the add-on protocol, artwork and public routes; `worker/page.html` is the installer/browser UI. These files mirror the current deployed service.

To reproduce the Worker bundle, copy the seven JSON snapshots from the parent `data/` folder into `worker/seed/`, provide a PNG add-on logo at `worker/icon.png`, and run `python scripts/assemble.py`. The generated `worker/index.js` exports `default.fetch`. Routine catalog updates need no Worker rebuild or redeployment: the deployed service reads the JSON snapshots directly from this branch.

Keep the permanent origin and raw-data URL in `worker/server.mjs` unchanged. Do not put GitHub credentials in this Worker; public snapshot reads require none.
