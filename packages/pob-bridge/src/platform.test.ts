import { describe, it, expect } from "vitest";
import { defaultLuajitPath, luaCModuleExt } from "./platform";

describe("defaultLuajitPath", () => {
	it("keeps the msys64/mingw64 build path on Windows", () => {
		expect(defaultLuajitPath("win32")).toBe("C:\\msys64\\mingw64\\bin\\luajit.exe");
	});

	it("relies on `luajit` from PATH on macOS", () => {
		// Homebrew (/opt/homebrew/bin, /usr/local/bin) all put it on PATH; spawn() resolves it.
		expect(defaultLuajitPath("darwin")).toBe("luajit");
	});

	it("relies on `luajit` from PATH on Linux", () => {
		expect(defaultLuajitPath("linux")).toBe("luajit");
	});
});

describe("luaCModuleExt", () => {
	it("is dll on Windows", () => {
		expect(luaCModuleExt("win32")).toBe("dll");
	});

	it("is so on macOS and Linux (Lua's C-module convention, not .dylib)", () => {
		expect(luaCModuleExt("darwin")).toBe("so");
		expect(luaCModuleExt("linux")).toBe("so");
	});
});
