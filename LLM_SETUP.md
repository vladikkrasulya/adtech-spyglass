# Local LLM Setup — Ollama for Spyglass Intelligence

Spyglass uses a **self-hosted, local LLM** for two narrow tasks in the
Discovery flow:

1. **Cluster naming** — `/api/intel/suggest-name` proposes a `snake_case`
   dialect name + one-sentence description for a cluster of newly-discovered
   ext-fields.
2. **Per-field purpose hint** — `/api/intel/field-purpose` labels a single
   field path with one purpose from a closed allow-list (`click_url`,
   `image_url`, `tracker_pixel`, `segment_id`, …).

Both are **opt-in**, **server-side**, and **fail-open**: if Ollama is
unreachable, Spyglass quietly hides the AI affordances and the rest of
the tool keeps working. The LLM endpoints are rate-limited at 30/min/IP.

## Why local

The privacy posture of the rest of Spyglass requires that **no values from
the bid stream ever cross the user's tab boundary**. A hosted LLM (OpenAI,
Anthropic, Mistral) would mean shipping field paths and char-class hints
to a third party. Even though those carry no values, we'd need a separate
audit story per provider.

Ollama on a single LAN box keeps the whole stack honest: prompts touch
disk and RAM but never the public internet.

The chosen default model is **gemma4:e2b** (Google, Apache-2.0 license,
~7 GB on disk, ~8 GB RAM resident, ~5 GB host headroom on i7-7700-class
hardware). Switched from `qwen2.5:3b` on 2026-05-21 — Gemma 4 (released
April 2026, "effective 2B" Nano-class variant with 5.1B actual params)
benched 23% faster than qwen on the same 3-parallel bid-sim workload
(~24s vs ~34s), 39% faster on suggest-name, 3/3 JSON-validity in both
sequential and parallel runs. Ollama container memory limit was bumped
10G → 12G to accommodate the larger resident size. Small enough to run
on a 2017 mini-PC with no GPU, large enough to follow the narrow
JSON-output contract reliably under `format: 'json'`. Active model is
set via `OLLAMA_MODEL` env in
`docker-compose.yml`.

## Prerequisites

- Docker + Docker Compose v2.
- A box with at least **16 GB RAM** and **20 GB free disk**. CPU-only is
  fine (no GPU required); generation runs at ~10 tokens/sec on an i7-7700.
- The Spyglass repo (`/srv/DATA/Stacks/adtech-spyglass/` in the canonical
  deploy).

## Step 1 — Bring up Ollama as a separate Compose stack

The architectural choice is to run Ollama in its **own** compose project so
it can be shared across multiple consumers (Spyglass today, future tools
tomorrow) without one compose file becoming a mega-stack.

Create `/srv/DATA/Stacks/ollama/docker-compose.yml`:

```yaml
services:
  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    restart: always
    ports:
      # Bind to localhost only — no public exposure. Cross-stack
      # consumers reach this by joining ollama_default below.
      - '127.0.0.1:11434:11434'
    volumes:
      # Models live here. ~7 GB for gemma3:4b alone; budget more if
      # you pull additional tags.
      - /srv/DATA/AppData/ollama:/root/.ollama
    environment:
      # Optional perf knobs — defaults are fine on first install.
      # OLLAMA_NUM_THREAD: '4'        # cap CPU threads (quieter fan)
      # OLLAMA_KEEP_ALIVE: '5m'       # how long to keep model in RAM
    healthcheck:
      test:
        ['CMD-SHELL', 'wget -qO- --tries=1 --timeout=3 http://127.0.0.1:11434/api/tags > /dev/null']
      interval: 30s
      timeout: 5s
      retries: 3

# When Compose creates this stack it auto-generates a network named
# "<project>_default" — i.e. "ollama_default" when the directory is
# called "ollama". Spyglass joins this network as `external: true`.
```

Bring it up:

```bash
mkdir -p /srv/DATA/AppData/ollama
cd /srv/DATA/Stacks/ollama
docker compose up -d
docker network ls | grep ollama_default      # confirm network exists
```

## Step 2 — Pull the model

Pull the current default (gemma4:e2b):

```bash
docker exec ollama ollama pull gemma4:e2b
docker exec ollama ollama list                # confirm it appears
```

First pull takes 5-15 minutes for gemma4:e2b (~7 GB) depending on bandwidth.
Subsequent container restarts read from the bind-mount and the model is
available immediately.

## Step 3 — Verify the model works in isolation

```bash
docker exec ollama ollama run gemma4:e2b "Say hello in one word."
# Expected: "Hello"
```

If this prints a sensible reply, the model is healthy and Spyglass can
talk to it.

## Step 4 — Wire Spyglass to Ollama

Spyglass's `docker-compose.yml` already declares the cross-stack join:

```yaml
services:
  spyglass:
    environment:
      - OLLAMA_URL=http://ollama:11434
      - OLLAMA_MODEL=gemma4:e2b
    networks:
      - default
      - ollama_default # ← cross-stack join

networks:
  ollama_default:
    external: true # ← created by /srv/DATA/Stacks/ollama
```

Restart Spyglass to pick up the network attachment if it wasn't already
joined:

```bash
cd /srv/DATA/Stacks/adtech-spyglass
docker compose up -d --force-recreate
```

DNS resolution is by container name: from inside the Spyglass container,
`http://ollama:11434` resolves to the Ollama service. No host networking,
no published port on the Spyglass side, no firewall change needed.

## Step 5 — Smoke test from inside Spyglass

```bash
docker exec adtech-spyglass \
  wget -qO- --post-data='{"model":"gemma4:e2b","prompt":"hi","stream":false}' \
  --header='Content-Type: application/json' \
  http://ollama:11434/api/generate
```

If you see a JSON envelope with `"response": "..."`, the bridge is live.
Open the inspector, paste a payload, switch to the Discovery tab, and the
🤖 Suggest button should now produce names instead of staying hidden.

## Configuration knobs (env vars on the Spyglass side)

| Var                    | Default               | Effect                                                                                                                            |
| ---------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `OLLAMA_URL`           | `http://ollama:11434` | Where the bridge POSTs `/api/generate`. Trailing slashes stripped.                                                                |
| `OLLAMA_MODEL`         | `gemma4:e2b`          | Model tag. Any locally-pulled model that supports `format: 'json'` works. For low-RAM hosts that can't afford 8GB resident, fall back to `qwen2.5:3b` (~2GB) or smaller. |
| `OLLAMA_TIMEOUT_MS`    | `30000`               | Hard timeout per request via `AbortController`. 30s is conservative for gemma4:e2b on CPU (~14 tok/s).                            |
| `INTEL_MAX_PER_WINDOW` | `30`                  | Per-IP rate limit on `/api/intel/*` (per minute). Set to `0` to disable.                                                          |

## Operational posture

- **Acoustic budget**: under realistic usage (a few suggestions per
  Discovery session), gemma3:4b runs ~3 minutes/day total wall-clock
  on a fanless i7-7700. Audible fan ramp is brief.
- **Cold start**: first request after a container restart can take
  10-15 seconds while Ollama loads the model into RAM. The 30s
  `AbortController` covers this comfortably. Subsequent calls are
  cached in RAM for `OLLAMA_KEEP_ALIVE` (default 5 min).
- **Failure modes**:
  - Container down → `OllamaUnavailable` → 503 → frontend latches
    `_llmUnavailable=true` and hides AI affordances until tab reload.
  - Model not pulled → 503 with reason 'ollama responded 404'.
  - Slow network drip → 30s abort → 503.
  - LLM produced unparseable JSON → 502, reason 'unparseable'.
  - LLM produced valid JSON that fails our snake_case validator → 502,
    reason 'empty'.

## Updating the model

Models drift. To bump:

```bash
docker exec ollama ollama pull gemma3:8b      # try a bigger tag
docker exec ollama ollama list
# Update Spyglass: edit OLLAMA_MODEL in docker-compose.yml + restart
```

The cluster-name and field-purpose validators in `intel-llm.js` are
intentionally strict (snake_case regex + closed allow-list), so a model
that goes off-script gets rejected at the validator and degrades to
"no suggestion" rather than corrupting the user's dialect catalog.

## Removing the LLM bridge entirely

Spyglass runs cleanly without Ollama. To opt out:

1. Remove the `ollama_default` network attachment from Spyglass's
   `docker-compose.yml`.
2. Optionally unset `OLLAMA_URL` / `OLLAMA_MODEL`.
3. Restart. The 🤖 Suggest button hides on first call (503), and the
   per-field hover tooltips never appear.

The Discovery and Dialect Builder flows stay fully functional —
they're just LLM-free, name-the-cluster-yourself.
