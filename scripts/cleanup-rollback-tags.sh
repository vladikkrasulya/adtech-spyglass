#!/usr/bin/env bash

# Retain the newest timestamped ortbtools rollback image tags. Candidates whose
# timestamps cannot be read are deliberately quarantined by retention: an
# unrankable rollback target is safer than an irreversible guess.
set -euo pipefail

LOG_FILE="${1:-/home/vk/.local/bin/cleanup.log}"
KEEP=10

cleanup_ortbtools_rollback_tags() {
    local list_output ref created created_epoch entry rest
    local known_count unknown_count remove_count i
    local -a refs=() entries=() sorted=()

    if ! list_output="$(docker image ls \
        --filter 'reference=ortbtools:rollback-pre-*' \
        --format '{{.Repository}}:{{.Tag}}' 2>&1)"; then
        printf 'WARNING: could not list ortbtools rollback tags; retaining all of them:\n%s\n' \
            "$list_output" | tee -a "$LOG_FILE"
        return 0
    fi

    while IFS= read -r ref; do
        [ -n "$ref" ] && refs+=("$ref")
    done <<< "$list_output"

    for ref in "${refs[@]}"; do
        if ! created="$(docker image inspect --format '{{.Created}}' "$ref" 2>&1)"; then
            printf 'WARNING: could not inspect %s; retaining it:\n%s\n' \
                "$ref" "$created" | tee -a "$LOG_FILE"
            continue
        fi
        if ! created_epoch="$(date --date="$created" '+%s%N' 2>/dev/null)"; then
            printf 'WARNING: could not parse creation time for %s (%s); retaining it.\n' \
                "$ref" "$created" | tee -a "$LOG_FILE"
            continue
        fi
        entries+=("${created_epoch}"$'\t'"${created}"$'\t'"${ref}")
    done

    known_count=${#entries[@]}
    unknown_count=$((${#refs[@]} - known_count))
    if ((known_count <= KEEP)); then
        printf 'Rollback tag retention: found %d tag(s); keeping all %d timestamped tag(s)' \
            "${#refs[@]}" "$known_count" | tee -a "$LOG_FILE"
        if ((unknown_count > 0)); then
            printf ' and %d tag(s) with unreadable timestamps' "$unknown_count" | tee -a "$LOG_FILE"
        fi
        printf '.\n' | tee -a "$LOG_FILE"
        return 0
    fi

    mapfile -t sorted < <(
        printf '%s\n' "${entries[@]}" \
            | LC_ALL=C sort -t $'\t' -k1,1nr -k3,3r
    )
    remove_count=$((known_count - KEEP))
    printf 'Rollback tag retention: found %d tag(s); keeping the 10 newest by image creation time and removing %d older tag(s)' \
        "${#refs[@]}" "$remove_count" | tee -a "$LOG_FILE"
    if ((unknown_count > 0)); then
        printf '; also retaining %d tag(s) with unreadable timestamps' "$unknown_count" | tee -a "$LOG_FILE"
    fi
    printf '.\n' | tee -a "$LOG_FILE"

    for ((i = KEEP; i < known_count; i++)); do
        entry="${sorted[$i]}"
        ref="${entry##*$'\t'}"
        rest="${entry#*$'\t'}"
        created="${rest%%$'\t'*}"
        printf 'Removing old rollback tag %s (image created %s)...\n' \
            "$ref" "$created" | tee -a "$LOG_FILE"
        if ! docker image rm "$ref" 2>&1 | tee -a "$LOG_FILE"; then
            printf 'WARNING: failed to remove rollback tag %s; continuing cleanup.\n' \
                "$ref" | tee -a "$LOG_FILE"
        fi
    done
}

cleanup_ortbtools_rollback_tags
