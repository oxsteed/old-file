# Historical reference files

These snapshots are retained for provenance, not used by the running application.
Check current code, configuration, and tests before relying on an old status claim.

- `contributor-guides/`: complete former AGENTS.md and CLAUDE.md files, preserved
  unchanged on 2026-09-21. The root AGENTS.md now contains the contributor rules.
- `legacy-root/`: loose controllers, route files, JSX, and SQL moved unchanged
  from the repository root on 2026-09-21 after checking active source references.
  Several files contain imports relative to nonexistent root directories; these
  are reference material, not standalone runnable modules.

Production server code lives in `server/`; browser code lives in `client/src/`.
The migration runner reads only `server/migrations/`. Never copy the historical
181-184 SQL files into that directory or apply them to production: those numbers
already identify different migrations in the active schema history.

The archive is excluded from Docker build contexts. Do not import files from it
into the application. Restore useful ideas through an ordinary reviewed change
to the active source tree instead.
