# OpenMAIC teaching UI reuse

MIT source: https://github.com/THU-MAIC/dsh-openmaic
Upstream commit: 09c1693cfe83224db89fdd4abd245ac9174d3a05.
Local Harness rc.2 adaptation: 33ec66bc08174148fb598a819184314c214cf751.

Reused fragment/widget metadata and client OpenmaicCard, WidgetCard, shell,
frame-css and theme (in packages/dsh-plugin/src/client/openmaic/). Local changes: .js imports,
removed SDK-only type constraint and unused streaming extractor, widget CSP,
structural shared card props for both host surfaces.
Standalone frames load from persisted Ask events through a sandboxed localhost response
so parent CSP does not disable scripts. No generation server or SDK runtime bundled. No quiz answer/state persistence.
Widget/frame remount (including expanded view) resets its local interaction state.
