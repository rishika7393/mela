# Nominated

A personal tracker for every Best Picture nominee: filter by mood, mark what you've seen, log who you watched with and what you thought, and keep an ordered watch-next list. Data lives in Baserow; the site runs on Netlify.

```
public/                     the site (plain HTML, CSS, JS; no build step)
  index.html
  styles.css
  app.js
  demo-data.js              bundled list, used only in preview mode
netlify/functions/movies.mjs  talks to Baserow so your token stays private
baserow-import.csv          your list plus empty columns for your log
netlify.toml
```

## 1. Set up Baserow

1. In Baserow, open a database and choose **+ New table → Import a file**. Upload `baserow-import.csv` and keep "first row is header" on.
2. Change these field types (click the column name → Edit field). Keep the column names exactly as they are.

   | Column | Change type to |
   | --- | --- |
   | Year | Number |
   | IMDb | Number, 1 decimal place |
   | Seen | Boolean |
   | Seen On | Date, ISO format |
   | Queue | Number |
   | Opinion | Long text |

   Optional: make **Mood** and **Status** single select fields. The app handles either.
3. Find the **table ID** in the URL when the table is open: `.../database/12/table/345678/...` → `345678`.
4. Create a **database token**: your profile menu → **Settings → Database tokens → Create token**. Pick the workspace, and give it read and update permission on this table. Copy the token.

`Queue` is how the watch-next list is stored: 1 is next up, empty means not on the list. You can edit it in Baserow too.

## 2. Deploy to Netlify

The site needs a Netlify Function, so deploy from Git or the CLI (drag-and-drop deploys skip functions).

**From GitHub:** push this folder to a repo, then in Netlify choose **Add new site → Import an existing project**. Leave the build command empty; `netlify.toml` sets everything else.

**From the CLI:**
```bash
npm install -g netlify-cli
netlify login
netlify init          # or: netlify link
netlify deploy --prod
```

Then go to **Site configuration → Environment variables** and add:

| Variable | Value |
| --- | --- |
| `BASEROW_TOKEN` | the database token |
| `BASEROW_TABLE_ID` | the table ID |
| `APP_PASSCODE` | strongly recommended; see below |
| `BASEROW_URL` | only if you self-host Baserow |

Redeploy after adding variables so the function picks them up.

### Why set a passcode

Without one, anyone who finds your site URL can mark films seen or edit your notes. With `APP_PASSCODE` set, the app asks for it once per browser and the function rejects requests without it.

## 3. Run it locally

```bash
cp .env.example .env    # fill in your values
netlify dev
```

If you open `public/index.html` directly or Baserow isn't configured, the app runs in **preview mode** with the bundled list. Everything works, but changes are lost when you reload.

## Using it

- **Mood chips** filter the list; click the active one again to clear it. Search also matches cast, genre and companion.
- **Circle** on each row marks a film seen (dated today). Marking seen also takes it off watch next.
- **Click a title** for cast, ratings, the trivia note, and your log: date seen, who you watched with, and your take. Notes save with **Save notes** or when you close the panel.
- **Watch next** tab: drag to reorder on desktop, or use the arrows anywhere.

## Adding or fixing films

Add or edit rows directly in Baserow and reload the app. Known gaps in the current list: the 2025 ceremony is missing *Wicked*, and 2026 only has *One Battle After Another* (cast listed as TBD) out of its ten nominees.

## Renaming columns

If you rename columns in Baserow, update the `FIELD` map at the top of `netlify/functions/movies.mjs` to match.
