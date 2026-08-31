---
name: Server-side PDF.js
description: Packaging constraint for extracting PDF text in the Node API service.
---

PDF.js must remain external to the API server bundle rather than being folded into the generated server file.

**Why:** PDF.js resolves its worker relative to its installed package. Bundling the main module caused the worker lookup to move beside the API output, where no worker file existed, and every uploaded document failed processing.

**How to apply:** When changing the API build or PDF extraction dependency, keep the PDF.js package external and verify an actual upload reaches a completed processing state.