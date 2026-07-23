# Connector data studio (design notes)

Side-panel experience for editing connector metadata with **live sample rows**.  
Contracts are defined with lean-engine; see also `lean-engine/docs/connectors.md` (section *Connector studio preview*).

Status: **Polish complete** — studio shell, chain steps, source→input auto-preview, debounced Apply.

## Goals

1. **Input** (top): a few sample rows from the upstream connector when `sourceConnectorName` is set.
2. **Settings** (middle): annotation-generated form; **Apply** refreshes samples from current form state.
3. **Output** (bottom): sample rows; errors shown here.
4. **Layout details**: not always on screen — **Show layout details** button per pane (input / output).
5. **Chain**: ordered nested steps with type select, expand/collapse settings, reorder/delete (not JSON textareas).

## Roles (UI)

| Role | When | Input pane |
|------|------|------------|
| Source | Sample, SQL, List, REST, Metadata* | Hidden (no upstream) |
| Transform | Sort, Filter, Select, Distinct, Passthrough | Shown when source name set |
| Chain | `ChainConnector` | Shown when outer source set (v1); embedded-source chains later |

## API contracts

### Preview (primary studio call)

```
POST /lean/api/edit/connector/preview/
Content-Type: application/json
```

Request:

```json
{
  "leanConnectorJson": "{ ... full Hop connector JSON ... }",
  "maxRows": 20,
  "renderId": "optional-uuid"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `leanConnectorJson` | yes | Same shape as `metadata/modify/connector` payload / `connector-json` load |
| `maxRows` | no | Default **20**, clamp **1..100** |
| `renderId` | no | Include presentation-local connectors when editing inside a presentation |

Response: always **HTTP 200** for application outcomes:

```json
{
  "ok": true,
  "maxRows": 20,
  "input": {
    "connectorName": "Sample Data",
    "rowMeta": [ { "name": "id", "type": "Integer", "length": -1, "precision": -1 } ],
    "rows": [ ["1", "..."] ],
    "truncated": true
  },
  "output": {
    "rowMeta": [ ... ],
    "rows": [ ... ],
    "truncated": false,
    "rowCountReturned": 8
  },
  "error": null
}
```

Failure example:

```json
{
  "ok": false,
  "maxRows": 20,
  "input": null,
  "output": null,
  "error": {
    "summary": "short message for the banner",
    "detail": "full cause chain for expand/collapse"
  }
}
```

Partial results: if input sampling works and output fails, return `input` + `ok: false` + `error`. Prefer keeping any successful `rowMeta` so layout-details can still open.

### Related endpoints

| Endpoint | Role |
|----------|------|
| `POST edit/connector/preview/` | **Studio preview** — input/output samples from inline `leanConnectorJson` |
| `POST render/connector/describe/` | Named connector **schema only** (saved metadata / presentation) |
| `POST metadata/modify/connector/` | Persist connector |
| `GET metadata/connector-json/{name}` | Load for form |
| `GET edit/connector/{pluginId}/` | Generated settings HTML |

### Sampling rules (server)

- Cap rows returned at `maxRows` (max 100).
- Do not rewrite user SQL with `LIMIT`.
- Buffering connectors (Sort, etc.) may still process full input; only the HTTP payload is truncated.
- Cell values as display strings; types only in `rowMeta`.
- Bound wall-clock time for preview; on timeout return structured `error` with `ok: false`.

## UI actions

| Control | Behavior |
|---------|----------|
| **Apply** | Run form save-script → preview POST → update sample tables (**do not** write metadata) |
| **Save** | `metadata/modify/connector/` then soft-reload presentation when in editor |
| **Source connector change** | Immediately show **Input** pane and sample that source; full output preview follows (debounced) |
| **Sample rows** | Toolbar select 10 / 20 / 50 / 100 (server hard max 100) |
| **Show layout details** | Toggle `rowMeta` table under input or output samples (default **collapsed**) |
| **Close / Back** | Aborts in-flight preview requests |

## Studio layout sketch

```
[ Apply | Save | Close | Back to list ]
─────────────────────────────────────
INPUT (if sourceConnectorName)
  [ sample rows table ]
  [ Show layout details ]  → expands row-meta
─────────────────────────────────────
SETTINGS
  (generated form HTML)
─────────────────────────────────────
OUTPUT
  [ sample rows table ]
  [ Show layout details ]
  [ error summary / detail ]
```

Client composition (preferred): wrap `GET edit/connector/{pluginId}/` HTML inside `#connectorSettings` rather than regenerating forms in Java.

## Smoke checks (preview API)

```bash
BASE=http://localhost:8080/lean/api

# Sample Data — inline JSON (unsaved form state shape)
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"maxRows":5,"leanConnectorJson":"{\"name\":\"Sample Data\",\"shared\":false,\"connector\":{\"SampleDataConnector\":{\"pluginId\":\"SampleDataConnector\",\"rowCount\":10}}}"}' \
  "$BASE/edit/connector/preview/" | head -c 800; echo

# Expect: {"ok":true,"maxRows":5,"input":null,"output":{"rowMeta":[...],"rows":[...],"truncated":true,...},"error":null}

# Describe (schema only) — needs a known connector name:
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"connectorName":"Sample Data"}' \
  "$BASE/render/connector/describe/"
```

Manual UI: edit mode → toolbar **connector** icon → open Sample Data / Sort → **Apply** refreshes samples (no save); **Save** persists; **Show layout details** toggles row meta.

## Implementation phases (summary)

| Phase | Focus |
|-------|--------|
| **0** | Design contracts (done) |
| **1** | `@LeanWidgetElement` completeness (done) |
| **2** | Engine preview helper + REST preview endpoint (done) |
| **3** | Studio shell UI (input / settings / output, Apply = preview) (done) |
| **4** | Chain step editor (done) |
| **5 / polish** | Source→input immediate preview, debounce/cancel XHR, sample size, soft busy (done) |

## Open product notes

- **Chain embedded source:** engine still expects an external `sourceConnectorName` for typical chains; nested steps are transforms. Embedding a source as the first chain step remains a possible later engine enhancement.
- **Presentation-local connectors:** list/edit path is **shared metadata** (`metadata/list/connector`, save to metadata). Presentation-embedded connectors are available at runtime via `renderId` on preview when editing inside a presentation, but the admin table does not list presentation-only connectors separately.
- **SSRF:** REST connector URLs remain a trust boundary; preview will hit the network when applied.
- **Per-step chain intermediate samples:** not in polish; full chain input/output only.
