# Sento

A tiny PWA for planning and tracking sento visits together. Plain HTML/CSS/JS with no build step and no dependencies.

- **Should we go?** suggests quiet times this week (just after opening or late evening). It skips closing days, ranks weekends lower and nudges harder the longer it's been since the last soak.
- **Favourites** stores each sento's name, opening hours and regular closing days.
- **Log a visit** takes a date, a sento and an optional rating and note.
- **History** shows past visits, visits this month and the longest streak (consecutive weeks with at least one visit).

## Run it locally

```sh
cd ~/Desktop/Sento
python3 -m http.server 8000
```

Open http://localhost:8000. On an iPhone on the same Wi-Fi, open `http://<your-mac's-ip>:8000`. Add to Home Screen works over plain HTTP, but offline caching needs HTTPS.

## Host it (HTTPS, free)

Any static host works. Upload the whole folder:

- **Netlify Drop**: drag the folder onto https://app.netlify.com/drop
- **Cloudflare Pages** or **GitHub Pages**: push the folder to a repo and point Pages at it

Then on each iPhone, open the URL in Safari → Share → **Add to Home Screen**.

When you deploy changes, bump `CACHE` in `sw.js` so phones pick up the new files.

## Sharing data between two phones

Right now each phone keeps its own data (in `localStorage`). Use Settings → **Export** (AirDrop the file) and **Import** on the other phone to merge. The newer edit wins and deletions carry over.

For live sync, replace `store.load`/`store.save` in `app.js` with a small backend (e.g. Supabase, Firebase, or a Cloudflare Worker + D1). Records already carry ids, `u` (updated-at) timestamps and a `deleted` list, so they're ready to merge.
