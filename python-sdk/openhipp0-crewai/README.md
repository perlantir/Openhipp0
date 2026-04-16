# openhipp0-crewai

[CrewAI](https://github.com/joaomdmoura/crewai) integration for Open Hipp0.

```python
from openhipp0 import Hipp0Client
from openhipp0_crewai import instrument

client = Hipp0Client(base_url="http://localhost:3100")
instrument(client)           # every CrewAI task_started/task_completed event
                             # is now forwarded to hipp0's memory
```

Or via `openhipp0.auto()`:

```python
import openhipp0
openhipp0.auto()             # picks up crewai automatically if installed
```
