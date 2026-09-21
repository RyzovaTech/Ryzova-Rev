# Ryzova Rev

Ryzova Rev is a local-first desktop software engineering workspace being developed by RyzovaTech. It uses the open-source Code - OSS codebase as its editor and desktop foundation, while Ryzova Rev adds its own product identity and an AI engineering layer.

> **Project status:** active development. The current repository contains the Code - OSS foundation and the first Ryzova Rev product-branding layer. AI assistant, engineering-agent, verification, integrated preview, packaging, and release work are being developed in later roadmap phases.

## Product direction

Ryzova Rev is designed around a simple engineering loop:

```text
Understand requirement
→ Analyze project
→ Create engineering plan
→ Implement
→ Run
→ Test
→ Detect errors
→ Repair
→ Re-test
→ Verify
→ Git checkpoint
→ Ready for delivery
```

The long-term architecture separates the editor foundation from Ryzova-specific intelligence:

```text
Ryzova Rev
├── Code - OSS foundation
│   ├── Editor
│   ├── File system
│   ├── Terminal
│   ├── Git
│   ├── Debugging
│   └── Extension infrastructure
└── Ryzova intelligence layer
    ├── Project understanding
    ├── Context management
    ├── Rev Assistant
    ├── Engineering agents
    ├── Tool execution
    ├── Test / repair / verification
    └── Integrated project preview
```

## Development model

The repository is the source of truth for Ryzova Rev development. The intended workflow is:

```text
Local development / Codex
→ Git commit
→ GitHub
→ CI and platform builds
→ GitHub Releases
→ Windows / macOS / Linux installers
```

The local Git setup can keep the original Code - OSS repository as an `upstream` remote so upstream changes can be reviewed and integrated deliberately.

## Roadmap

Ryzova Rev development follows ten phases:

1. Foundation and GitHub setup
2. Ryzova Rev branding shell
3. Local build and development preview
4. Rev core architecture layer
5. Rev Assistant and built-in intelligence
6. Engineering agent system
7. Run / test / repair / verify loop
8. Integrated live preview and project experience
9. Production quality, security, and installer system
10. Ryzova Rev v1.0 release

## Upstream and attribution

Ryzova Rev is built from the open-source **Code - OSS** repository maintained by Microsoft and the community:

- Upstream source: https://github.com/microsoft/vscode
- Upstream license: MIT
- Original copyright notices and required attribution are retained in the source.

Ryzova Rev is a separate project and should not be confused with Microsoft's branded Visual Studio Code distribution.

## License

Ryzova Rev is distributed under the **GNU General Public License v3.0 only (GPL-3.0-only)**. See [LICENSE](LICENSE).

RyzovaTech-authored Rev code and modifications are licensed under GPL-3.0-only unless a file says otherwise. The Microsoft-authored **Code - OSS** portions retain their original MIT license and copyright notices; the preserved upstream MIT text is in [LICENSE.txt](LICENSE.txt). Those upstream portions remain available under the MIT terms as well.

Third-party components keep their own licenses and notices. See [ThirdPartyNotices.txt](ThirdPartyNotices.txt). Nothing in the Ryzova Rev GPL notice removes or replaces license obligations that apply to upstream or third-party components.
