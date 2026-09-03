# Product brief

## Working title

Focus Familiar

The name is provisional and can change without affecting the product architecture.

## Problem

Conventional focus timers are easy to forget because they live away from the place where distraction happens. Focus Familiar makes the current commitment visible on the desktop and reacts when the user leaves the application they intended to use.

## Target user

The initial user is a Mac-based knowledge worker or developer who:

- Can name the application in which the next block of work should happen.
- Wants more friction than a passive timer but less control than an irreversible blocker.
- Values privacy, local operation, and understandable software.
- Enjoys light character animation and gentle gamification.

## Focus contract

Each session records:

- An optional short focus note.
- One target application.
- A duration.
- A choice between visual reminders and a one-time request to return to the
  target application.
- Timing thresholds for the escalation ladder.

Version 0.1 treats every other foreground application as time away from the target. Later versions may add allowed applications, but browser-domain and editor-workspace inspection are not required for the initial product.

## Core experience

### Focused

The pet performs a quiet working animation. It should be ambient rather than demanding attention.

### Briefly away

A grace period allows normal application switching without interruption.

### Distracted

After the grace period, the pet becomes more attentive and offers a concise reminder.

### Intervention

If time away continues, the pet periodically reveals stronger but reversible
reminders. When the user explicitly selects strict behavior, Focus Familiar
also asks macOS to bring the already-running target application forward once.

### Returned

The pet acknowledges the return briefly, resets the away timer, and resumes the focused state. A distraction does not erase accumulated focus time.

## Product principles

1. **Return over guilt.** Optimize for returning quickly, not shame or perfect streaks.
2. **Calm by default.** The pet should disappear into the working environment while the user is focused.
3. **Honest strictness.** Strict mode adds friction but never claims to be impossible to escape.
4. **Local first.** Focus behavior works without an account, network connection,
   or remote service. A failure to check for app updates cannot affect it.
5. **Explainable awareness.** The app must state exactly what it observes and why.
6. **Safe interruption.** Never destroy work or trap the user during an urgent situation.
7. **Replaceable personality.** Character art, animation, dialogue, and sounds are data rather than hard-coded product logic.

## Privacy commitments

Version 0.1 may store the selected target application's bundle identifier and session timing data. It will not collect:

- Keystrokes or typed text
- Source code or document contents
- Screenshots or screen recordings
- Browser URLs or page contents
- Clipboard contents
- Microphone, camera, or location data

No analytics or activity data leaves the Mac. Packaged builds make a disclosed
request to GitHub Releases to detect app updates; it includes the app version,
and GitHub receives the ordinary request IP address and user agent.

## Non-goals for version 0.1

- Determining whether a browser page is productive
- Determining which VS Code repository is active
- Cross-device synchronization
- Social feeds, leaderboards, or accounts
- AI-generated coaching
- Windows or Linux releases
- An unbreakable application or website lock

## Initial success criteria

- A user can configure and begin a session in under one minute.
- Foreground application changes update focus state reliably.
- Nudges occur at predictable, testable thresholds.
- The pet remains unobtrusive while the target application is active.
- Every intervention has a visible escape or pause path.
- All focus behavior operates without network access; only the non-critical
  update notice requires a connection.
