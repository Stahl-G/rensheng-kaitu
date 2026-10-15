# Kaitu project website

Public project website at https://kaitu.si/, served by GitHub Pages from the `gh-pages` branch root.

The website reuses Kaitu's existing `docs/design/kaitu-mark.svg`, the light-theme `--kt-*` tokens from
`packages/dsh-plugin/src/client/OverviewPage.module.css`, and the five original `docs/design/*.dc.html` designs.
The public previews contain synthetic examples only and disable the original application controls.

Edit `index.html`, `style.css`, `tokens.css`, and `app.js` directly. No build system or external font/CDN is required.
Run `python3 -m http.server 4894 --bind 127.0.0.1` from this directory to preview.

To refresh original design previews from an application checkout:

```sh
python3 tools/render-designs.py /path/to/rensheng-kaitu
```

Review all five previews and update `design-source.json` with the source commit before publishing.
Commit and push to `gh-pages`; GitHub Pages deploys the branch. Keep `CNAME` set to `kaitu.si`.
