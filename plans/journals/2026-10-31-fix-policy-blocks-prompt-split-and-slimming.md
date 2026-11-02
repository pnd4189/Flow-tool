# 2026-10-31 — Policy blocks, prompt splitting, real slimming

## What broke
- Image to Video Studio: failed images never recovered on retry or with another model. Flow's error is Vietnamese ("…vi phạm các chính sách…"), which the safety detector missed, and every retry resent the same prompt. Discriminating test: 8 KTT_T04 scenes with the `Negative:` line → 4 blocked; same scenes without it → 5/5 suspect scenes succeeded. The appended `Avoid: no nudity…, no gore or blood…, no celebrity face…` list was the trigger. Explicit gore prompts were NOT blocked, so the filter is not a simple content-severity gate.
- Effect-Image: `--- SCENE 001 ---` did not match EXPLICIT_MARKER_REGEX (it required a trailing char), so each blank-line paragraph became a prompt: 1200 instead of 120.
- Retouch: "gọn bụng" typed in prompt mode went to the AI path; the warp weighted the centre, not the silhouette, so the outline barely moved.

## Fixes (via builder chat, verified in Flow)
- I2V `prompt-f1-safety`: sanitize negatives → drop Avoid → AI rewrite ×2. 16/16 real run. The builder also broke a ternary (`?` → `:`) and the tool stopped running; `f1b-syntax` fixed that one line. Lesson again: always diff builder output.
- Effect-Image `p10-parser-safety`: header-only markers own following paragraphs when repeated ≥2. Prototyped locally against the real file + test-data before sending; the first rule (disable paragraph split whenever markers exist) regressed `test_prompts.txt` 4→3.
- Retouch `p15-real-slimming`: uniform body compression + background stretch band; prototyped in numpy on the user's photo first.

## Open (updated at end of day)
- Long-Form video render paths (900 s timeout, AI prompt rewrite for video, ShotInspector credit deduction) are fixed in code but not exercised live, because that spends credits.
- The policy-rewrite rung ran live in Effect-Image (10/10 with rewrites); in I2V it is the same design but no live block has hit that rung yet.

## Follow-up the same day: Long-Form fixes, Retouch quick-fix and face slimming
- Long-Form: all 20 audit findings were sent to the builder in 3 batches. The batch-1 diff review caught a new regression: the keyframe batch rebuilt its slots from `shotsRef` before React re-rendered, so it lost the continuity reference. Fixed by re-applying the run's keyframes over the latest state. Batch 2 broke the build by reassigning a `const`; a 1-line prompt fixed it. Verified with tsc using stubs, a node parser run, and a live 0-credit keyframe run. Video render was not exercised.
- Retouch router v1 matched substrings of accent-stripped text: "chỉnh"→"chinh" contains "chin", so a belly request slimmed the face. Lesson: never route Vietnamese by accent-stripped substrings. Use whole-word Unicode matching on accented text.
- The quick-fix previews reused type `color_quality`, which the apply/download paths recompute from the (zero) sliders, so the result was identity. Caught only by diffing the downloaded pixels, not by reading the UI.
- Face slim: AI landmarks drift by about 15px (mouth corner), so the protected core needs a geometric floor (0.65F), not only the AI landmark.

## Late afternoon: auto person selection and multi-face safety
- One-click blur without a selection blurred the right leg and hand: a single SlimSAM point at the chest does not cover a standing body. AI body points (chest, belly, thighs, upper arms) as one multi-point prompt fixed it on the real photo.
- `CandidateMask.pixelCount` is counted at the inference size (~768px), not native size. Any area ratio must recount on the native canvas.
- Face slim had no idea other faces exist; its stretch band reached the neighbour's ear. AI face landmarks exclude ears, so the neighbour limit needs an ear/hair margin. A one-sided slim would skew the face, so a cramped face is skipped whole.
- The probe's first neighbour check passed vacuously because the neighbour was a flat colour: a stretched flat colour is byte-identical. Probes must use textured fills and a control case that proves the check can fail.
- The builder again renamed `outsideMaskPreservedPixels` and returned a canvas before `putImageData`. Both were caught only by tsc and the probe, not by reading its summary.

## Evening: tests in the repo, one live render, library cleanup
- Moving ad-hoc checks into `test-scripts/*.test.ts` immediately found two more parser defects: a lone document title became a prompt (Effect-Image), and a scene opening with dialogue put the dialogue into the visual action (Long-Form).
- The Long-Form label fix then broke single-block files (0 shots): labels only attached to existing shots, and the structured path required two headers. Only the live import showed it; the fixtures all had two blocks. Each fixture now covers the one-block case too.
- Node kept running after the parser tests: the parser yields through MessageChannel and open ports hold the event loop. Tests exit explicitly and the runner has a timeout.
- The first live Long-Form render: Omni 360p 4 s, 4 credits, ~41 s, QC 75. The button label carries the cost, so the script checked for "Quay (4 cr)" before clicking.
- The Flow library search indexes full prompts, not just titles. That made it safe to find the SCENE 900 image by words that only its prompt contains.

## Night: the type errors were hiding a real bug
- Tightening the tsc stubs (typed `React.FC`, `React.memo`, JSX children, module stubs) cut the "known" errors from 20 to 0 real ones. Among them, `bgBase64`/`subjectCutoutBase64` "not on ParallaxLayerData" was the visible end of a real bug: export and preview read cutout fields that layerService never sets, so parallax never reached an MP4. Treat a recorded type error as a lead, not noise.
- Face slim on 2D art: a peaked displacement profile pinches wherever the true contour meets the AI's F. A smooth plateau profile and a jaw-weighted vertical ramp fixed the S-shape. A convexity metric ("the width drop per 8 rows may only grow") is what made the probe discriminate; a monotonic-width check passed the broken version.
- Several probe checks first passed vacuously (flat colours, a shape fully inside the warp band). Every new check was run against the old code first to see it fail.

## 2026-11-02: Character Sheet Studio, a new tool built with tests first
- Every builder prompt was preceded by a node test that failed on the old code, so each bad build was caught by a check and not by a screenshot: the builder read React state through a setState updater (face lock always failed), moved `images` to a third argument of `Flow.generate.text` (images never sent), and kept a second copy of the final no-text sentence.
- A generic Flow error ("Dịch vụ tạo hình ảnh không hoạt động") was a prompt over ~4,100 characters, rejected in 9 ms. Only the diagnostics log (per-call duration, promptChars, refCount) made it visible; build that log before the features that depend on long prompts.
- Free text typed in Vietnamese and phrased as "notes" was painted into the picture; translating to English visual descriptions and ending the prompt with the no-text rule fixed it.
- The builder chat silently ignored the send button for an hour because another Flow tab was in front (`document.visibilityState === 'hidden'`). `send-watch.sh` now makes the tab visible first.
