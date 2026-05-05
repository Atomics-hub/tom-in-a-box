# Launch Draft

## One-Liner

`tib` is a verification-first security audit CLI that tries to disprove a vulnerability finding before you submit it.

## Short Post

I built `tom-in-a-box`, a local CLI for source-code security review.

It is not trying to be another scanner that dumps 200 alerts. The workflow is closer to a bug bounty pre-submission review:

- find or supply a candidate finding
- re-check it against current source
- run an independent try-to-break pass
- derive a PoC from the writeup
- search for duplicate or already-patched signals
- only mark it `SUBMIT` if every verifier agrees

The goal is fewer bad AI-generated vulnerability reports, fewer duplicate submissions, and more confidence before a solo researcher spends a week writing up a bug.

The repo includes a no-spend demo, benchmark harness, publication audit, and docs for the public alpha bar. The private benchmark corpus has two clean live passes over 10 accepted positives and 20 known negatives, with zero known-negative `SUBMIT` verdicts.

## Title Options

- I built a bug bounty copilot that tries to kill your report before you submit it
- `tib`: verification-first AI security audits for solo researchers
- Scanners create alerts. This CLI cross-examines findings.

## Places To Test

- personal network of bug bounty researchers
- GitHub Security Lab adjacent circles
- security engineering Discords/Slacks where self-promotion is allowed
- Hacker News Show HN after the second live pass
- X/LinkedIn thread with benchmark-method details

## First Feedback Questions

- Would you run this on one of your old accepted reports?
- What would make the output submission-grade for you?
- Is bring-your-own-key acceptable?
- Is the six-agent verification protocol the interesting part?
- What is the maximum acceptable cost per serious candidate?
