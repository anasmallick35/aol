# @contextkeep/hooks

[AGENT-HOOKS-0.1](https://commandline.microsoft.com/agent-hooks-framework-neutral-ai-governance-contract/) interceptor for [ContextKeep](https://www.npmjs.com/package/contextkeep).

```ts
import { InterceptionEmitter } from '@responsibleai/agent-hooks'
import { createInterceptor } from '@contextkeep/hooks'

const emitter = new InterceptionEmitter()
emitter.register(createInterceptor())
```

Works with any AGENT-HOOKS host: LangGraph, CrewAI, LlamaIndex, Semantic Kernel, Microsoft Agent Framework, OpenAI Agents SDK, Claude Agent SDK.

Requires the daemon: `npx contextkeep daemon`.

**No runtime dependency on the Agent Hooks SDK.** The `Interceptor` contract is satisfied structurally, so this installs and runs wherever your host does — including platforms the SDK's native core does not yet ship for.

MIT licensed.
