# Lean Rest

REST API for the [Lean engine](https://github.com/mattcasters/lean-engine): metadata access and **server-side SVG** presentation rendering.

## Platform

| Requirement | Version |
|-------------|---------|
| Java | **21** |
| Apache Hop | **2.18.1** |
| lean-engine | **1.0.0-SNAPSHOT** |

## Steps to get going locally

1. Build and install lean-engine:

   ```bash
   cd ../lean-engine && mvn clean install
   ```

2. Start lean-rest (config directory must contain `leanrest.properties`):

   ```bash
   cd ../lean-rest
   export LEAN_REST_CONFIG_PATH="$PWD/src/test/resources"
   mvn clean install jetty:run -DLEAN_REST_CONFIG_PATH="$LEAN_REST_CONFIG_PATH"
   ```

3. Open the main page (note the **`/api`** segment):

   http://localhost:8080/lean/api/render/main/

To debug, set `MAVEN_OPTS` to  
`-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005`  
and attach a debugger to that port.

## Smoke test

See **[docs/smoke-test.md](docs/smoke-test.md)** for the full checklist (metadata, render UUID, SVG download).

Quick verify:

```bash
BASE=http://localhost:8080/lean/api
curl -sS "$BASE/metadata/presentations/" | head
RID=$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"presentationName":"list-presentations","parameters":[],"reload":true}' \
  "$BASE/render/presentation")
curl -sS -o /tmp/page.svg "$BASE/render/page/$RID/SVG/0/"
grep -q '<svg' /tmp/page.svg && echo PASS
```

## Build and run the container (experimental)

```bash
docker build . -t lean-rest
docker run -p 8080:8080 -v "$PWD/src/test/resources/:/lean/" lean-rest
```

Container config may still need `LEAN_REST_CONFIG_PATH` / `metadata.path` alignment with the mounted volume.

## REST API

API root: **`http://localhost:8080/lean/api`**

### Metadata

| Service | Type | Description |
|---------|:----:|-------------|
| `/metadata/types` | GET | List metadata type keys |
| `/metadata/list/{key}/` | GET | List element names for a type |
| `/metadata/{key}/{name}` | GET | Load one metadata element |
| `/metadata/{key}/` | POST | Save a metadata element |
| `/metadata/presentations/` | GET | High-level presentation list |

### Rendering

| Service | Type | Description |
|---------|:----:|-------------|
| `/render/main/` | GET | Main HTML shell (client opens a presentation list) |
| `/render/presentation` | POST | Render a presentation; body JSON with `presentationName`, optional `parameters`, `reload`. Returns render UUID (plain text) |
| `/render/info/pages/{renderId}` | GET | Number of pages for a rendering |
| `/render/page/{renderId}/{renderType}/{pageNumber}/` | GET | Page content (`SVG` or `HTML`) |
| `/render/lookupActions/` | POST | Hit-test interactions for coordinates |

Example render body:

```json
{
  "presentationName": "list-presentations",
  "parameters": [],
  "reload": true
}
```

Example actions request:

```json
{
  "renderId": "811bedf3-8836-44dd-894e-7290850c52a7",
  "pageNumber": 0,
  "x": 123,
  "y": 456
}
```
