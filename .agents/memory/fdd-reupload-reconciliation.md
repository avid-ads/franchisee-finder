---
name: FDD reupload reconciliation
description: Safety rules for merging newer or repeated FDD evidence into franchisor-wide location records.
---

Merge a new FDD candidate automatically only when its stable code, normalized address/geography, or conservative entity/geography identity resolves to one record. Retain genuinely new conflicting evidence as a separate Needs review record, but use an exact evidence fingerprint to prevent that same ambiguity from being added again on repeat uploads. Automated extraction may fill missing values on reviewed records but must not revoke Approved/Rejected decisions or overwrite their reviewed status.

**Why:** Multiple franchise records can legitimately share addresses, codes can conflict with address evidence, and repeated ambiguous uploads otherwise either destroy distinct records or create endless duplicates.

**How to apply:** Keep reconciliation transactional and serialized per franchisor, prefer non-empty or higher-quality fields, deduplicate contacts only with strong identities, and expose added/matched/updated/unchanged/ambiguous outcomes in each extraction manifest.