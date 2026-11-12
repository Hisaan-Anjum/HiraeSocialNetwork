#!/usr/bin/env python3
"""Synthesises the story soundtracks (music/*.mp3) from nothing but numpy maths.

Every note is generated here, so Herae owns the music outright: no samples, no third-party
recordings, no licence to check (see LICENSES.md). Re-run to regenerate:

    python3 music/synth.py               # needs numpy, scipy, imageio-ffmpeg

Each track is rendered as an exact loop: whatever rings past the loop end (reverb, release
tails) is folded back onto its start, so the signal is periodic. The file then carries
PAD seconds of the loop's end before it and PAD seconds of its start after it, which makes
ANY window of LOOP seconds inside the file a seamless loop, whatever padding the mp3 decoder
adds. The player loops [PAD, PAD + loop] (see src/memories/music.js, STORY_MUSIC).
"""
import json, os, subprocess, sys, tempfile
import numpy as np
from scipy.signal import butter, sosfilt, lfilter, fftconvolve

SR = 44100
PAD = 0.5
HERE = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(7)

NOTE = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
        'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
QUAL = {'': [0, 4, 7], 'm': [0, 3, 7], 'maj7': [0, 4, 7, 11], 'm7': [0, 3, 7, 10], '7': [0, 4, 7, 10],
        'add9': [0, 4, 7, 14], 'm9': [0, 3, 7, 10, 14], '9': [0, 4, 7, 10, 14], 'sus4': [0, 5, 7], 'sus2': [0, 2, 7]}


def chord(name):
    """'F#m7' -> (root pitch class, intervals)."""
    root = name[:2] if len(name) > 1 and name[1] in '#b' else name[:1]
    return NOTE[root], QUAL[name[len(root):]]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def lp(x, f, order=2):
    return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)


def bp(x, lo, hi):
    return sosfilt(butter(2, [lo, hi], 'band', fs=SR, output='sos'), x)


def env(n, a, r, total):
    """Linear attack a s, hold, linear release r s, over n samples ending at total s."""
    t = np.arange(n) / SR
    e = np.minimum(1.0, t / max(a, 1e-4))
    rel_start = max(total - r, 0)
    e *= np.clip(1 - (t - rel_start) / max(r, 1e-4), 0, 1)
    return e


# ── instruments: each returns a mono numpy array starting at the note's onset ──

def piano(m, dur, vel=0.7, bright=1.0):
    """Felt-ish piano: inharmonic partials, two slightly detuned strings, soft hammer."""
    f0 = hz(m); ring = min(dur + 1.2, 6.0); n = int(ring * SR); t = np.arange(n) / SR
    out = np.zeros(n); B = 0.00035
    for k in range(1, 11):
        fk = k * f0 * np.sqrt(1 + B * k * k)
        if fk > 9000: break
        amp = (1 / k ** 1.25) * np.exp(-0.18 * k / bright)
        tau = 2.8 / (1 + 0.35 * k) * (440 / max(f0, 110)) ** 0.35
        for det in (-0.9, 0.9):
            out += 0.5 * amp * np.sin(2 * np.pi * fk * (1 + det / 1730) * t + k) * np.exp(-t / tau)
    out *= np.minimum(1, t / 0.004)
    out *= np.clip(1 - (t - dur) / 0.35, 0, 1)            # damper
    hammer = lp(rng.standard_normal(int(0.012 * SR)), 2500) * np.exp(-np.arange(int(0.012 * SR)) / (0.003 * SR))
    out[:len(hammer)] += 0.08 * hammer
    return vel * out


def epiano(m, dur, vel=0.6):
    """Rhodes-like tine: near-sine body plus a quickly decaying bell partial, soft tremolo."""
    f0 = hz(m); ring = min(dur + 0.8, 5.0); n = int(ring * SR); t = np.arange(n) / SR
    body = np.sin(2 * np.pi * f0 * t + 0.6 * np.sin(2 * np.pi * f0 * t) * np.exp(-t / 0.25))
    body += 0.25 * np.sin(2 * np.pi * 2 * f0 * t) * np.exp(-t / 0.6)
    tine = 0.18 * np.sin(2 * np.pi * 7.1 * f0 * t) * np.exp(-t / 0.05) if 7.1 * f0 < 15000 else 0
    out = (body * np.exp(-t / 2.2) + tine) * (1 + 0.08 * np.sin(2 * np.pi * 4.6 * t))
    out *= np.minimum(1, t / 0.003) * np.clip(1 - (t - dur) / 0.3, 0, 1)
    return vel * out


def pad(m, dur, vel=0.25, cutoff=1600):
    """Warm string/synth pad: three detuned band-limited saws, slow swell, low-passed."""
    f0 = hz(m); ring = dur + 1.6; n = int(ring * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for det in (-6, 0, 6):
        f = f0 * 2 ** (det / 1200); ph = rng.uniform(0, 6.28)
        for k in range(1, 30):
            if k * f > cutoff * 2.5: break
            out += np.sin(2 * np.pi * k * f * t + k * ph) / k
    out = lp(out, cutoff)
    out *= env(n, 0.9, 1.4, ring)
    return vel * out / 3


def pluck(m, dur, vel=0.6, bright=0.5, decay=0.996):
    """Karplus-Strong string (guitar / harp)."""
    f0 = hz(m); N = int(round(SR / f0)); ring = min(dur + 1.0, 4.0); n = int(ring * SR)
    burst = lp(rng.uniform(-1, 1, N), 1500 + 6000 * bright)
    x = np.zeros(n); x[:N] = burst
    a = np.zeros(N + 2); a[0] = 1; a[N] = -decay / 2; a[N + 1] = -decay / 2
    y = lfilter([1.0], a, x)
    y *= np.clip(1 - (np.arange(n) / SR - dur) / 0.25, 0, 1)
    return vel * y / (np.max(np.abs(y)) + 1e-9)


def bell(m, dur, vel=0.4, ratio=3.5, index=2.2, tau=1.6):
    """FM bell / celesta / music box."""
    f0 = hz(m); ring = max(dur, tau * 2.5); n = int(ring * SR); t = np.arange(n) / SR
    I = index * np.exp(-t / (tau * 0.4))
    out = np.sin(2 * np.pi * f0 * t + I * np.sin(2 * np.pi * f0 * ratio * t))
    out *= np.exp(-t / tau) * np.minimum(1, t / 0.002)
    return vel * out


def bass(m, dur, vel=0.6):
    f0 = hz(m); ring = dur + 0.15; n = int(ring * SR); t = np.arange(n) / SR
    out = np.sin(2 * np.pi * f0 * t) + 0.25 * np.sin(4 * np.pi * f0 * t) + 0.08 * np.sin(6 * np.pi * f0 * t)
    out *= (0.6 + 0.4 * np.exp(-t / 0.4)) * env(n, 0.008, 0.12, ring)
    return vel * out


def kick(vel=0.8):
    n = int(0.45 * SR); t = np.arange(n) / SR
    f = 45 + 75 * np.exp(-t / 0.035)
    return vel * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)


def snare(vel=0.4, brush=False):
    n = int(0.3 * SR); t = np.arange(n) / SR
    noise = bp(rng.standard_normal(n), 900, 5000 if brush else 8000)
    tone = 0 if brush else 0.4 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05)
    return vel * (noise * np.exp(-t / (0.09 if brush else 0.07)) + tone) * 0.5


def clap(vel=0.4):
    n = int(0.25 * SR); t = np.arange(n) / SR
    e = sum(np.exp(-np.clip(t - d, 0, None) / 0.008) * (t >= d) for d in (0, 0.011, 0.022)) + np.exp(-t / 0.08)
    return vel * bp(rng.standard_normal(n), 1000, 3500) * e * 0.35


def shaker(vel=0.15):
    n = int(0.09 * SR); t = np.arange(n) / SR
    return vel * hp(rng.standard_normal(n), 6000) * np.minimum(1, t / 0.01) * np.exp(-t / 0.03)


def tom(m=45, vel=0.5):
    n = int(0.6 * SR); t = np.arange(n) / SR
    f = hz(m) * (1 + 0.5 * np.exp(-t / 0.05))
    return vel * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22)


# ── arrangement helpers ──

class Track:
    def __init__(self, bpm, beats_per_bar, bars, tail=4.0):
        self.spb = 60 / bpm; self.bpb = beats_per_bar; self.bars = bars
        self.loop = self.spb * beats_per_bar * bars
        self.n = int(round(self.loop * SR)); self.stems = {}
        self.total = self.n + int(tail * SR)

    def at(self, bar, beat):
        return (bar * self.bpb + beat) * self.spb

    def add(self, stem, t_sec, sig, pan=0.0):
        buf = self.stems.setdefault(stem, np.zeros((2, self.total)))
        i = int(round(t_sec * SR)); sig = sig[: max(0, self.total - i)]
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        buf[0, i:i + len(sig)] += sig * l * 1.414; buf[1, i:i + len(sig)] += sig * r * 1.414

    def mix(self, levels, reverb=0.25, room=2.2):
        out = np.zeros((2, self.total)); send = np.zeros((2, self.total))
        for name, buf in self.stems.items():
            g, rv = levels.get(name, (1.0, 0.3))
            out += g * buf; send += g * rv * buf
        ir_n = int(room * SR); tt = np.arange(ir_n) / SR
        for c in range(2):
            ir = lp(rng.standard_normal(ir_n), 5500) * np.exp(-tt / (room / 6.9)) * np.minimum(1, tt / 0.02)
            ir /= np.sqrt(np.sum(ir ** 2))
            out[c] += reverb * fftconvolve(hp(send[c], 180), ir)[: self.total]
        # fold every tail past the loop end back onto the start → an exactly periodic loop
        loop = out[:, : self.n].copy(); rest = out[:, self.n:]
        while rest.shape[1]:
            k = min(self.n, rest.shape[1]); loop[:, :k] += rest[:, :k]; rest = rest[:, k:]
        loop = np.tanh(loop / (np.max(np.abs(loop)) * 0.9) * 1.1)   # gentle glue/soft-clip
        loop *= 0.89 / np.max(np.abs(loop))                          # ≈ -1 dBFS peak
        return loop


def voicing(name, low=52, size=4):
    """Close voicing of a chord above `low` (smooth, mid-register)."""
    root, iv = chord(name); notes = []
    for i in iv:
        p = root + i
        while p < low: p += 12
        notes.append(p)
    return sorted(notes)[:size]


def melody(tr, prog, stem, inst, rhythm, lo, hi, bars_from, seed, vel=0.5, pan=0.1, scale=None):
    """Chord-tone melody following an arch contour; rhythm = list of (beat, len_beats) per bar."""
    r = np.random.default_rng(seed); prev = (lo + hi) // 2
    for b in range(bars_from, tr.bars):
        name = prog[b % len(prog)]; root, iv = chord(name)
        tones = [p for p in range(lo, hi + 1) if (p - root) % 12 in [i % 12 for i in iv]]
        phrase_pos = (b - bars_from) % 4
        target = lo + (hi - lo) * (0.35 + 0.4 * np.sin(np.pi * (phrase_pos + 0.5) / 4))
        for j, (beat, ln) in enumerate(rhythm[phrase_pos % len(rhythm)]):
            goal = target + r.integers(-3, 4)
            cands = sorted(tones, key=lambda p: abs(p - goal) + 0.6 * abs(p - prev))
            p = cands[0] if abs(cands[0] - prev) <= 7 else cands[min(1, len(cands) - 1)]
            if scale and j % 2 == 1 and r.random() < 0.35:                    # occasional passing tone
                step = 1 if p > prev else -1
                passing = [q for q in range(prev + step, p, step) if q % 12 in scale]
                if passing: p = passing[len(passing) // 2]
            tr.add(stem, tr.at(b, beat), inst(p, ln * tr.spb, vel * (0.85 + 0.15 * r.random())), pan)
            prev = p


def scale_of(tonic, minor=False):
    return [(tonic + i) % 12 for i in ([0, 2, 3, 5, 7, 8, 10] if minor else [0, 2, 4, 5, 7, 9, 11])]


# ── the six tracks ──

def little_evenings():   # monthly — warm lo-fi, gently upbeat
    tr = Track(84, 4, 16)
    prog = ['Fmaj7', 'Am7', 'Dm9', 'Bbmaj7', 'Fmaj7', 'Am7', 'Gm7', 'C9']
    for b in range(16):
        name = prog[b % 8]; sw = 0.08
        for beat, ln in ((0, 1.4), (1.5 + sw, 0.4), (2.5 + sw, 1.3)):
            for i, p in enumerate(voicing(name, 53)):
                tr.add('keys', tr.at(b, beat) + i * 0.012, epiano(p, ln * tr.spb, 0.32), -0.2 + 0.13 * i)
        root = chord(name)[0] + 36
        for beat, ln, d in ((0, 1.4, 0), (2.5 + sw, 0.4, 0), (3 + sw, 0.9, 7)):
            tr.add('bass', tr.at(b, beat), bass(root + d if d == 0 else root + 7 - 12, ln * tr.spb, 0.7))
        if b >= 2:
            for beat in (0, 2.5 + sw): tr.add('drums', tr.at(b, beat), kick(0.7))
            for beat in (1, 3): tr.add('drums', tr.at(b, beat), snare(0.35, brush=True), 0.1)
            for e in range(8): tr.add('drums', tr.at(b, e * 0.5 + (sw if e % 2 else 0)), shaker(0.09 if e % 2 else 0.14), 0.35)
    melody(tr, prog, 'lead', lambda p, d, v: pluck(p, d, v, bright=0.35, decay=0.997),
           [[(0, 1), (1, 0.5), (1.5 + 0.08, 1.5)], [(0.5, 0.5), (1, 1), (2.5, 1.5)],
            [(0, 1.5), (2, 0.5), (2.5 + 0.08, 1.5)], [(0, 3)]], 65, 81, 8, 11, 0.42, 0.15, scale_of(5))
    return tr.mix({'keys': (0.9, 0.35), 'bass': (0.8, 0.05), 'drums': (0.55, 0.12), 'lead': (0.75, 0.45)}, 0.28)


def golden_years():      # anniversary — cinematic, romantic piano + strings
    tr = Track(66, 4, 12, tail=5)
    prog = ['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A', 'Bm', 'G', 'Dadd9', 'Asus4']
    for b in range(12):
        name = prog[b]; root = chord(name)[0]
        lowroot = root + 38 if root + 38 < 46 else root + 26
        arp = [lowroot, lowroot + 7, lowroot + 12] + [p for p in voicing(name, lowroot + 13, 3)] + [lowroot + 12, lowroot + 7]
        for e in range(8):
            tr.add('piano', tr.at(b, e * 0.5), piano(arp[e], 1.1 * tr.spb, 0.42 if e else 0.55), -0.25 + 0.06 * e)
        for p in voicing(name, 57):
            tr.add('strings', tr.at(b, 0), pad(p, 4 * tr.spb, 0.22 if b < 4 else 0.3, 1300), 0.3)
        tr.add('strings', tr.at(b, 0), pad(root + 38, 4 * tr.spb, 0.2, 700), -0.1)
    melody(tr, prog, 'lead', lambda p, d, v: piano(p, d, v, 1.2),
           [[(0, 1.5), (1.5, 0.5), (2, 2)], [(0, 1), (1, 1), (2, 2)], [(0.5, 1.5), (2, 2)], [(0, 4)]],
           69, 86, 4, 21, 0.48, 0.05, scale_of(2))
    return tr.mix({'piano': (0.8, 0.4), 'strings': (0.75, 0.6), 'lead': (0.85, 0.5)}, 0.4, 3.0)


def marathon():          # milestone — bright, celebratory strums and claps
    tr = Track(112, 4, 16)
    prog = ['G', 'D', 'Em', 'C', 'G', 'D', 'C', 'D']
    strum = [(0, 'd'), (1, 'd'), (1.5, 'u'), (2.5, 'u'), (3, 'd'), (3.5, 'u')]
    for b in range(16):
        name = prog[b % 8]; root = chord(name)[0]
        shape = voicing(name, 47, 3) + voicing(name, 59, 3)
        for beat, d in strum:
            order = shape if d == 'd' else shape[::-1][:4]
            for i, p in enumerate(order):
                tr.add('gtr', tr.at(b, beat) + i * 0.011, pluck(p, 0.5 * tr.spb, 0.32 if d == 'd' else 0.2, 0.55, 0.994), -0.35 + 0.1 * i)
        for e in range(8):
            tr.add('bass', tr.at(b, e * 0.5), bass(root + 31 if root + 31 >= 36 else root + 43, 0.42 * tr.spb, 0.55 if e % 2 == 0 else 0.4))
        for beat in range(4): tr.add('drums', tr.at(b, beat), kick(0.6 if b >= 4 else 0.35))
        if b >= 4:
            for beat in (1, 3): tr.add('drums', tr.at(b, beat), clap(0.45), 0.05)
        for s in range(16): tr.add('drums', tr.at(b, s * 0.25), shaker(0.12 if s % 2 else 0.05), 0.4)
    melody(tr, prog, 'lead', lambda p, d, v: bell(p, d, v, 3.0, 1.5, 0.9),
           [[(0, 0.5), (0.5, 0.5), (1, 1), (2.5, 1.5)], [(0, 0.5), (0.5, 1), (2, 0.5), (2.5, 1.5)],
            [(0, 1), (1, 0.5), (1.5, 0.5), (2, 2)], [(0, 1.5), (1.5, 0.5), (2, 2)]], 74, 91, 8, 5, 0.35, 0.2, scale_of(7))
    return tr.mix({'gtr': (0.85, 0.25), 'bass': (0.7, 0.03), 'drums': (0.6, 0.1), 'lead': (0.6, 0.45)}, 0.22, 1.8)


def snowlight():         # holiday — music box waltz, sparkly and warm
    tr = Track(120, 3, 24, tail=5)
    prog = ['C', 'Am', 'F', 'G', 'C', 'Em', 'F', 'G', 'Am', 'Em', 'F', 'C', 'Dm', 'G', 'C', 'G']
    for b in range(24):
        name = prog[b % 16]; root = chord(name)[0]
        tr.add('bass', tr.at(b, 0), pluck(root + 36, 1.4 * tr.spb, 0.6, 0.25, 0.995))
        v = voicing(name, 60, 3)
        for beat in (1, 2):
            for i, p in enumerate(v):
                tr.add('celesta', tr.at(b, beat) + i * 0.008, bell(p, 0.9 * tr.spb, 0.12, 4.0, 1.0, 0.7), -0.25 + 0.2 * i)
        for p in voicing(name, 55):
            tr.add('pad', tr.at(b, 0), pad(p, 3 * tr.spb, 0.18, 1100), 0.0)
        if b >= 8:
            for e in range(6): tr.add('perc', tr.at(b, e * 0.5), shaker(0.07 if e % 2 else 0.11), 0.45)
    melody(tr, prog, 'box', lambda p, d, v: bell(p, d, v, 5.0, 1.2, 1.1),
           [[(0, 1), (1, 1), (2, 1)], [(0, 2), (2, 1)], [(0, 1), (1, 0.5), (1.5, 0.5), (2, 1)], [(0, 3)]],
           76, 93, 0, 3, 0.28, 0.15, scale_of(0))
    return tr.mix({'bass': (0.7, 0.15), 'celesta': (0.8, 0.5), 'pad': (0.75, 0.5), 'perc': (0.5, 0.2), 'box': (0.85, 0.55)}, 0.38, 2.8)


def keepsake():          # important date — tender harp + felt piano, nostalgic
    tr = Track(76, 4, 12, tail=5)
    prog = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'E', 'F', 'G', 'Am', 'Esus4']
    for b in range(12):
        name = prog[b]; root = chord(name)[0]
        low = root + 45 if root + 45 <= 52 else root + 33
        notes = [low, low + 7] + voicing(name, low + 12, 3) + [voicing(name, low + 24, 1)[0]]
        up_down = notes + notes[-2:0:-1]
        for s in range(16):
            tr.add('harp', tr.at(b, s * 0.25), pluck(up_down[s % len(up_down)], 1.6 * tr.spb, 0.28, 0.3, 0.998), -0.3 + 0.04 * (s % 8))
        for p in voicing(name, 55):
            tr.add('pad', tr.at(b, 0), pad(p, 4 * tr.spb, 0.16, 900), 0.2)
    melody(tr, prog, 'piano', lambda p, d, v: piano(p, d, v, 0.8),
           [[(0, 2), (2, 1), (3, 1)], [(0, 3), (3, 1)], [(0.5, 1.5), (2, 2)], [(0, 4)]],
           64, 81, 2, 9, 0.46, 0.1, scale_of(9, True))
    return tr.mix({'harp': (0.75, 0.45), 'pad': (0.7, 0.5), 'piano': (0.9, 0.45)}, 0.36, 3.0)


def our_story():         # custom — cinematic, driving piano ostinato that builds
    tr = Track(92, 4, 16)
    prog = ['E', 'C#m', 'A', 'B', 'E', 'G#m', 'A', 'B']
    for b in range(16):
        name = prog[b % 8]; root = chord(name)[0]
        oct_ = root + 48 if root + 48 <= 56 else root + 36
        top = voicing(name, oct_ + 4, 2)
        for e in range(8):
            p = oct_ if e % 2 == 0 else top[(e // 2) % 2]
            tr.add('ostinato', tr.at(b, e * 0.5), piano(p, 0.45 * tr.spb, 0.3 + (0.08 if e % 4 == 0 else 0), 1.1), -0.2)
        for p in voicing(name, 59):
            tr.add('strings', tr.at(b, 0), pad(p, 4 * tr.spb, 0.16 if b < 8 else 0.26, 1500), 0.25)
        tr.add('bass', tr.at(b, 0), bass(root + 28 if root + 28 >= 33 else root + 40, 2.8 * tr.spb, 0.6))
        tr.add('bass', tr.at(b, 3), bass(root + 28 if root + 28 >= 33 else root + 40, 0.9 * tr.spb, 0.45))
        if b >= 4:
            tr.add('drums', tr.at(b, 0), kick(0.7)); tr.add('drums', tr.at(b, 2), kick(0.5))
            tr.add('drums', tr.at(b, 2.5), tom(43, 0.25), 0.2)
        if b >= 8:
            for beat in (1, 3): tr.add('drums', tr.at(b, beat), snare(0.3), -0.05)
            for e in range(8): tr.add('drums', tr.at(b, e * 0.5), shaker(0.08), 0.4)
    melody(tr, prog, 'lead', lambda p, d, v: piano(p, d, v, 1.3),
           [[(0, 1.5), (1.5, 0.5), (2, 1), (3, 1)], [(0, 3), (3, 1)], [(0, 1), (1, 1), (2, 2)], [(0, 4)]],
           68, 85, 4, 13, 0.5, 0.1, scale_of(4))
    return tr.mix({'ostinato': (0.75, 0.3), 'strings': (0.7, 0.55), 'bass': (0.7, 0.05), 'drums': (0.5, 0.15), 'lead': (0.85, 0.45)}, 0.3, 2.4)


TRACKS = {
    'little-evenings': little_evenings, 'golden-years': golden_years, 'marathon': marathon,
    'snowlight': snowlight, 'keepsake': keepsake, 'our-story': our_story,
}


def main():
    ff = __import__('imageio_ffmpeg').get_ffmpeg_exe()
    meta = {}
    for name, fn in TRACKS.items():
        if len(sys.argv) > 1 and name not in sys.argv[1:]: continue
        loop = fn(); p = int(PAD * SR)
        sig = np.concatenate([loop[:, -p:], loop, loop[:, :p]], axis=1)
        pcm = (np.clip(sig.T, -1, 1) * 32767).astype('<i2')
        with tempfile.NamedTemporaryFile(suffix='.raw') as raw:
            raw.write(pcm.tobytes()); raw.flush()
            subprocess.run([ff, '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(SR), '-ac', '2', '-i', raw.name,
                            '-codec:a', 'libmp3lame', '-b:a', '128k', os.path.join(HERE, name + '.mp3')], check=True)
        meta[name] = round(loop.shape[1] / SR, 4)
        print(name, meta[name], 's loop,', os.path.getsize(os.path.join(HERE, name + '.mp3')) // 1024, 'KB')
    print(json.dumps(meta))


if __name__ == '__main__':
    main()
