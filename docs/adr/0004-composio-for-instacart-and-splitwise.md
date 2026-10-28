# Instacart and Splitwise go through Composio, wrapped in Roomie's own tools

Instacart's own API keys take about 30–40 days to approve, and Splitwise OAuth means registering an app and running a token flow ourselves. Composio offers both with managed authentication. The agent never sees raw Composio actions, though. It calls Roomie tools such as `export_to_splitwise` and `instacart_recipe_link`, which run Composio from inside a service. The money math stays in our code, and the model can't, for example, delete a Splitwise expense by itself.

## Consequences

- Splitwise connections belong to one Member's Account: the Member who connects their own Splitwise. The Instacart connection is one per app.
- Splitwise's free API terms forbid commercial use and apps that "replicate Splitwise". Before Roomie is sold or published, either get a licence from developers@splitwise.com or remove Splitwise import/export.
- Splitwise has no webhooks, so v1 does import, plus export with an optional live mirror. There is no two-way sync.
- Composio's "no Instacart key needed" claim must be confirmed with a real call before Groceries depends on it. If it doesn't hold, fall back to applying for our own Instacart key.
