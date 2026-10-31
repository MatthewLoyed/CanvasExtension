# Source and release status

As of October 31, 2026, main combines the previously uncommitted download-fixes worktree (development version 1.12.0) with public-source preparation and restored Formspree feedback. Combined source version: 1.12.1.

The 1.12.0 implementation includes module selection, download/ZIP fixes, and offline course export. All implementation files and synthetic tests are now included in Git. Private live-course research and historical operational notes remain in a local backup; they are not public repository content.

Versions 1.10.1 and 1.10.2 published from this chat omitted the newer worktree. Their tags are retained as historical source snapshots; they must not be treated as the current complete implementation. The combined 1.12.1 release supersedes them.

The prior local release record states that 1.11.0 was published and 1.12.0 was submitted for automatic publication on October 26. On October 31 the signed-in developer dashboard confirmed 1.12.0 is published. Uploaded the checksum-verified GitHub 1.12.1 release ZIP and confirmed Draft 1.12.1 / Published 1.12.0. Submitted 1.12.1 with automatic publication after approval enabled. Dashboard confirmed Your extension was submitted for review and Status: Pending review. Version 1.12.1 is not yet confirmed public.

Reconciliation validation includes the combined automated suite, synthetic offline benchmarks, secret scanning, manifest path checks, and release archive checksum verification. Prior live Canvas tests of older candidates are historical evidence, not a fresh live test of this combined build.

Feedback reads the running extension manifest version; tests derive the version from that same file. Formspree form name is Canvas Downloader Feedback. No additional test email was sent during reconciliation.

