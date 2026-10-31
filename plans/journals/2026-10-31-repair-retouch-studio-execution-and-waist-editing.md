---
title: Repair Retouch Studio execution and waist editing
date: 2026-10-31
summary: "Fixed live execution and preview flow; verified local waist reshaping, cutout and sky editing on an uploaded portrait."
---

# Repair Retouch Studio execution and waist editing

## What happened
The default removal instruction conflicted with custom edits, Execute was clipped, and accepted-image export could download old pixels while a preview existed. Real photo QA also found a selection expansion race, guide-marker leakage and an undefined reference variable.

## Decision
Use a pinned Execute action, explicit Apply/export state and a clean reference for AI prompt edits. Generative waist edits changed fabric too weakly, so waist mode now uses an explicit local strength slider and native pixel warp. Seven real-canvas regressions cover contour change, exact locked pixels, ordered mapping and alpha edges. Internal TypeScript and browser bundle checks pass; external SDK declarations are excluded.

## Verification
The 1920x2560 local20% export changes931113pixels and keeps all81360protected face pixels unchanged. Transparent cutout and blue-sky exports also preserve locked pixels. Private photos/results remain outside Git; only redacted measurements are in the repository.

## Limits
Strong local warp may bend nearby background. Fine hair/tree masks need review. Other AI modes and4K inputs are not exhaustively retested.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
