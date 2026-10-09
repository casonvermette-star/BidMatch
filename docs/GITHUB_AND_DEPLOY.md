# GitHub, GitHub Pages, and Live Demo

## 1. Put the code on GitHub

From the `bidmatch-ai-v6` folder:

```bash
git init
git add .
git commit -m "BidMatch AI V8 production-foundation release"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

Before pushing, verify `.env`, `data/auth.json`, uploads, and backups are not staged.

```bash
git status
```

## 2. Turn on GitHub Pages

GitHub Pages should point at `/docs`. It hosts the project showcase only. It cannot execute `server.mjs`.

Use the GitHub Pages URL as a portfolio link even before the live application is deployed.

## 3. Deploy the interactive application

The app needs a Node server. A Dockerfile and `render.yaml` are included as deployment starters. When deploying publicly:

- set `APP_ENV=production`
- keep `REQUIRE_LOGIN=true`
- keep secrets in the host's environment-variable dashboard
- set `SECURE_COOKIES=true`
- use a cloud database/storage provider before putting real client data in the product
- do not publish demo/admin credentials

## 4. LinkedIn

LinkedIn does not host the Node application. Add the project under Projects or make a post and link to:

- GitHub repository
- GitHub Pages portfolio
- live deployment (when available)

Use `../LINKEDIN_PROJECT.md` as the starting copy.
