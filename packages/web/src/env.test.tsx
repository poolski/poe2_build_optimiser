import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Placeholder until real components land in phase 3. It proves the web package's test setup:
//   - JSX/TSX transform works           -> @vitejs/plugin-react (vitest.config.ts plugins)
//   - react resolves and renders        -> renderToStaticMarkup below
//   - the file runs in a DOM environment -> environmentMatchGlobs [["packages/web/**","jsdom"]]
// Phase 3 (05) will likely add @testing-library/react for interactive component tests.
function Hello({ name }: { name: string }) {
  return <p>hello {name}</p>;
}

describe("web test env", () => {
  it("transforms and renders JSX", () => {
    expect(renderToStaticMarkup(<Hello name="world" />)).toBe("<p>hello world</p>");
  });

  it("runs under jsdom (document + window present)", () => {
    expect(typeof document).toBe("object");
    expect(typeof window).toBe("object");
    const el = document.createElement("div");
    el.textContent = "ok";
    expect(el.textContent).toBe("ok");
  });
});
