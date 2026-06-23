# Marketing assets

Sales-grade collateral generated from the live dashboard.

- **`disco-tour.mp4`** — an ~11s sizzle reel that walks a prospect through the product story:
  **snapshot** (Library) → **rebrand & build** (Build console) → **deliver** (branded handover page)
  → **the system running** (Activity feed), with crossfades on the ink palette. 1280×720, ~450 KB,
  loops cleanly. Drop it on the landing page hero or send it ahead of a demo call.

Regenerate it with [`make-tour.sh`](make-tour.sh) after recapturing the four dashboard frames into
`docs/screenshots/` (requires `ffmpeg`):

```bash
docs/marketing/make-tour.sh
```

> Playwright isn't installed on this box, so a true motion screen-capture (the build progressing at
> 8× speed) isn't generated here — the reel is a crossfaded tour of the real screens. Once Playwright
> is available, swap in a recorded `.webm`/`.mp4` of an end-to-end build and re-run the same xfade
> chain to produce the final cut.
