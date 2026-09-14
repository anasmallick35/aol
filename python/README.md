# aol-hooks

Context integrity for AI agents, as an [AGENT-HOOKS-0.1](https://commandline.microsoft.com/agent-hooks-framework-neutral-ai-governance-contract/) interceptor.

```python
from agent_hooks import InterceptionEmitter
from aol_hooks import create_interceptor

emitter = InterceptionEmitter()
emitter.register(create_interceptor())
```

Works with any AGENT-HOOKS host — LangGraph, CrewAI, LlamaIndex, Semantic Kernel, Microsoft Agent Framework, OpenAI Agents SDK, Claude Agent SDK.

Requires the AOL daemon: `npx @aol/cli daemon`.

**No dependencies, including on the Agent Hooks SDK itself.** The interceptor protocol is satisfied structurally, so this installs and runs wherever Python does.
