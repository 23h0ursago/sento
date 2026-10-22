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

## Live sync between two phones

Sync uses a free Supabase project:

1. Create a project at https://supabase.com and run `supabase.sql` in its SQL Editor.
2. Put the Project URL and publishable key into `config.js`, then push.
3. In the app: Settings → **Start sharing**, then **Invite** your partner. They open the link, or paste the code under Settings → Live sync.

Each phone keeps a full offline copy and syncs on open, every 20 seconds while open, and right after each change. Every favourite and visit is its own record, so the newest edit wins and nothing else gets overwritten. The household code is the only key to your data, so share it only with each other.

Settings → **Export** / **Import** still works as a backup.
