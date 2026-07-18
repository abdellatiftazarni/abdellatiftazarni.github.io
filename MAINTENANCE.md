# Maintenance Notes

Personal notes for maintaining this site. Not part of the Fuwari theme docs.

## Repo & deployment

- **Local repo root:** `/home/tazarni/Documents/my-website/fuwari`
  (the parent `my-website/` folder has unrelated files — CV, certs, etc. — not part of this repo)
- **Remote:** `git@github.com:abdellatiftazarni/abdellatiftazarni.github.io.git` (SSH)
- **Live site:** https://abdellatiftazarni.github.io
- **Deploy is automatic:** any push to `main` triggers `.github/workflows/deploy.yml`,
  which builds the site and publishes it. No manual steps needed. Takes ~1-2 minutes.
- **Pages source:** repo Settings → Pages → Source is set to "GitHub Actions" (already
  configured, shouldn't need to touch it again).
- Two other workflows run on every push but do **not** block deployment:
  - `build.yml` — `astro check` + build sanity check (currently has some pre-existing
    type errors, cosmetic red X only)
  - `biome.yml` — lint check

## SSH access

- Key: `~/.ssh/id_ed25519`, already added to the `abdellatiftazarni` GitHub account.
- Test with: `ssh -T git@github.com`

## Adding a new writeup

1. Scaffold the post:
   ```sh
   pnpm run new-post -- <slug>.md
   ```
   This creates `src/content/posts/<slug>.md` with a frontmatter template.

2. Fill in frontmatter:
   ```yaml
   ---
   title: "..."
   published: YYYY-MM-DD
   description: "..."
   image: "/assets/images/writeups/<slug>/cover.png"
   tags: [Tag1, Tag2]
   category: Writeups
   draft: false   # set true to hide from the site until ready
   ---
   ```

3. Put images in `public/assets/images/writeups/<slug>/`:
   - `cover.png` — used as the post card thumbnail, the banner on the post page, and
     the social/OG preview image
   - `image-1.png`, `image-2.png`, ... — in-body screenshots, referenced with normal
     markdown `![]()` pointing at that folder

4. Write the writeup body in Markdown below the frontmatter.

5. Commit and push to `main` — it deploys automatically.

## Changing a cover/image on an existing post

- Just overwrite the file in `public/assets/images/writeups/<slug>/`, commit, push.
- If the live site still shows the old image after deploying, it's almost always
  **browser cache**, not a bad deploy — hard refresh (Ctrl+Shift+R) or check in a
  private window before assuming something's wrong.

## Site-wide config (not per-post)

- `src/config.ts` — site title/subtitle, theme color, nav bar, banner, license, etc.
  Only touch this for global changes, not individual posts.

## Local dev / testing before pushing

```sh
pnpm dev      # local dev server
pnpm build    # production build (same as CI runs) to sanity-check before pushing
```

## If a GitHub Actions workflow breaks

- Check the **Actions** tab on GitHub, click the failed run, expand the job, read the
  "Annotations" section at the bottom — usually points straight at the error.
- If an action fails with something like "unable to resolve action" or "shortened SHA
  not supported," a `uses:` pin in the workflow YAML is malformed/stale — replace it
  with the plain version tag (e.g. `actions/checkout@v7`) rather than hunting for the
  exact commit SHA.
