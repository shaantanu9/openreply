# Archive Cleanup — Move Validation Dumps and HTML Prototypes

**Date:** 2026-05-16
**Type:** Infrastructure

## Summary

Moved six non-source folders into a new `_archive/` directory at the repo root and added `_archive/` to `.gitignore`. These folders were validation run outputs and HTML prototype iterations — not source code — and were cluttering the repo root. Nothing was deleted.

## Changes

- Created `_archive/` folder at repo root
- Moved `data-validate-ats-resume-and-job-search-apps/` → `_archive/`
- Moved `data-validate-product-research-tools-dovetail-condens-notably/` → `_archive/`
- Moved `data-validate-user-research-and-voice-of-customer-tools/` → `_archive/`
- Moved `data-validate-ux-research-saas/` → `_archive/`
- Moved `html-demo/` → `_archive/`
- Moved `html-demo-2/` → `_archive/`
- Added `_archive/` to `.gitignore`

## Files Modified

- `.gitignore` — added `_archive/` entry with comment
