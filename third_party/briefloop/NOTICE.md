# BriefLoop runtime adapter reference

CodeBuddy's `--acp` entry point, capability negotiation, native permission handling,
visible stream projection and owned-process shutdown were checked against BriefLoop
commit `fb27867934029c98ed302c9e95a3cf873da9d4d5` (MIT; license retained here).

The Kaitu adapter continues Kaitu's own MIT local-agent snapshot
`47ce1c0085d516e9094efb84a308e0f0032f5022`, narrowed to CodeBuddy. It does not bundle
BriefLoop's Python runtime or its Open Design third-party source/bundle.
If those Apache-2.0 components are copied in future, retain their LICENSE and NOTICE
alongside them. No CLI, credentials or model service are redistributed here.
