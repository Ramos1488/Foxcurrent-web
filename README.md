# Foxurrent.

Public site for the **Foxurrent.** Roblox studio — projects, dev blog, news, contributors, live chat.

**Stack:** static HTML / CSS / JS · [Vercel](https://vercel.com) · [Supabase](https://supabase.com) (shared data)

## Features

- Projects with live Roblox metadata
- Dev Blog & Game News (images, clickable links)
- Contributors by department (Leadership, Developers, Designers, …)
- Live chat (shared via Supabase)
- Maintenance mode (admin toggle)
- EN / RU
- Discord notifications on GitHub push

## Deploy

1. Fork or clone this repo  
2. Create a free [Supabase](https://supabase.com) project  
3. **SQL Editor** → run `supabase-schema.sql`  
4. Put your Project URL + `anon` key into `js/config.js`  
5. Import the repo on [Vercel](https://vercel.com) → Framework: **Other** → Deploy  

In the header, badge **Online** means data is loaded from Supabase.

## Discord webhook (commits → Discord)

1. Discord channel → **Integrations → Webhooks → New Webhook** → Copy URL  
2. GitHub repo → **Settings → Secrets and variables → Actions**  
3. **New repository secret**  
   - Name: `DISCORD_WEBHOOK` (exactly this name)  
   - Value: the webhook URL (`https://discord.com/api/webhooks/...`)  
4. Push to `main` or `master`, or run the workflow manually under **Actions**  

### If webhook “does nothing”

| Check | What to do |
|--------|------------|
| Secret name | Must be `DISCORD_WEBHOOK` |
| Secret value | Full URL, no quotes/spaces |
| Workflow file | Must be on default branch: `.github/workflows/discord-commits.yml` |
| Actions enabled | Repo **Settings → Actions → Allow** |
| Workflow run | **Actions** tab → open run → read logs |
| Channel | Webhook must still exist (not deleted) |

## Admin

Use the **Admin** button on the site (password is set via SHA-256 hash in `js/app.js`).  
After login you can manage content, toggle maintenance, and moderate chat.

## License

Content © Foxurrent. Site code provided as-is for the studio deployment.
