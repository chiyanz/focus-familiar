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

- A short task description.
- One target application.
- A duration.
- An intervention intensity.
- Timing thresholds for the escalation ladder.

Version 0.1 treats every other foreground application as time away from the target. Later versions may add allowed applications, but browser-domain and editor-workspace inspection are not required for the initial product.

## Core experience

### Focused

The pet performs a quiet working animation. It should be ambient rather than demanding attention.

### Briefly away

A grace period allows normal application switching without interruption.

### Distracted

After the grace period, the pet changes posture and offers a concise reminder connected to the user's stated task.

### Intervention

If time away continues, the app presents stronger but reversible friction, including a countdown and a clear action that requests a return to the target application.

### Returned

The pet acknowledges the return briefly, resets the away timer, and resumes the focused state. A distraction does not erase accumulated focus time.

## Product principles

1. **Return over guilt.** Optimize for returning quickly, not shame or perfect streaks.
2. **Calm by default.** The pet should disappear into the working environment while the user is focused.
3. **Honest strictness.** Strict mode adds friction but never claims to be impossible to escape.
4. **Local first.** The app should work without an account, network connection, or remote service.
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

No analytics or activity data leaves the Mac.

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
- The app operates without network access.
