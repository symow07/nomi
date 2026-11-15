# Block 2 fix round 1 — final conversation bands

Captured 2026-11-15 at `3365c063`, with unchanged product source from `f18fc5bf`.
Synthetic local fixture; no customer message or order submitted. All 24 retained
images were opened whole. [manifest.json](manifest.json) records dimensions and
SHA-256. These are builder evidence; independent verification remains with tester.

## R-1 coverage

**666 measures, zero failures**: 600 base cases, 60 scroll sweeps covering
1781 positions, and six draft-typing cases. [Result summary](r1-summary.json).
The copied R-1 probe covers ten conversation fixtures
(draft, channel-limited draft, long-name waiting, Arabic-name waiting, no draft,
handed over, sent, order, deletion and expired), five languages (en/ar/es/fr/zh),
script on/off, top/latest, and three sizes: 390×844, 320×568, and 720×450 CSS pixels
at device scale factor 2 (200% layout equivalent of 1440×900).
English and Arabic with script on also walk the scroll region in 24 px steps,
and type additional lines into the draft. Phone and zoom are Chromium emulation;
this does not establish behavior with a physical phone keyboard.

The probe checks visible content under the navigation, fixed/sticky overlap,
whole answer controls, the band's position above the navigation, document scrolling,
and horizontal overflow. A control crossing the scroll region's own edge is logged
separately. It is not evidence that the control is hidden behind an overlay.

## Retained final views

Each image is at `#latest`; its scroll offset follows the browser's anchor behavior.
The draft band keeps Send, Hand to me, No reply needed and the reply box. The waiting
band keeps Hand to me. The handed-over band keeps the owner's reply box and Send
reply. The ORDER band keeps Confirm order and its distinct Hand to me command,
with the new consequence line. The separate ORDER takeover and its consequence
remain in the scrolling region, shown in the [matched order-other views](../fix1/README.md).

| State / size | English | Arabic |
| --- | --- | --- |
| Reply waiting · 390x844 | [view](draft-en-390x844-latest.png) | [view](draft-ar-390x844-latest.png) |
| Reply waiting · 320x568 | [view](draft-en-320x568-latest.png) | [view](draft-ar-320x568-latest.png) |
| Reply waiting · zoom200 | [view](draft-en-zoom200-latest.png) | [view](draft-ar-zoom200-latest.png) |
| Waiting for owner · 390x844 | [view](waiting-en-390x844-latest.png) | [view](waiting-ar-390x844-latest.png) |
| Waiting for owner · 320x568 | [view](waiting-en-320x568-latest.png) | [view](waiting-ar-320x568-latest.png) |
| Waiting for owner · zoom200 | [view](waiting-en-zoom200-latest.png) | [view](waiting-ar-zoom200-latest.png) |
| Owner writing · 390x844 | [view](handed-en-390x844-latest.png) | [view](handed-ar-390x844-latest.png) |
| Owner writing · 320x568 | [view](handed-en-320x568-latest.png) | [view](handed-ar-320x568-latest.png) |
| Owner writing · zoom200 | [view](handed-en-zoom200-latest.png) | [view](handed-ar-zoom200-latest.png) |
| Order waiting · 390x844 | [view](order-en-390x844-latest.png) | [view](order-ar-390x844-latest.png) |
| Order waiting · 320x568 | [view](order-en-320x568-latest.png) | [view](order-ar-320x568-latest.png) |
| Order waiting · zoom200 | [view](order-en-zoom200-latest.png) | [view](order-ar-zoom200-latest.png) |

## Limits still open

The order figures and warnings are not all visible on arrival on short screens;
the existing tester/owner review item stays open. Secondary content can end at the
scroll region's own edge and needs scrolling. The separate script-off tall-textarea
ruling on document-scrolling pages, clean Practice-state check, translation backlog
and deferred polish items are not resolved by this conversation-band sweep.
