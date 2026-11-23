# Continuing work on Velox 1.3.0

A note for picking this up on another computer. The code is in git, so the history
is in `git log`. This file covers the setup, what's done, and what still needs a TV.

## Where things stand

- **Version:** 1.3.0 in `app/js/config.js` and `app/config.xml`. GitHub's latest
  release is 1.2.0, and 1.3.0 isn't released yet.
- **Git:**
  - This is a local repository: everything is committed on `main`, with no remote.
  - The first commit is a plain copy of github.com/SuperDOS/velox.
  - To compare with or push to GitHub:

    ```sh
    git remote add origin https://github.com/SuperDOS/velox.git
    git fetch origin
    ```

    First check whether GitHub moved on after 1.2.0 (`git log origin/main`).
- **Everything was built and checked in a desktop browser, not on the TV.** The list
  further down says what still needs the TV.

## What 1.3.0 adds

The README's "What it does" section covers all of it.

- **Home:** featured carousel, Explore (Plex Discover), and a choice of where the app
  starts.
- **Search:** actors and directors.
- **Libraries:**
  - filters (unwatched, in progress, title, studio, and the others Plex offers)
  - list view
  - columns and spacing
- **Detail pages:**
  - versions (pick which file to play)
  - File info
  - hidden spoilers
  - Fix match with posters, summaries and Search again
- **Playback:**
  - Fit or Stretch
  - audio channel limit (Original, 5.1 or Stereo)
  - sleep timer
  - skip intro and credits: button, automatic or off
  - intro and credits found from chapter names, with editable patterns
- **Look:**
  - themes, plus a custom theme with a colour picker made for the remote
  - Interface size
  - Focus style (Border, Spotlight or Magnify) and Focus animation on or off
  - episode artwork, episode numbers, cast photo shape, watched badges and unwatched
    counts
- **Settings:** grouped by section, with headings.
- **Plex Home:** switch user, with a PIN when the user has one.

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

## Still to check on the TV

These couldn't be checked in a browser.

- **Interface size below 100%:** the whole app is zoomed on the TV; check it stays
  smooth and sharp.
- **Focus styles:**
  - Spotlight and Magnify keep each tile on its own graphics layer, which fixed a
    blink but uses more memory. Watch for sluggishness in big library grids.
  - Focus animation off is the fallback.
- **Display → Stretch** (AVPlay display mode).
- **Playing a chosen version** of a movie or episode with several files.
- **Audio channels → Stereo:** listen for real downmixed sound. The server's decision
  was checked (5.1 AC3 becomes stereo AAC).
- **Sleep timer:**
  - the 30-second card running out during real playback
  - "end of this video" during autoplay
- **Chapter-name markers** (intro and credits from chapter names) during real playback.
- **Typing on the TV:** library Title filter, Fix match → Search again, the Plex Home
  PIN.
- **Plex Home user switching end to end:** it needs a Plex Home with more than one
  user; the Account → User row only appears then.
- **Startup logo:** at a smaller Interface size it should be centred and full size.

## Open ideas

- Screenshots of the new features for the README and the 1.3.0 release notes:
  carousel, Explore, themes, focus styles, Fix match.
- Release 1.3.0:
  1. Build `velox.wgt` (README → Install, step 3).
  2. Tag it and publish a GitHub release.
