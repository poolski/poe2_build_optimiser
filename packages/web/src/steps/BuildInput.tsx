// Step 1: paste a PoB import code, or upload a .xml. Builds the BuildInput discriminated union
// and hands it up; the parent does the POST /api/builds (intake/web-ui/05-frontend.md screen 1).

import { useRef, useState } from "react";
import type { BuildInput as BuildInputDTO } from "@poe2/contract";

interface Props {
  onSubmit: (input: BuildInputDTO) => void;
  busy?: boolean;
  error?: string;
}

export default function BuildInput({ onSubmit, busy, error }: Props) {
  const [tab, setTab] = useState<"paste" | "upload">("paste");
  const [code, setCode] = useState("");
  const [xml, setXml] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSubmit = !busy && (tab === "paste" ? code.trim().length > 0 : xml.trim().length > 0);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(tab === "paste" ? { kind: "pobCode", code: code.trim() } : { kind: "xml", xml });
  };

  const readFile = (f: File) => {
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => setXml(String(reader.result ?? ""));
    reader.readAsText(f);
  };

  return (
    <div className="panel">
      <div className="tabs">
        <button className={tab === "paste" ? "on" : ""} onClick={() => setTab("paste")}>
          Paste code
        </button>
        <button className={tab === "upload" ? "on" : ""} onClick={() => setTab("upload")}>
          Upload .xml
        </button>
      </div>

      {tab === "paste" ? (
        <label>
          <span className="lbl">PoB export code &mdash; base64(zlib(xml))</span>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="eNp1kMtOwzAQRff9Ci..."
            rows={5}
          />
        </label>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) readFile(f);
          }}
          style={{
            border: `1px dashed ${dragOver ? "var(--gold)" : "var(--border)"}`,
            borderRadius: 6,
            padding: 24,
            textAlign: "center",
            color: "var(--text-dim)",
          }}
        >
          <p>{fileName ? `Loaded: ${fileName} (${xml.length} chars)` : "Drop a PoB .xml here, or"}</p>
          <button onClick={() => fileRef.current?.click()}>Choose file</button>
          <input
            ref={fileRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readFile(f);
            }}
          />
        </div>
      )}

      {error && <p className="warn">{error}</p>}

      <div style={{ marginTop: 14 }}>
        <button className="primary" disabled={!canSubmit} onClick={submit}>
          {busy ? "Loading…" : "Load build"}
        </button>
      </div>
    </div>
  );
}
