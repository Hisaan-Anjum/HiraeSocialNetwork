# Story music — sources and licences

Checked: 2026-11-12.

All six tracks are **original works synthesised from code** by `music/synth.py` in this repository
(numpy oscillators, Karplus-Strong strings, FM bells, filtered noise; no samples, loops, presets,
recordings or other third-party audio of any kind). Herae owns them outright; nobody else holds any
right in them, so there is no licence to comply with, no attribution to give and no royalty to pay.
Anyone can regenerate the exact files with `python3 music/synth.py`.

Why not a library: FreePD.com (CC0), the first-choice source, announced on 2026-11-12 that it has
taken the service offline, and every other "free" library checked carries attribution or
platform-specific terms. Owning the music removes the question entirely.

| Story type      | File                  | Title           | Mood                                   | Loop     | Source            | Licence                         |
|-----------------|-----------------------|-----------------|----------------------------------------|----------|-------------------|---------------------------------|
| monthly         | little-evenings.mp3   | Little Evenings | warm lo-fi keys, brushed beat, 84 BPM  | 45.71 s  | music/synth.py    | Original work, owned by Herae   |
| anniversary     | golden-years.mp3      | Golden Years    | cinematic piano + strings, 66 BPM      | 43.64 s  | music/synth.py    | Original work, owned by Herae   |
| milestone       | marathon.mp3          | Marathon        | bright strums, claps, bell hook, 112   | 34.29 s  | music/synth.py    | Original work, owned by Herae   |
| holiday         | snowlight.mp3         | Snowlight       | music-box waltz, celesta, pad, 3/4     | 36.00 s  | music/synth.py    | Original work, owned by Herae   |
| important_date  | keepsake.mp3          | Keepsake        | tender harp + felt piano, A minor      | 37.89 s  | music/synth.py    | Original work, owned by Herae   |
| custom          | our-story.mp3         | Our Story       | piano ostinato that builds, 92 BPM     | 41.74 s  | music/synth.py    | Original work, owned by Herae   |

Format: MP3 128 kbps stereo, 44.1 kHz, ~0.55–0.73 MB each. Each file is the loop plus 0.5 s of its
own end before it and 0.5 s of its start after it; the player loops [0.5 s, 0.5 s + loop], which is
seamless (see `src/memories/music.js`).
