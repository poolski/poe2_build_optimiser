# run-loop.ps1 — the capped runner for the maker/verifier loop (the HIGH-FIDELITY executor).
#
# Windows PowerShell port of run-loop.sh — no .ps1 template ships with groundrules 1.10.0, so this is
# hand-ported to match run-loop.sh's behavior exactly. Keep the two in sync if run-loop.sh changes.
#
# For a lighter, in-the-box loop on a single self-evident task, Claude Code's `/goal` is an alternative
# (it judges the transcript rather than re-running the oracle) — see loop/README.md "Two ways to run".
#
# Delivery: Claude Code (drives `claude -p` headless). Harness portability is a separate milestone.
#
# It replays loop/LOOP.md against a FRESH agent each iteration until one of:
#   - the agent reports "DONE: backlog empty" (natural stop), or
#   - the hard MAX iteration ceiling is hit (anti-runaway — MANDATORY, not optional).
#
# The model forgets between iterations; the repo remembers. All loop logic lives in the Markdown
# prompts (loop/LOOP.md, loop/maker.md, loop/verifier.md) — this script is the ONLY executable piece.
#
# Usage (run from the project root):
#   pwsh loop/run-loop.ps1 [-Max N] [-Prompt path/to/LOOP.md] [-WorkDir DIR]
#
# Defaults: -Max 5, -Prompt <this script's dir>/LOOP.md, -WorkDir current directory.

[CmdletBinding()]
param(
    [int]$Max = 5,
    [string]$Prompt = $(Join-Path $PSScriptRoot "LOOP.md"),
    [string]$WorkDir = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$DoneMarker = "DONE: backlog empty"

# Guard the cap: must be a positive integer, and refuse an absurd ceiling that defeats the purpose.
if ($Max -lt 1) {
    Write-Error "error: -Max must be a positive integer (got '$Max')"
    exit 2
}
if ($Max -gt 50) {
    Write-Error "error: -Max $Max exceeds the sanity ceiling of 50 (this is anti-runaway, on purpose)"
    exit 2
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Error "error: 'claude' CLI not found on PATH — this runner drives 'claude -p' headless."
    exit 127
}

Set-Location $WorkDir
Write-Host "loop: workdir=$WorkDir  prompt=$Prompt  max=$Max"

$promptText = Get-Content -Raw $Prompt

for ($i = 1; $i -le $Max; $i++) {
    Write-Host "──────── iteration $i / $Max ────────"

    # Each iteration is a FRESH headless agent invocation: no carried context, state read from disk.
    $out = & claude -p $promptText 2>&1 | Out-String
    Write-Host $out

    if ($out.Contains($DoneMarker)) {
        Write-Host "loop: natural stop — '$DoneMarker' at iteration $i."
        exit 0
    }
}

Write-Host "loop: hit MAX=$Max without an empty backlog. Stopping (anti-runaway)."
Write-Host "loop: inspect loop/backlog.md (unchecked tasks) and loop/blocked.md (parked decisions)."
exit 0
