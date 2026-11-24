# Continuing work on Velox 1.3.0

A note for picking this up on another computer. The code is in git, so the history
is in `git log`. This file covers the setup, what's done, and what still needs a TV.

## Where things stand

- **Version:** 1.3.0 in `app/js/config.js` and `app/config.xml`. GitHub's latest
  release is 1.2.0, and 1.3.0 isn't released yet.
- **Git:** `main` is pushed to github.com/SuperDOS/velox (`origin`), on top of the
  1.2.0 release. The 1.3.0 work was done on another computer as a plain copy, then
  replayed onto GitHub's history.
- **Checked on the TV:** everything in the list that used to be here, on a 2021 Frame
  (Tizen 6.0) with a dev build. See "Checked on the TV" below for what was found.

## What 1.3.0 adds

The README's "What it does" section covers all of it.

- **Home:**
  - featured carousel, with a choice of what it shows (random, top rated, theme of the
    day, Surprise me and more)
  - rows keep focus in the middle; View all at the end of long rows
  - Explore (Plex Discover), and a choice of where the app starts
- **Search:** actors and directors.
- **Libraries:**
  - filters (unwatched, in progress, title, studio, and the others Plex offers)
  - list view
  - columns and spacing
- **Detail pages:**
  - versions (pick which file to play)
  - File info
  - hidden spoilers
  - Fix match with posters, summaries and Search again, laid out like Home
  - a film's Oscars, and rating logos in colour or grey
- **Playback:**
  - Fit or Stretch
  - audio channel limit (Original, 5.1 or Stereo)
  - sleep timer
  - skip intro and credits: button, automatic or off
  - intro and credits found from chapter names, with editable patterns
- **Look:**
  - themes, plus a custom theme with a colour picker made for the remote
  - Interface size
  - Focus style (Border, Spotlight, Magnify or Pop), Focus animation and Border glow on
    or off; list view follows the style
  - clock on Home only, or on detail pages too
  - episode artwork, episode numbers, cast photo shape, watched badges and unwatched
    counts
- **Settings:** grouped by section, with headings.
- **Plex Home:** switch user, with a PIN when the user has one (number keyboard);
  optional Who's watching? at start; non-admin users can't sign out, change server or
  fix matches.

## Set up the new computer

You need:
- Node.js 18 or newer
- Python 3 (`python3 -m http.server`; Pillow too if you want `tools/browser/sheet.py`)
- Chrome

Build and install on the TV exactly as in the README's Install section.

### Run the app in a desktop browser

The app runs straight from `app/` in Chrome, with no build step.

1. **Serve the folder:**

   ```sh
   cd app && python3 -m http.server 8080 --bind 0.0.0.0
   ```

2. **Start a Chrome you can control from scripts** (Windows example; any Chrome works):

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=%LOCALAPPDATA%\chrome-cdp
   ```

3. **Open the app:** go to `http://localhost:8080/index.html` in that Chrome.
4. **Sign in:** enter the code at plex.tv/link. Sign-in and settings live in that
   browser profile, so a new computer has to sign in again.
5. **Use the keyboard as the remote:**
   - Arrow keys move.
   - Enter is OK.
   - Escape or Backspace is Back.

The window is scaled to fit; a 16:9 window (F11) looks most like the TV.

### Drive it from scripts (`tools/browser/`)

- **`cdp.mjs`** talks to that Chrome:
  - `open <url>` opens the app at 1920×1080.
  - `shot <file.png>` takes a screenshot.
  - `eval '<js>'` runs JavaScript in the page.
  - `keys ArrowDown,Enter,...` sends key presses.

  `CDP_PORT` picks the port. Under WSL, run it with Windows `node.exe`: the
  debugging port is only reachable from Windows.
- **Background tabs don't animate:** Chrome throttles a tab that's in the background
  or minimised. Its timers slow to about once a second and transitions don't run, so
  `keys` waits about a second between presses. To see animations, use a headless
  Chrome, which always draws frames:

  ```
  chrome.exe --headless=new --remote-debugging-port=9333 --user-data-dir=C:\Temp\velox-headless about:blank
  ```

  Then copy the app's `ss.*` localStorage keys from the signed-in tab, skipping
  `ss.homeCache`, which is too big to pass. With those in place:
  - `rec.mjs` records frames while pressing keys.
  - `sheet.py` lays them out on one image.

  The copied keys include your Plex token, so delete the copy afterwards.
- **Don't play anything by accident:**
  - Check what has focus before sending Enter.
  - Trailers (Extras) play from Plex's CDN and don't touch watch history.
- **Changing settings while testing:**
  - The app reads settings through `import('/js/util/prefs.js')` and saves them in
    localStorage as `ss.pref:<name>`.
  - Change one with `setPref(name, value)`; `setPref(name, undefined)` restores the
    default.
  - Note what a setting was before changing it, so you can put it back.
- **Before committing:** check the bundle still builds for the TV's Chrome 76:

  ```sh
  cd app && npx esbuild@0.24.0 js/main.js --bundle --format=iife --target=chrome76 --outfile=/tmp/velox-check.js
  ```

  Tizen 6.0's Chrome 76 doesn't support `:has()`, `aspect-ratio`, `gap` on flex,
  `inset`, or large `filter: blur()` layers.

## Checked on the TV

All checked on the TV in November 2026, with fixes where something was wrong:

- **Interface size below 100%:** the TV's browser shrinks any page wider than the
  screen by itself, and the app read that as its window size. `fitWindow()` now uses the
  TV's fixed 1920×1080. Smaller sizes run as fast as 100%.
- **Focus styles:** Magnify was down to about 10 fps in grids. Its veils (one graphics
  layer per tile) and the neighbours growing were the cost; now the veil is drawn into the
  poster's layer and only the focused poster grows in grids (about 40 fps). Pop is as
  cheap as Border.
- **Anything wider than the screen shrinks the whole page:** overlays (Fix match, menus)
  now clip to the screen, and dev builds log `page shrunk to …` with what sticks out.
- **Display, versions, Stereo, sleep timer, chapter markers, typing, Plex Home,
  startup logo:** all work. Backspace on the TV's keyboard used to leave a text box; it
  now deletes.
- **Embedded text subtitles** (SRT inside an MKV) used to be burned in when Plex
  converts the file, so the server re-encoded the video. Now the transcode asks for
  the subtitle as text (`textSubtitles` in `transcodeUrl`) and the player reads it from
  `/video/:/transcode/universal/subtitles`: one ASS response held open for the
  whole playback, which advances only as video segments are fetched. The video
  is copied. `/library/streams/<id>` answers 501 for embedded tracks. Checked
  against the server from the browser; not yet watched on the TV.

## Testing on the TV without seeing it

A dev build talks to `tools/devserver.mjs` on the computer (port 8790; the TV's
Developer Mode host IP must be the computer's). `tools/tveval.sh '<js>'` runs code on
the TV, `curl 'localhost:8790/send?keys=down,enter'` presses keys, and `__bench([...])`
measures frame rates while it does. Set `__ss.muteTimeline = true` before starting
playback in a test so it doesn't touch watch history.

## Open ideas

- Screenshots of the new features for the README and the 1.3.0 release notes:
  carousel, Explore, themes, focus styles, Fix match, Who's watching?.
- BAFTAs and Golden Globes: plex.tv only lists Oscars, and Wikidata misses most of
  them (it files acting awards under the actors).
- Release 1.3.0:
  1. Build `velox.wgt` (README → Install, step 3).
  2. Tag it and publish a GitHub release.
