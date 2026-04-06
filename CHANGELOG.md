# Changelog

All notable changes to this project will be documented in this file.

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
