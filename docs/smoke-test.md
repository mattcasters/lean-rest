# lean-rest smoke test

End-to-end check that the REST layer can load metadata and return **server-side SVG** from lean-engine on Java 21 / Hop 2.18.1.

## Prerequisites

1. Install lean-engine:

   ```bash
   cd ../lean-engine && mvn clean install -DskipTests
   ```

2. Package lean-rest (optional; `jetty:run` builds as needed):

   ```bash
   cd ../lean-rest && mvn clean package -DskipTests
   ```

3. Test metadata lives under `src/test/resources/metadata/` and is referenced from  
   `src/test/resources/leanrest.properties` (`metadata.path`).

## Start the server

Config path is the **system property** `LEAN_REST_CONFIG_PATH` (directory containing `leanrest.properties`), not Maven `-DCONFIG_PATH`.

```bash
cd ~/git/mattcasters/lean-rest
export LEAN_REST_CONFIG_PATH="$PWD/src/test/resources"
mvn jetty:run -DLEAN_REST_CONFIG_PATH="$LEAN_REST_CONFIG_PATH"
```

Expected log lines:

- `Found configuration file: .../leanrest.properties`
- `Found 15 metadata types.` (count may vary)
- `Started ServerConnector...{0.0.0.0:8080}`

Base URL:

| Piece | Value |
|-------|--------|
| Context | `/lean` |
| JAX-RS application path | `/api` (`@ApplicationPath("api")`) |
| API root | **`http://localhost:8080/lean/api`** |

> Paths such as `/lean/render/main` **without** `/api` return 404.

## Manual checks

```bash
BASE=http://localhost:8080/lean/api

# Main HTML shell (opens list-presentations in JS)
curl -sS -o /tmp/lean-main.html -w "%{http_code}\n" "$BASE/render/main/"

# Metadata
curl -sS "$BASE/metadata/types"
curl -sS "$BASE/metadata/presentations/"

# Render a presentation (returns UUID as plain text)
RID=$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"presentationName":"list-presentations","parameters":[],"reload":true}' \
  "$BASE/render/presentation")
echo "renderId=$RID"

# Page count + SVG
curl -sS "$BASE/render/info/pages/$RID"
curl -sS -o /tmp/lean-page.svg "$BASE/render/page/$RID/SVG/0/"
head -c 200 /tmp/lean-page.svg; echo
grep -q '<svg' /tmp/lean-page.svg && echo PASS || echo FAIL
```

### Expected results (smoke, 2026-07-22)

| Check | Expected |
|-------|----------|
| Jetty + LeanEnvironment | Starts; metadata types loaded |
| `GET .../render/main/` | **200**, HTML with jQuery + `API_BASE = '/lean/api/'` |
| `GET .../metadata/types` | **200**, JSON array including `presentation`, `theme`, `lean-database-connection` |
| `GET .../metadata/presentations/` | **200**, list of presentation names |
| `POST .../render/presentation` (`list-presentations`) | **200**, UUID render id |
| `GET .../render/info/pages/{id}` | **200**, e.g. `1` |
| `GET .../render/page/{id}/SVG/0/` | **200**, non-trivial SVG containing `<svg` |

### Known non-failures

- **`SteelWheels Customer Table`** (and similar SQL presentations) return **500** if the H2 file/DB referenced by metadata is empty or missing tables (`CUSTOMERS not found`). That is **test data setup**, not a platform regression. Populate SteelWheels H2 or point `lean-database-connection` metadata at a loaded database before expecting those to render.

## Stop the server

Ctrl+C in the Jetty terminal, or kill the `mvn jetty:run` process.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| All APIs 404 under `/lean/...` | Missing `/api` segment |
| Config not found / 0 metadata | Wrong `LEAN_REST_CONFIG_PATH` or `metadata.path` in properties |
| Init fails reading Hop jars / jandex | lean-engine/hop versions mismatch (need Hop 2.18.1 + Jandex 3.5.3) |
| SVG empty or error JSON | Presentation missing connectors/theme, or SQL data unavailable |
