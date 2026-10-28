# One Roomie agent with per-Group Toolkits

Roomie should grow from bill splitting into research, PDFs, trip planning, stickers and more, without each addition touching the core. Each Toolkit is a folder with a manifest, tools, services, tables, and an optional dashboard page and settings. Toolkits are registered in one list and switched on per Group. There is a single Mastra agent. Its tools are resolved for each request from the Group's enabled Toolkits, narrowed to the Toolkit the Gate picked. The Group, the Member and their role reach the tools through Mastra's `RequestContext`, so the agent is built once and not per message.

## Consequences

- All business logic lives in Toolkit services. Tools and dashboard pages are thin front doors to the same functions.
- Heavy Toolkits (research, trip planning) may wrap their own sub-agent, exposed to Roomie as a tool.
- Permission checks (Admin, Pending member, ownership of an Expense) live in services, never in prompts.

## Considered options

- **A supervisor agent routing to many specialist agents:** more hops, more latency, and harder to trace. Rejected for v1.
- **One agent with every tool always loaded:** tool confusion grows with every Toolkit. Rejected.
