#!/usr/bin/env bash
# Build the native Lua C modules the headless PoB bridge needs on macOS/Linux.
#
# Windows ships prebuilt .dll's inside the PathOfBuilding-PoE2 submodule (runtime/), so this
# script is a no-op there. On macOS/Linux only `lua-utf8` is required to boot the calc engine
# (every other module PoB requires at load time is pure Lua). We compile it into a vendored dir
# *outside* the submodule -- packages/pob-bridge/native/ -- so it survives `git submodule` resets
# and clean checkouts of the submodule. bridge.ts puts that dir first on LUA_CPATH.
#
# The source is pinned to an exact upstream commit and checksum-verified before compiling, so a
# re-run can't silently pull different C. Bump PIN + the SHA256s together to update.
#
# Usage: scripts/build-native.sh [--force]   (npm run build:native)
set -euo pipefail

# --- config -----------------------------------------------------------------------------------
# starwing/luautf8, pinned. `require('lua-utf8')` -> Lua strips through the last '-' -> the file
# is lua-utf8.so and the sought symbol is luaopen_utf8, which lutf8lib.c defines.
PIN="a47b1433473a2509d77ad28f59a976716d187927"
SHA_LUTF8LIB="d8d2677f0bfa19b36255be718bdce61af7546b388eb52c0521ca3a478195d070"
SHA_UNIDATA="5c86eaf858dd27cbe5dbc1cd2766844e66296554f75a9930a35b22445aa94c75"
RAW="https://raw.githubusercontent.com/starwing/luautf8/${PIN}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/packages/pob-bridge/native"
OUT_SO="${OUT_DIR}/lua-utf8.so"

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

# --- platform guard ---------------------------------------------------------------------------
UNAME="$(uname -s)"
case "$UNAME" in
	Darwin|Linux) ;;
	*)
		echo "build-native: $UNAME is not macOS/Linux -- the submodule's prebuilt .dll's are used there. Nothing to build."
		exit 0
		;;
esac

if [ "$FORCE" -eq 0 ] && [ -f "$OUT_SO" ]; then
	echo "build-native: $OUT_SO already present (use --force to rebuild)."
	exit 0
fi

# --- toolchain --------------------------------------------------------------------------------
# Honor $CC so a Linux cross-build can point at e.g. x86_64-linux-gnu-gcc / aarch64-linux-gnu-gcc.
CC="${CC:-cc}"
command -v "$CC" >/dev/null 2>&1 || { echo "build-native: C compiler '$CC' not on PATH." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "build-native: curl is required." >&2; exit 1; }
SHACMD=""
command -v shasum >/dev/null 2>&1 && SHACMD="shasum -a 256"
[ -z "$SHACMD" ] && command -v sha256sum >/dev/null 2>&1 && SHACMD="sha256sum"
[ -z "$SHACMD" ] && { echo "build-native: need shasum or sha256sum to verify sources." >&2; exit 1; }

# LuaJIT headers: prefer pkg-config, else probe the usual Homebrew / distro locations.
CFLAGS_LUA=""
if command -v pkg-config >/dev/null 2>&1 && pkg-config --exists luajit 2>/dev/null; then
	CFLAGS_LUA="$(pkg-config --cflags luajit)"
else
	for d in /opt/homebrew/include/luajit-2.1 /usr/local/include/luajit-2.1 /usr/include/luajit-2.1; do
		[ -f "$d/lua.h" ] && { CFLAGS_LUA="-I$d"; break; }
	done
fi
[ -z "$CFLAGS_LUA" ] && { echo "build-native: LuaJIT headers not found. Install luajit (brew install luajit / apt install libluajit-5.1-dev)." >&2; exit 1; }

# --- fetch + verify ---------------------------------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

verify() { # file expected-sha256
	local got
	got="$($SHACMD "$1" | awk '{print $1}')"
	[ "$got" = "$2" ] || { echo "build-native: checksum mismatch for $1" >&2; echo "  expected $2" >&2; echo "  got      $got" >&2; exit 1; }
}

echo "build-native: fetching lua-utf8 @ ${PIN:0:12} ..."
curl -fsSL -o "$TMP/lutf8lib.c" "${RAW}/lutf8lib.c"
curl -fsSL -o "$TMP/unidata.h"  "${RAW}/unidata.h"
verify "$TMP/lutf8lib.c" "$SHA_LUTF8LIB"
verify "$TMP/unidata.h"  "$SHA_UNIDATA"

# --- arch selection ---------------------------------------------------------------------------
# macOS: build a universal binary so one lua-utf8.so loads under both an arm64 (Apple Silicon)
# and an x86_64 (Intel, or Rosetta) LuaJIT. Because we link with -undefined dynamic_lookup, the
# Lua symbols resolve against the host engine at load time -- no per-arch LuaJIT lib is needed to
# build, only that the toolchain/SDK can target the slice. We probe each candidate and keep the
# ones `cc` actually accepts, so an Intel-only or arm64-only toolchain still produces what it can.
# Override the candidate list with NATIVE_ARCHS="arm64 x86_64" (space-separated) if needed.
#
# Linux: an .so is single-arch, and targeting a different arch is a toolchain choice, not a flag
# on the host cc -- set CC to a cross compiler (x86_64-linux-gnu-gcc, aarch64-linux-gnu-gcc, ...)
# to build for another arch. So there are no -arch flags here; the binary matches whatever CC is.
ARCH_FLAGS=""
if [ "$UNAME" = "Darwin" ]; then
	CANDIDATE_ARCHS="${NATIVE_ARCHS:-arm64 x86_64}"
	KEPT=""
	for a in $CANDIDATE_ARCHS; do
		if echo 'int main(void){return 0;}' | "$CC" -arch "$a" -x c - -o /dev/null >/dev/null 2>&1; then
			ARCH_FLAGS="$ARCH_FLAGS -arch $a"
			KEPT="$KEPT $a"
		else
			echo "build-native: toolchain can't target $a -- skipping that slice."
		fi
	done
	[ -z "$ARCH_FLAGS" ] && { echo "build-native: none of the requested arches ($CANDIDATE_ARCHS) are buildable." >&2; exit 1; }
	echo "build-native: building macOS universal binary for:${KEPT}"
fi

# --- compile ----------------------------------------------------------------------------------
# macOS Lua C modules are Mach-O bundles resolving Lua symbols from the host at load time; Linux
# wants a PIC shared object. Both name the output lua-utf8.so (Lua's C-module convention).
if [ "$UNAME" = "Darwin" ]; then
	LDFLAGS="-bundle -undefined dynamic_lookup"
else
	LDFLAGS="-shared -fPIC"
fi

mkdir -p "$OUT_DIR"
# shellcheck disable=SC2086
"$CC" -O2 $ARCH_FLAGS $LDFLAGS $CFLAGS_LUA "$TMP/lutf8lib.c" -o "$OUT_SO"

echo "build-native: built $OUT_SO"
command -v file >/dev/null 2>&1 && file "$OUT_SO" | sed 's/^/build-native: /'
