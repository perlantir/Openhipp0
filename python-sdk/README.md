# Open Hipp0 — Python SDK

Typed Python clients for [Open Hipp0](https://github.com/openhipp0/openhipp0), the
local-first autonomous AI agent platform.

## Packages

| Package                       | Purpose                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `openhipp0-sdk`               | Base HTTP client + typed models + `hipp0.auto()` instrumentation |
| `openhipp0-crewai`            | Integration with [CrewAI](https://github.com/joaomdmoura/crewai) |
| `openhipp0-langgraph`         | Integration with [LangGraph](https://github.com/langchain-ai/langgraph) |
| `openhipp0-langchain`         | Integration with [LangChain](https://github.com/langchain-ai/langchain) |
| `openhipp0-autogen`           | Integration with [AutoGen](https://github.com/microsoft/autogen) |
| `openhipp0-openai-agents`     | Integration with [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) |

## Install

Each package is published independently on PyPI:

```bash
pip install openhipp0-sdk                # base
pip install openhipp0-crewai             # + CrewAI adapter
pip install openhipp0-langgraph          # + LangGraph adapter
# ...etc
```

## Quick start

```python
from openhipp0 import Hipp0Client

client = Hipp0Client(base_url="http://localhost:3100", api_key="...")

# Record a decision into the Hipp0 decision graph
await client.decisions.create(
    project_id="my-project",
    title="Use Postgres for production",
    reasoning="SQLite works for dev but pgvector is needed for scale",
    made_by="architect-agent",
    confidence="high",
    tags=["infra", "db"],
)

# Search prior sessions via FTS5
hits = await client.memory.search(project_id="my-project", query="postgres migration")

# Auto-instrument (one line; hooks framework integrations if installed)
import openhipp0
openhipp0.auto()
```

## Tests

```bash
cd python-sdk/openhipp0-sdk
pip install -e '.[dev]'
pytest
```

Each package has its own test suite.

## Layout

```
python-sdk/
├── openhipp0-sdk/            # base client + types + auto-instrumentation
├── openhipp0-crewai/
├── openhipp0-langgraph/
├── openhipp0-langchain/
├── openhipp0-autogen/
└── openhipp0-openai-agents/
```

Each package is an independent project (`pyproject.toml` + `src/` +
`tests/`) so they can be released separately.
