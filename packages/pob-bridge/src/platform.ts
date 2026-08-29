// OS detection for the LuaJIT child. The bridge was first built on Windows (msys64/mingw64), so
// the defaults here let the same code spawn a real bridge on macOS/Linux without any env override.

/**
 * Default LuaJIT executable when neither an explicit `luajitPath` nor `POB_LUAJIT_PATH` is set.
 *
 * Windows keeps the absolute msys64/mingw64 path the bridge was originally built against.
 * Everywhere else we return the bare command and let `spawn()` resolve it from PATH -- Homebrew
 * (`/opt/homebrew/bin`, `/usr/local/bin`) and distro packages all land there. Override with
 * `POB_LUAJIT_PATH` if luajit lives somewhere unusual.
 */
export function defaultLuajitPath(platform: NodeJS.Platform = process.platform): string {
	return platform === "win32" ? "C:\\msys64\\mingw64\\bin\\luajit.exe" : "luajit";
}

/**
 * Native Lua C-module extension for LUA_CPATH. Windows loads `.dll`; macOS and Linux both use
 * `.so` for Lua modules by convention (LuaJIT does not look for `.dylib`).
 */
export function luaCModuleExt(platform: NodeJS.Platform = process.platform): string {
	return platform === "win32" ? "dll" : "so";
}
