# Sento

A tiny PWA for planning and tracking sento visits together. Plain HTML/CSS/JS with no build step and no dependencies.

- **Should we go?** shows three milk bottles: 🥛 regular milk drinks down over two weeks without a soak, 🍓 strawberry fills toward your monthly goal (Settings), ☕ coffee fills with your weekly streak. Below them are quiet times this week (just after opening or late evening). It skips closing days, ranks weekends lower and suggests sooner days the longer it's been since the last soak.
- **Favourites** stores each sento's name, opening hours and regular closing days.
- **Log a visit** takes a date, a sento and an optional rating and note.
- **History** shows a yellow milk crate that fills with every bottle of milk you log after a bath (🥛 milk, 🍓 strawberry, ☕ coffee, 🍊 fruit; 12 per crate), total visits and total bottles, and your past visits.
- **Log a visit** also records how many bottles of milk you had.

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

## Weather

The top bar shows the current weather from [Open-Meteo](https://open-meteo.com) (free, no account), for where the map last found you, your pinned sento, or Tokyo. Cold or rainy weather gets a ♨ badge, and cold or rainy days in the 7-day forecast rank higher in "Should we go?". Each suggestion has a 📅 button that opens a filled-in Google Calendar event.

## Live sync between two phones

Sync uses a free Supabase project:

1. Create a project at https://supabase.com and run `supabase.sql` in its SQL Editor.
2. Put the Project URL and publishable key into `config.js`, then push.
3. In the app: Settings → **Start sharing**, then **Invite** your partner. They open the link, or paste the code under Settings → Live sync.

Each phone keeps a full offline copy and syncs on open, every 20 seconds while open, and right after each change. Every favourite and visit is its own record, so the newest edit wins and nothing else gets overwritten. The household code is the only key to your data, so share it only with each other.

Settings → **Export** / **Import** still works as a backup.

## Sento calendar

The **Sento** tab opens on a month calendar. Each day shows the opening time (or 休み on closing days), the special bath's emoji, and a red 湯 stamp on days you went. Tap a day for its hours, special baths and visits. Under the calendar, the month's special baths are listed as colourful cards.

To add a sento's monthly bath calendar, tap **+ Add** under Special baths, pick the sento and month, and type one bath per line in the poster's format:

```
毎日 ミルク風呂
2-4 ほうじ茶風呂
30-11/1 JIKKO
```

Emoji and colours are picked from the bath's name. Tap any special to edit or delete it.

## Map & nearby sento

The Sento tab's **🗺 Map** view shows sento within 15 km:

- **✓ green pins**: your sento you've been to · **♨ blue pins**: your sento you haven't been to yet
- **🌟**: popular Tokyo sento (`tools/popular-tokyo.json`) · **orange dots**: every other sento
- Filters: **🐉 Tattoo-friendly** and **🌟 Popular only**
- **+ Add** puts a place in your list (with hours when OpenStreetMap has them). If it's a sento you already have (e.g. "Kosugiyu" vs 小杉湯), choose it to pin it instead.

**Tattoos:** set what you know on each sento (OK / OK if covered / not allowed). Otherwise the app guesses: neighbourhood sento usually allow tattoos, super sento and spas often don't. Guesses are marked "not confirmed".

**Data:** `data/sento/` holds every sento in Japan from OpenStreetMap (~6,000), split into 0.5° tiles so the app only loads the area you're in: instant, and it works offline. The **Update sento data** GitHub Action (`.github/workflows/sento-data.yml`) rebuilds it every Monday with `tools/build_sento_data.py`, and you can run it by hand from the Actions tab. Outside Japan the app falls back to a live OpenStreetMap search. Map and sento data © OpenStreetMap contributors.

## さっぱり photo diary

When logging a visit, add photos with 🤳 **Selfie** (front camera) or 🖼 **Choose**. Every photo appears in the **さっぱり** tab as a grid grouped by month. Tap one to see it large with the sento, date, rating and note.

Photos are shrunk on the phone (a ~360px grid thumbnail and a ~1280px image) and kept there, so they work offline. To share them with your partner, run `supabase-photos.sql` once in the Supabase SQL Editor. Photos are then uploaded under your private household code. Deleting a photo removes it from both phones and from Supabase. Export/Import backups don't include photos.

## Google Calendar suggestions

With calendars connected, "Should we go?" only suggests 2-hour windows when you're both free, a favourite is open, and it's likely quiet. A small Google Apps Script (`google-apps-script/Code.gs`) runs under your Google account and returns only merged busy times. No event titles or details leave Google, and no Google Cloud project is needed.

1. **Moka shares their calendar with you.** On a computer, Moka opens calendar.google.com → ⚙️ Settings → their calendar under "Settings for my calendars" → **Share with specific people or groups** → add your Gmail → **See only free/busy (hide details)**.
2. **Create the script.** At https://script.google.com → **New project**, replace the code with `Code.gs`, fill in Moka's address at the top, and save.
3. **Turn on the Calendar service.** In the left sidebar, **Services ＋** → **Google Calendar API** → **Add**.
4. **Run `setup` once.** Pick `setup` in the toolbar and click **Run**, then allow access. Google warns the app isn't verified, because it's your own script: **Advanced** → **Go to … (unsafe)** → **Allow**. The log shows ✓ for both calendars and your private key.
5. **Deploy.** **Deploy → New deployment** → ⚙️ **Web app**, set *Execute as* to **Me** and *Who has access* to **Anyone**, then **Deploy** and copy the Web app URL (ends in `/exec`).
6. **Connect the app.** In Settings → Google Calendar, paste the URL and the key, then tap **Connect**. Moka's phone gets it through live sync.

When you change `Code.gs` later, use **Deploy → Manage deployments → ✏️ → Version: New version** so the URL stays the same. If the key leaks, run `newKey` and paste the new key into the app.
