# Positioning

`tib` should not be positioned as another generic AI scanner.

The wedge:

> A verification-first bug bounty copilot that tries to kill your finding before you submit it.

## Who It Is For

- solo bug bounty researchers who already find plausible bugs but lose time on duplicates and edge-case false positives
- security consultants who need a second pass before sending client reports
- open source maintainers who want advisory-style review before release

## What It Is Not

- not a replacement for Semgrep, CodeQL, Snyk, or GitHub code scanning
- not an autonomous bounty submission bot
- not a promise that every run finds a real vulnerability
- not a PoC execution sandbox

## Why It Is Different

Traditional scanners optimize for finding patterns. `tib` optimizes for deciding whether a specific candidate deserves submission.

That means the product surface is less "find me 200 alerts" and more:

- re-check the bug against current source
- actively look for a reason the report is wrong
- independently derive a PoC from the writeup
- reject likely duplicates before they waste maintainer time
- produce an advisory-style report only after verification passes

## Competitor Framing

Semgrep, CodeQL, Snyk, and GitHub Code Security are strongest when teams want continuous code scanning and developer remediation workflows.

`tib` is strongest when a researcher has a candidate finding and wants submission-grade confidence.

The comparison line:

> Scanners create alerts. `tib` cross-examines a finding.

## Launch Signals

Good signs:

- researchers ask to run it on their own past reports
- maintainers say the output would reduce low-quality AI reports
- consultants ask for client-safe reporting controls
- people star the repo because the benchmark method feels trustworthy

Bad signs:

- feedback treats it as interchangeable with SAST
- users only want a hosted scanner with no bring-your-own-key workflow
- no one cares about the six-agent verification protocol
- live runs are too expensive for the expected value of a single report

## Pricing Hypothesis

Start open source with bring-your-own-key.

Possible paid paths:

- hosted audit history
- team/shared finding review
- cheaper pooled inference
- private benchmark packs
- report export and advisory workflow integrations

Do not charge before the proof story is clear.
