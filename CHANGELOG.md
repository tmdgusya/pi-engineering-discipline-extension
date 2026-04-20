# Changelog

All notable changes to this project will be documented in this file.

## [1.9.0](https://github.com/tmdgusya/roach-pi/compare/v1.8.2...v1.9.0) (2026-04-20)

### Features

* **agentic-harness:** add sandbox approval modes and sensitive env guard ([2e5d8cd](https://github.com/tmdgusya/roach-pi/commit/2e5d8cd5ed2f8106bc2613209f4916baf115b248))

## [1.8.2](https://github.com/tmdgusya/roach-pi/compare/v1.8.1...v1.8.2) (2026-04-19)

### Bug Fixes

* **harness:** clear activeGoalDocument on phase auto-reset ([88dbba1](https://github.com/tmdgusya/roach-pi/commit/88dbba18efcd4427ed203227140e15853f640559))
* **harness:** guard session_compact phase restore with isRootSession ([f527d20](https://github.com/tmdgusya/roach-pi/commit/f527d204099a369a91b45acfb8312011a746e967))

### Documentation

* **plan:** phase state multi-session isolation plan ([273cca7](https://github.com/tmdgusya/roach-pi/commit/273cca756323d4765776b13c2b0f8096e1c85d99))

## [1.8.1](https://github.com/tmdgusya/roach-pi/compare/v1.8.0...v1.8.1) (2026-04-19)

### Bug Fixes

* **harness:** auto-reset phase on terminal-artifact write ([c14351d](https://github.com/tmdgusya/roach-pi/commit/c14351def31867319588f1b5473d4f233b2c8354))
* **harness:** never inject phase guidance in subagent context ([8af3455](https://github.com/tmdgusya/roach-pi/commit/8af34556c22e96c12bf222001904a44f387f2d16))
* **harness:** suppress phase guidance on skill/command invocations ([e7c0266](https://github.com/tmdgusya/roach-pi/commit/e7c02669f3737b2ef751e2845af55dac97f9eb52))

### Refactor

* **harness:** drop global state file; phase is per-process in-memory only ([9bb134b](https://github.com/tmdgusya/roach-pi/commit/9bb134bb4ec0a19085a68241282f4d062a32291b))

## [1.8.0](https://github.com/tmdgusya/roach-pi/compare/v1.7.2...v1.8.0) (2026-04-11)

### Features

* **agentic-harness:** add /review and /ultrareview commands ([869a22d](https://github.com/tmdgusya/roach-pi/commit/869a22dd3aa873b7eac71f25b68994c0bf3d031a))

### Bug Fixes

* **agentic-harness:** accept PR URLs in /review and /ultrareview target ([927e2ec](https://github.com/tmdgusya/roach-pi/commit/927e2ecd4bd1cb33f7c397ac717e100961efab1b))

### Documentation

* **readme:** document /review and /ultrareview commands ([c81cc13](https://github.com/tmdgusya/roach-pi/commit/c81cc13a09cc5233a801c2f944987e30e1ebede8))

## [1.7.2](https://github.com/tmdgusya/roach-pi/compare/v1.7.1...v1.7.2) (2026-04-11)

### Bug Fixes

* **agentic-harness:** hide ask guidance from subagents ([b5e1b3b](https://github.com/tmdgusya/roach-pi/commit/b5e1b3b861c715fdd533a67d43b0bd2c17763e5b))

## [1.7.1](https://github.com/tmdgusya/roach-pi/compare/v1.7.0...v1.7.1) (2026-04-11)

### Bug Fixes

* **agentic-harness:** hide ask_user_question from subagents ([98b7a95](https://github.com/tmdgusya/roach-pi/commit/98b7a955ccc9e7743cbecb7240669ed61d68bf90))

## [1.7.0](https://github.com/tmdgusya/roach-pi/compare/v1.6.2...v1.7.0) (2026-04-11)

### Features

* add FFF-powered search engine extension ([7c42996](https://github.com/tmdgusya/roach-pi/commit/7c4299655fc76f2c9e46cc051e3833278d415d1f))

### Bug Fixes

* add FFF fallback and cwd-aware search ([86f10d5](https://github.com/tmdgusya/roach-pi/commit/86f10d533b33107649283f62fa9baeae5a445486))

### Documentation

* document FFF engine usage ([b341e68](https://github.com/tmdgusya/roach-pi/commit/b341e689d530a0106eba839f3c3db51c3a6bfd58))

## [1.6.2](https://github.com/tmdgusya/roach-pi/compare/v1.6.1...v1.6.2) (2026-04-09)

### Bug Fixes

* **agentic-harness:** make subagent shutdown accounting truthful ([6945420](https://github.com/tmdgusya/roach-pi/commit/69454203209ed2c84b32711aa1f58f2a69d0427e))
* **autonomous-dev:** add missing tsconfig and fix test type errors ([a9bea96](https://github.com/tmdgusya/roach-pi/commit/a9bea9667fff110deb4b9af853a55ffd367a11dc))
* **autonomous-dev:** preserve default signal termination behavior ([a6ff810](https://github.com/tmdgusya/roach-pi/commit/a6ff8108614acb6faef1c79c86a6da1df3f7d99c))
* **autonomous-dev:** reap nested worker processes ([0670a61](https://github.com/tmdgusya/roach-pi/commit/0670a61b482b53996532d2b94a32e1852698d256))

### Documentation

* add review fixes plan for autonomous-dev process cleanup ([00e8503](https://github.com/tmdgusya/roach-pi/commit/00e850305b058618973d752471d678db6d083b73))

## [1.6.1](https://github.com/tmdgusya/roach-pi/compare/v1.6.0...v1.6.1) (2026-04-09)

### Bug Fixes

* **autonomous-dev:** use provider/id instead of model display name for child processes ([1962270](https://github.com/tmdgusya/roach-pi/commit/1962270fd257ac0100767655ee170283947481bc))

## [1.6.0](https://github.com/tmdgusya/roach-pi/compare/v1.5.0...v1.6.0) (2026-04-08)

### Features

* add NestedSubagentCall type and SingleResult.nestedCalls field ([5033685](https://github.com/tmdgusya/roach-pi/commit/5033685df3dbe1fe31e229db3beeb176c6512f12))
* detect nested subagent calls from child process messages ([c9cf782](https://github.com/tmdgusya/roach-pi/commit/c9cf7823ed733ad2132801a1e0096e5a2d4591d0))
* render nested subagent calls as indented tree with status icons ([704d661](https://github.com/tmdgusya/roach-pi/commit/704d661d2632ad50dde7d583898cdde626ab95c8))

### Documentation

* add autonomous dev handoff document ([b130cb3](https://github.com/tmdgusya/roach-pi/commit/b130cb36d6e349998ae50295d5c40ee4c6a331dd))

### Miscellaneous

* slop-cleaner pass on nested subagent visibility code ([435c5f2](https://github.com/tmdgusya/roach-pi/commit/435c5f2e977ec71621969c71186646ec9f54f46e))

## [1.5.0](https://github.com/tmdgusya/roach-pi/compare/v1.4.0...v1.5.0) (2026-04-08)

### Features

* add dedicated synthesis agent for ultraplan Phase 3 ([88b9c73](https://github.com/tmdgusya/roach-pi/commit/88b9c73df6b767136c8c8a9c0274020fe156fd70))

## [1.4.0](https://github.com/tmdgusya/roach-pi/compare/v1.3.0...v1.4.0) (2026-04-07)

### Features

* add agentic-brainstorming skill ([a301f49](https://github.com/tmdgusya/roach-pi/commit/a301f49bc7ae9bde82b99b1f40f06a24b04349c7))

### Miscellaneous

* remove AI-generated code smells ([ff4d214](https://github.com/tmdgusya/roach-pi/commit/ff4d2145e3a82e89b3e2bd72c47d95ad784c2785))

## [1.3.0](https://github.com/tmdgusya/roach-pi/compare/v1.2.1...v1.3.0) (2026-04-06)

### Features

* add includeScripts option to webfetch tool ([e802b82](https://github.com/tmdgusya/roach-pi/commit/e802b824861010bd42bf0a5dd330e06825f61595))

## [1.2.1](https://github.com/tmdgusya/roach-pi/compare/v1.2.0...v1.2.1) (2026-04-06)

### Bug Fixes

* stop removing nav/header/footer/aside from turndown output ([bf8e3b2](https://github.com/tmdgusya/roach-pi/commit/bf8e3b2b7735920fe18f4992449b31d84710452f))

### Documentation

* update webfetch sample to reflect Turndown-only output ([dd434c2](https://github.com/tmdgusya/roach-pi/commit/dd434c23726435fca7a3fa1e3cd5111256e1bf86))
* **webfetch:** add context comparison report and benchmark script ([77981a4](https://github.com/tmdgusya/roach-pi/commit/77981a4ffbba266a7556205c8c86eab3e6b460dc))
* **webfetch:** add raw output samples for docs.anthropic.com comparison ([7900451](https://github.com/tmdgusya/roach-pi/commit/7900451f9776bf3861201fc79d8a5b78bb175c7b))

### Miscellaneous

* bump version to 1.2.1 ([3436d55](https://github.com/tmdgusya/roach-pi/commit/3436d55cdb96f3ccffdb51eba1b7d55882f5e41b))
* remove webfetch comparison docs and samples ([82766f1](https://github.com/tmdgusya/roach-pi/commit/82766f1cf9c19eacaef9f0e9930aeb9ae3ab0cc1))

### Refactor

* simplify webfetch to Turndown-only pipeline (Claude Code style) ([02045c7](https://github.com/tmdgusya/roach-pi/commit/02045c79c745b6a2d264a94dc929ca45ba22695c))

## [1.2.0](https://github.com/tmdgusya/roach-pi/compare/v1.1.0...v1.2.0) (2026-04-06)

### Features

* **webfetch:** add core fetch + convert pipeline with caching ([61c3e4f](https://github.com/tmdgusya/roach-pi/commit/61c3e4f9c57d63c38649e60791c7c98a12a57983))
* **webfetch:** add custom TUI rendering for fetch status and results ([0fb2d65](https://github.com/tmdgusya/roach-pi/commit/0fb2d6583d9addf1df1bb95d6efb1f8d57fad52a))
* **webfetch:** add dependencies and shared types ([d63dea6](https://github.com/tmdgusya/roach-pi/commit/d63dea6e5c478e6b7d0456fad7363c8340787931))
* **webfetch:** add lazy Turndown + GFM service ([32f809c](https://github.com/tmdgusya/roach-pi/commit/32f809c925d2ff429c5fdafd04319133f35278e1))
* **webfetch:** add LRU cache with TTL eviction ([e3b1364](https://github.com/tmdgusya/roach-pi/commit/e3b13649ac7eddb2b74bdaac7bc9c74ce26a178b))
* **webfetch:** add Readability content extraction with dynamic imports ([e22f13f](https://github.com/tmdgusya/roach-pi/commit/e22f13fb786214255a6ccf147875976510b8ed23))
* **webfetch:** register webfetch tool in agentic-harness extension ([edf3226](https://github.com/tmdgusya/roach-pi/commit/edf322688f1acf14a78e206f7e94978d6b7fcc36))

### Bug Fixes

* **webfetch:** resolve TypeScript type declaration errors ([7981a61](https://github.com/tmdgusya/roach-pi/commit/7981a6148f89d6190aab29b00e7071a10e4e3da4))

### Documentation

* **webfetch:** add review document and clean up residual comments ([2d97ccf](https://github.com/tmdgusya/roach-pi/commit/2d97ccfa6c81e1f35481b79e4883bb73a3803893))

### Miscellaneous

* **release:** v1.2.0 ([501193e](https://github.com/tmdgusya/roach-pi/commit/501193e80d75fa4511e5f08a28a80e52c8a241d0))

## [1.1.0](https://github.com/tmdgusya/roach-pi/compare/v1.0.1...v1.1.0) (2026-04-06)

### Features

* **session-loop:** extension entry point and root registration ([164ab48](https://github.com/tmdgusya/roach-pi/commit/164ab48c9c0af80bdbcdd0b3dbca6f92ba0dcd10))
* **session-loop:** implement /loop, /loop-stop, /loop-list, /loop-stop-all commands ([b43cd5b](https://github.com/tmdgusya/roach-pi/commit/b43cd5b03042fdae531993fe614e0ad8eb3a0b93))
* **session-loop:** implement JobScheduler with timeout and error isolation ([f860285](https://github.com/tmdgusya/roach-pi/commit/f860285b728f0983e18c64446310657ab5eaf0bc))
* **session-loop:** project setup and type definitions ([ab35267](https://github.com/tmdgusya/roach-pi/commit/ab35267dda1b4a1072a354e86094c9af34c5b8f7))

### Bug Fixes

* **session-loop:** clear timeout timer on Promise.race settle to prevent unhandledRejection ([1bcd2a4](https://github.com/tmdgusya/roach-pi/commit/1bcd2a4bc8864e59c1c665e10aa4dfd82720f596))
* **session-loop:** fix vitest Mock type in test file for tsc --noEmit ([f6f8a0a](https://github.com/tmdgusya/roach-pi/commit/f6f8a0af7f2324a15b8f049b74c26861c6964df4))
* **session-loop:** use deliverAs followUp to queue messages during active turns ([08acab1](https://github.com/tmdgusya/roach-pi/commit/08acab16e91e71369dad173a27e520a579e0605b))

### Documentation

* add session-loop to README.md and docs/index.html ([a823153](https://github.com/tmdgusya/roach-pi/commit/a823153cdb90866e8f2e1932620e0b417fa46682))
* **session-loop:** add README with usage and architecture ([0678e9c](https://github.com/tmdgusya/roach-pi/commit/0678e9c67560f49d9ffbe23b7df254599bee6abb))

### Tests

* **session-loop:** unit tests for parseInterval and JobScheduler ([38f39ea](https://github.com/tmdgusya/roach-pi/commit/38f39eaf821d62c8ebc73bd718f54ac1996b9996))

## [1.0.1](https://github.com/tmdgusya/roach-pi/compare/v1.0.0...v1.0.1) (2026-04-06)

### Bug Fixes

* **ci:** sync plugin version to v1.0.0 ([a2f1c93](https://github.com/tmdgusya/roach-pi/commit/a2f1c931b99a93d169a14a0a3cbf755c798ad289))
* **ci:** use plugin package.json as primary version source ([04542a4](https://github.com/tmdgusya/roach-pi/commit/04542a49947d2e97c8b4c8f6ac194f67ed8e2e87))

## 1.0.0 (2026-04-06)

### Features

* add agent discovery module (agents.ts) ([e5b7ca5](https://github.com/tmdgusya/roach-pi/commit/e5b7ca5918927230b3feb81d05f73ce543c95cff))
* add bundled agent definitions and wire up agent discovery ([8b8b4f1](https://github.com/tmdgusya/roach-pi/commit/8b8b4f1811a2cda68b85b27a1e121bbbb7b41fcc))
* add context compaction with phase-aware summarization and microcompaction ([44f8565](https://github.com/tmdgusya/roach-pi/commit/44f8565aa583d73c7deb21a51ff956ec80d18b77))
* add real-time progress streaming for subagent execution ([93a0140](https://github.com/tmdgusya/roach-pi/commit/93a0140c855e7dfb3a0df31b85e4112dce39261e))
* add run-plan execution agents (plan-worker, plan-validator, plan-compliance) ([08b09a0](https://github.com/tmdgusya/roach-pi/commit/08b09a04f3b39ebd301868bdc569cc74bbf33bda))
* add subagent execution engine (subagent.ts) ([83c7bf8](https://github.com/tmdgusya/roach-pi/commit/83c7bf8ba0cbcbcc3c8ae155d482e2582ddce393))
* add subagent tool call logging and progress tracking ([9ee8e3e](https://github.com/tmdgusya/roach-pi/commit/9ee8e3e1ec6434bdd92e0623a689a729abb19c8a))
* enforce karpathy rules and auto-spawn slop-cleaner for code-writing agents ([4fe821f](https://github.com/tmdgusya/roach-pi/commit/4fe821f43e854a9f65e6a3e30302903e9910d827))
* **harness:** add fixed validator prompt template for information barrier ([6eaeadb](https://github.com/tmdgusya/roach-pi/commit/6eaeadb2a3491d4e240a4c0324514d6c95fc3935))
* **harness:** add plan markdown parser for validator isolation ([2f8f102](https://github.com/tmdgusya/roach-pi/commit/2f8f102e1d4890d540512085077c1cb6d8b4cf95))
* **harness:** custom ROACH PI header and statusline footer ([0d760e2](https://github.com/tmdgusya/roach-pi/commit/0d760e20830ace9e3bd631b565545a7da130c582))
* **harness:** enforce validator information barrier via plan-derived prompts ([1da04ff](https://github.com/tmdgusya/roach-pi/commit/1da04ffaff14b5e8e0e421154fddf7c038bc62c6))
* **harness:** pi-coding-agent compatibility and validator information barrier ([4131e46](https://github.com/tmdgusya/roach-pi/commit/4131e4620c235e6bfa58c577e0d5bed008e4c940))
* register subagent tool and update PHASE_GUIDANCE ([2946bdc](https://github.com/tmdgusya/roach-pi/commit/2946bdc60cba761414cc52047254dd03a4f45d0f))
* **subagent:** add CLI argument inheritance for child processes ([daa1e5c](https://github.com/tmdgusya/roach-pi/commit/daa1e5c7d4218baa10633dce106b4aebc291a8aa))
* **subagent:** add event processing with message deduplication ([c466abb](https://github.com/tmdgusya/roach-pi/commit/c466abbeb3b8c7cdbe14b0506c21fcf4c5c9ed50))
* **subagent:** add shared type definitions — SingleResult, SubagentDetails, UsageStats ([7234a14](https://github.com/tmdgusya/roach-pi/commit/7234a146c5db7b5e8734f73644e73f391e194838))
* **subagent:** add TUI component rendering with renderCall/renderResult ([3131e72](https://github.com/tmdgusya/roach-pi/commit/3131e72673c6498c2238251a0676f4622fb0470e))
* **subagent:** wire renderCall/renderResult TUI rendering and delegation safety guards ([120ce75](https://github.com/tmdgusya/roach-pi/commit/120ce75b00835e68f7c14d57927b75c357716c54))

### Bug Fixes

* correct tool names in agent files (glob -> find) ([941e6d0](https://github.com/tmdgusya/roach-pi/commit/941e6d0cf1665a6529cf5ba5ff42e252a866493b))
* prevent LLM from hallucinating agent names and models ([3438d14](https://github.com/tmdgusya/roach-pi/commit/3438d145250b536553c4cdec355407b814e2698a))
* replace invalid 'cyan' theme color with 'blue' ([77fdc33](https://github.com/tmdgusya/roach-pi/commit/77fdc33eda43d692c597cfbfea970a76aa6315a3))
* restore ask command baseline ([cc508e5](https://github.com/tmdgusya/roach-pi/commit/cc508e5772cbfc6f675b325bf17892da4aba7870))
* **subagent:** resolve TypeScript type errors in render.ts and subagent.ts ([16f0d8e](https://github.com/tmdgusya/roach-pi/commit/16f0d8e786230dbec521d1202ebf309bc7eee511))
* use gh api for star (gh repo star not available) ([e8b9dfc](https://github.com/tmdgusya/roach-pi/commit/e8b9dfc0c4293bab7c2d1e1cc49be44992a367e0))
* use valid theme color 'muted' instead of invalid 'blue' ([e7b49f1](https://github.com/tmdgusya/roach-pi/commit/e7b49f1828714e6d97a4f555bb47c2a6aa61728a))

### Documentation

* add ai slop cleanup pilot plan ([d5c66d5](https://github.com/tmdgusya/roach-pi/commit/d5c66d55fac672ec2e7a65b38e8df7117c453bc1))
* add discipline hooks implementation plan ([e0eb8a6](https://github.com/tmdgusya/roach-pi/commit/e0eb8a638034bdc7d5e9429a67b55f0398814689))
* add Neo-Brutalist GitHub Pages site (EN/KR bilingual) ([b4370a5](https://github.com/tmdgusya/roach-pi/commit/b4370a528ca42289e4d7db0117a04c6928fd1d9a))
* add session-loop extension implementation plan ([c068c2a](https://github.com/tmdgusya/roach-pi/commit/c068c2afe5b5e113a3a439caa93a89de9ea40147))
* remove installation section and prerequisite — skills are bundled ([4522625](https://github.com/tmdgusya/roach-pi/commit/4522625927509a9f58c6a1132a996cf3134e519a))

### Styles

* add Neo-Brutalist design system CSS ([c8ee298](https://github.com/tmdgusya/roach-pi/commit/c8ee2984a62674fdb8ecb4716c6dc47a05fb7ee9))

### Miscellaneous

* clean up unused CSS rules and add implementation plan ([45fa1bb](https://github.com/tmdgusya/roach-pi/commit/45fa1bb54a10a71aaee805aaf830bdc26434046a))
* remove dead imports from harness leaf files ([c4f362f](https://github.com/tmdgusya/roach-pi/commit/c4f362f698ddd0a5eb86d176858066f8af274ec5))
* trim non-behavioral comment noise ([e615181](https://github.com/tmdgusya/roach-pi/commit/e61518108103642f5a2f3e84765e89c849f62674))
* udpate README.md and add tip modal ([1a2ae90](https://github.com/tmdgusya/roach-pi/commit/1a2ae9000f21fbfe4cf604d0c8f87952842af66a))

### Refactor

* rewrite agentic harness — remove hardcoded templates, add dynamic agent-driven architecture ([b77abec](https://github.com/tmdgusya/roach-pi/commit/b77abec1f7615aa95b217d2565b5534526a3aa63))
* **skills:** prefix bundled skills with agentic- and remove en html docs ([147cb40](https://github.com/tmdgusya/roach-pi/commit/147cb405f11cfcaefcf01c415e8ad9e012f69601))
* **subagent:** use new types, event processing, CLI arg inheritance, and safety guards ([9ba8857](https://github.com/tmdgusya/roach-pi/commit/9ba8857af982d08573a216c8bb707e410b2b82ea))

### Tests

* add agent discovery tests (parseFrontmatter, loadAgentsFromDir) ([d59dd2f](https://github.com/tmdgusya/roach-pi/commit/d59dd2fe1e2107fe64dfc6d0b174ccf48e4e5379))
* add subagent execution engine tests (extractFinalOutput, concurrency, helpers) ([7150704](https://github.com/tmdgusya/roach-pi/commit/715070457ec303aa388b55b51f8d1c42562b5006))
* isolate subagent depth env in resolve config tests ([b2b4c88](https://github.com/tmdgusya/roach-pi/commit/b2b4c88ab2d33a9e28c6d84e593b19ffce38eec0))
* update tests for subagent tool registration and PHASE_GUIDANCE changes ([f6c6598](https://github.com/tmdgusya/roach-pi/commit/f6c6598ebd1074c2cc41eb0cb8c35ae0ebe7cc91))
* update ultraplan tests and add comprehensive extension tests ([90aa605](https://github.com/tmdgusya/roach-pi/commit/90aa6059237853bf65f2c72d62ba01a96291f016))

### CI

* add GitHub Pages deployment workflow ([3f59f67](https://github.com/tmdgusya/roach-pi/commit/3f59f67ad5dae0e68b8a00dcfa9a960374caf8ef))
* add semantic release automation ([121785d](https://github.com/tmdgusya/roach-pi/commit/121785d0fc8bffc4148be07b76d7f4f00b03de2a))
