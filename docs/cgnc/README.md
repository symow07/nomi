# The CGNC chart, as Nomi holds it

How the chart in `migrations/0190_cgnc_chart.sql` was made. The owner's rule for D4 was to build it from the CGNC
itself, the legal source, and never to copy it from software.

## The source

- **Code Général de la Normalisation Comptable, Tomes I and II**, published by the Conseil National de la
  Comptabilité. The ministry's CNC page (finances.gov.ma, « Normes comptables ») links it as
  `/Publication/depp/2010/7004_recettes_priv_annee25_11_210.pdf`.
- Downloaded on 2026-10-22: 626 pages, SHA-256
  `e42e7bfa4791abb4962cb78abf8396ded84878b3f0bcc3946a8a2e549095faa6`.
- **Tome II, « Cadre comptable et plan de comptes »** has two plans. Nomi takes the **modèle normal** (PDF pages
  257–315) and not the modèle simplifié (from page 316): the normal model serves every business.

## How it was read

1. **The PDF is a scan** with no text layer, so it was read by OCR twice, locally:
   - at 2400 px with language correction off;
   - at 3600 px with language correction on.

   The OCR is macOS's Vision framework (`tools/cgnc/pdfocr.swift`, run with `swiftc`). Nothing was sent anywhere.
2. **The two readings were parsed and merged** (`tools/cgnc/cgnc_parse.py`, `cgnc_merge.py`). A line on which they
   disagreed, or which only one of them saw, was marked.
3. **Every page from 257 to 315 was then checked by eye against its image** (`tools/cgnc/pdfpng.swift`), whether or
   not anything was marked. Each difference is a line in `corrections.txt`, which `cgnc_final.py` applies:
   - **headings the OCR dropped** (it skips underlined lines): 114, 151, 241, 248, 311, 313, 3134, 448, 552, 553,
     554, 6198, 6311;
   - **accounts it dropped**: 63113, **6331 Pertes de change propres à l'exercice**, 6382;
   - **codes it misread**: 44525 (read 14525), 6581 (read 1859), 7125;
   - **titles it garbled**: the rest of the 116 corrections in all.
4. **Checked once more by structure**:
   - every account's parent is present;
   - no code appears twice;
   - no character falls outside French text.

## What was decided, and why

- **Obvious misprints in the printed text are corrected, and listed here**:
  - 6193 « exploitaion » → exploitation;
  - 61921 « l'immobilisations » → l'immobilisation;
  - 7143 « coporelles » → corporelles;
  - stray full stops after 1481, 2394, 6178 and 7148.
- **Initial capitals and accents follow the print.** Headings are in capitals, as printed (one, 112, is put in
  capitals like its siblings).
- **A printed range is a heading with no account of its own:** « 24/25 », « 294/295 », « 613/614 ». Its accounts hang
  from the class rubric above, or from none (241, 248, 251, 258).
- **Numbers the CGNC leaves empty** (12, 18, 46, 48, 49 …) are not accounts.
- **Each account's kind follows its class.** See the header of 0190.
- **The six journals are Nomi's, not the CGNC's** (it prescribes none): VE, AC, BQ, CA, OD, CL.

## Files

- `plan-normal.tsv` — the result: code, parent, kind, PDF page, title (871 accounts).
- `corrections.txt` — every correction, read from the page.
- `tools/cgnc/` — the scripts that turn the PDF into `plan-normal.tsv`, to read it again.
