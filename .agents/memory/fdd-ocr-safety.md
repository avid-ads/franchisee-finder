---
name: FDD OCR safety
description: Safety and quality rules for OCR-assisted franchisee extraction from scanned and hybrid PDFs.
---

Treat scanned-page OCR as untrusted, lower-quality source evidence: run it before source discovery, preserve usable native text, propagate measured confidence to rows and review warnings, and block replacement when any OCR-derived source range is incomplete, unscored, or below the quality floor.

**Why:** Document-wide average confidence can hide one badly recognized franchisee page, while partial OCR can produce plausible but incomplete rows that would otherwise replace a healthy saved corpus.

**How to apply:** Evaluate quality per discovered source page, preserve prior rows on OCR failures or work-budget exhaustion, and bound raster dimensions, subprocess time, page count, and total OCR work for uploaded PDFs.