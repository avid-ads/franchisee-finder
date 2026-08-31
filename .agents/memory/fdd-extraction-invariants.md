---
name: FDD extraction invariants
description: Durable rules for resolving brands and counting locations across inconsistent FDD layouts.
---

Use the cleaned FDD filename as the stable brand fallback, and only let document text replace it when the detected value is clearly stronger. Reject incidental prose such as “franchisor at” as a name.

**Why:** FDDs use legal franchisor entities, consumer brand names, and generic franchisor prose inconsistently. Repeatedly overwriting a good filename-derived brand produced malformed names.

**How to apply:** Normalize known brands, keep generic label matching conservative, and test both filename and cover-page evidence.

Extract locations only within franchisee-list exhibits, with layout-specific handling for conventional tables, full state names, multiline address blocks, and territory/unit blocks.

**Why:** Location lists vary widely, while unrelated addresses appear throughout hundreds of FDD pages. One universal row regex either misses real locations or counts legal/administrative addresses.

**How to apply:** Track section and status headings across pages, deduplicate by normalized location identity, and compare dry-run counts with exhibit structure before replacing saved rows.

Reprocessing must replace a document’s derived location rows only after its PDF has been successfully read, scoped, parsed, and checked against rejection and historic-count thresholds.

**Why:** Appending creates duplicate brand totals, while sparse extraction or a mid-write failure can otherwise erase a previously healthy corpus.

**How to apply:** Build candidates in memory, reject implausible coverage regressions, and perform the delete/insert/contact/document update in one database transaction.

Never pair independently extracted PDF columns by row index alone.

**Why:** One wrapped or omitted PDF text item shifts every later row and silently attaches addresses to the wrong franchisee.

**How to apply:** Join columns only with stable shared evidence such as a location code or geometry; otherwise preserve the partial records and flag them for review.