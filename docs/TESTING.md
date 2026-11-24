# Testing on the TV

Everything below was built after Velox 1.3.1 and checked in the desktop browser
(Chrome on Windows, `docs/CONTINUING.md` → "Run the app in a desktop browser"), not yet
on a TV. Build a test package (README → Install, step 3) and work through it on the
real hardware. Tick a box when it works; note what happened when it doesn't.

Good titles to use, from the ANTHFLIX server:
- **Dexter: Resurrection, S2 · E2 "Fallen":** MKV with a built-in English SRT, an
  intro marker and 15 chapters.
- **Inception:** chapters, Rotten Tomatoes reviews, Common Sense Media, Plex user reviews.
- **30 Rock:** has a Specials season.
- **A film split over several files** (stacked, "cd1/cd2"): needed for one test; add
  one if the library has none.
- **A file with DTS audio and a built-in SRT:** Plex converts the audio, so the
  subtitle has to come as text.

Before you start: Settings → Account → **Reset all settings** is there if a test leaves
things in a strange state (sign-in and pinned items stay).

---

## 1. Playback

### Movies in several files
- [ ] Play a stacked film from the start: it goes on into part 2 by itself, without
      stopping or showing Up next.
- [ ] Seek (◀ ▶ held) from part 1 into part 2: it lands at the right time in part 2.
- [ ] Stop in part 2, play again: it resumes in part 2 at the same place.
- [ ] Scrub thumbnails show the right pictures in both parts.

### Seek bar: chapters and markers
- [ ] Dexter "Fallen": small marks along the bar for the chapters, and a lighter stretch
      near the start labelled **Intro**.
- [ ] Hold ◀ or ▶: the label above the knob reads **time · chapter** ("12:40 · Scene 5").
- [ ] Seek near the very start and very end: the label stays on screen (left-aligned at
      the start, right-aligned at the end).
- [ ] CH ▲ / CH ▼ and the Chapters button also show **time · chapter**.
- [ ] Settings → Playback → Skip intro **Off**: the Intro stretch is gone from the bar.

### Skipping
- [ ] An episode with an intro marker: **Skip Intro** appears; OK skips it.
- [ ] Settings → Playback → Skip recaps / Skip ads: on a recording with commercial
      markers (or a show with recap markers), **Skip Recap** / **Skip Ad** appear and
      work. Ads show as an amber stretch on the bar.
- [ ] **IntroDB** (Settings → Playback → *Fill in from IntroDB* → On): play an episode
      Plex has no intro marker for, of a show IntroDB knows (e.g. Arrested
      Development). A Skip Intro button appears. *The desktop browser can't reach
      IntroDB (CORS), so this is untested anywhere.* If nothing appears, check
      `build/tv.log` for `IntroDB lookup failed`.

### Subtitles built into the file
- [ ] Dexter "Fallen" with English (SRT) on: plays directly (Options → Playback info
      says direct play) and the subtitles show. Scrub back and forth: no
      "Playback failed".
- [ ] A file with **DTS audio + built-in SRT**: Plex converts the audio; Playback info
      shows the **video copied**, not converted, and the subtitles show as text in the
      app's style (Options → subtitle size/colour changes them).
- [ ] Same file: seek several times quickly. Subtitles keep up; no "Playback failed".
      (In the desktop browser, scrubbing Dexter straight away can still fail; that's
      the browser's player.)
- [ ] A file with picture subtitles (PGS): still works (they're burned in, as before).

### Stopped from the server
- [x] Play something, then in Plex Web → Dashboard → Now Playing, stop it with a
      message. The TV stops and shows a **Playback stopped** card: *(name) stopped
      this video.*, your message in quotes, and *OK or Back to go back*. ◀ ▶ don't
      start it again; OK, Back or Stop leave the player.

### "Still watching?" after episodes
- [ ] Settings → Playback → *Still watching? by episodes* → 2. Play an episode, let it
      autoplay into the next without touching the remote: after the 2nd autoplay, Up
      next asks *Still watching?* instead of counting down.
- [ ] Press any key during an episode: the count starts over.

### Poster and summary with the controls
- [ ] Settings → Playback → While watching → *Summary with the controls* **When
      paused**, *Poster* **On**. Pause: poster, title, episode line and summary show.
      Play: summary and poster go, title stays.
- [ ] *Whenever the controls show*: summary and poster show whenever the controls are up.
- [ ] With *Hide summaries of unwatched episodes* **On**: an episode you haven't
      finished before shows no summary; a rewatched one and movies do.
- [ ] On a bright scene, the title, episode line and summary are easy to read.

### Letterboxing
- [ ] A 4:3 or 576p file (Dexter "Fallen" is 576p): black bars, nothing grey.

---

## 2. Home and the top bar

### Pinned (collections and playlists in the top bar)
- [ ] Hold OK on a collection (Library → ▲ → Collections) → **Pin in the top bar**:
      it appears in Home's top bar next to the libraries.
- [ ] Pin several: as many as fit before the clock sit in the bar; the rest go into
      **Pinned ▾**, which opens a list of all of them (scrolls when long).
- [ ] Settings → Appearance → Interface size **Large** vs **Smallest**: fewer or more
      fit before the clock.
- [ ] A very long playlist name is only cut ("…") when it can't fit; letters like g,
      y and p aren't cut off at the bottom.
- [ ] Settings → Home → Top bar → *Pinned* **All in one list**: only **Pinned ▾**
      shows.
- [ ] OK on a pinned collection opens it as a grid; on a pinned playlist, the playlist
      page.

### Top bar order
- [ ] Settings → Home → Top bar → *Top bar*: move TV Shows above Movies (◀), hide
      Explore (OK). Home shows the new order and no Explore icon.
- [ ] Settings can't be hidden; Home is always first.
- [ ] *Back to the usual order, all shown* puts it back.
- [ ] With a few things pinned: under **Pinned**, each one has its own line, indented
      and joined by a line on the left. ◀ ▶ move it among the pinned ones (not past
      them); Home's bar and the **Pinned ▾** list follow the new order.
- [ ] OK on a pinned line unpins it; it leaves the list and the bar.
- [ ] Home's bar has a thin divider on each side of the pinned names, so they don't
      read as libraries.

### Rows on Home
- [ ] Settings → Home → Rows → *Rows on Home*: every playlist and collection is
      listed (with a closed eye). OK on one makes it a Home row; it appears after
      Continue Watching.
- [ ] Hide a Plex row (e.g. Recently Added Movies) and move another: Home follows,
      and still does after restarting the app.
- [ ] Focus an item in a playlist or collection row: the panel at the top shows its
      year, rating, length, scores and **summary**, like Plex's own rows.

### Collections and Playlists icons
- [ ] With at least one playlist: a **Playlists** icon in the top bar; with none, no icon.
- [ ] With at least one collection: a **Collections** icon; with one library having
      collections it opens that grid, with several a row per library.
- [ ] Playlist posters are poster-shaped mosaics and have no "watched" tick.

### Two Plex Home users
- [ ] Pin something and reorder the top bar as user A. Switch to user B (Settings →
      Account → User): B has their own top bar, rows and pinned items. Switch back:
      A's are as they were.
- [ ] Settings → Account → *Reset top bar and Home rows* resets only the current user.

### Search
- [ ] Open something from search, then go back to search with the box empty:
      **Recently searched** shows it (titles and people in separate rows).
- [ ] Another Home user sees their own recent searches, not yours.

---

## 3. Playlists and collections

### Playlists
- [ ] Hold OK on a movie, episode or show → **Add to playlist…** → *New playlist…*,
      type a name: the playlist is made with that item in it.
- [ ] Add more items to it; adding the same item twice doesn't duplicate it.
- [ ] A title's page → **Add to…** → *Playlist…* does the same.
- [ ] Playlist page: ▲ from the top row reaches **Play / Shuffle / Pin**. Pin opens
      its menu just under the button, and the button says **Pinned** at once.
- [ ] Hold OK on an item in a playlist → **Remove from playlist**: it's gone, the
      count updates. *Play playlist from here* plays from that item on.

### Collections (as the server's admin)
- [ ] Hold OK on a movie or show → **Add to collection…** → *New collection…*: made,
      with that title in it. On an episode it says **Add show to collection…**.
- [ ] Inside a collection, hold OK → **Remove from collection**.
- [ ] Hold OK on a collection → **Rename collection…** (a name already in use says
      *That name is taken*) and **Delete collection…** (asks first, *Keep it*
      focused). A pinned collection follows the rename and goes away with the delete.
- [ ] As a non-admin Home user: none of the collection editing shows.

### Smart collections (as admin)
- [ ] Library → ▲ → Collections → **New smart collection**: add *Genre is Comedy* and
      *Unwatched is true*, Limit 20, **Create collection** with a name. The count at
      the top updates as you go ("556 movies match, the first 20 kept").
- [ ] Add a group (*Any of*: Year greater than 2020 / Year less than 1990): the count
      changes; save. The collection holds the right titles.
- [ ] Hold OK on it → **Edit rules…**: the rules read back by name ("Genre is Comedy").
- [ ] An Actor rule: typing a few letters lists matching actors.
- [ ] Back with unsaved changes asks *Leave without saving?*.
- [ ] The same collection looks right in Plex Web (its advanced filters show the rules).

---

## 4. Title pages

- [ ] Show page: **Specials** come after the last season (30 Rock).
- [ ] Movie page: **Common Sense Media: age 14+ · …** under the genres (Inception).
- [ ] **Ratings & Reviews** row under Cast & Crew: Plex users' reviews (avatar, name,
      how long ago, stars), then Rotten Tomatoes critics (fresh/rotten mark,
      publication). OK opens a review in full; a review marked as a spoiler waits for OK.
- [ ] Settings → Appearance → Title pages → *Ratings & Reviews row*: Plex users only,
      critics only, Off — each does what it says.
- [ ] **Add to…** button: Playlist… and (admin) Collection…, opening just under the button.

---

## 5. Settings

- [ ] Each section holds what it says: Appearance (size, clock, focus, posters, title
      pages), Home (start, top bar, carousel, rows, pressing OK, the TV's home bar),
      Library (layout), Playback (quality, picture and sound, while watching, jumping,
      skipping, markers, up next).
- [ ] Settings → Account → **Reset all settings**: everything back to defaults, the app
      restarts, still signed in, pinned items and playlists still there.

---

## 6. Older items still to check on the TV

From before this round (see `docs/CONTINUING.md`):
- [ ] Switching to a second Plex Home user, with and without a PIN.
- [ ] The sleep timer running out: the 30 s card, then playback stops.
- [ ] Audio channels **5.1** and **Stereo** on a 7.1 / DTS file: the sound comes out
      right on the TV's speakers or soundbar.

---

## Afterwards

Write down what failed in `docs/CONTINUING.md` under "Checked on the TV", fix it, then
build the release: README → Install, step 3, tag it and publish it on GitHub.
