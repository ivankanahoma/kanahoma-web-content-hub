import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  FileText,
  Info,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { invokeFunction } from "../lib/invoke";
import { readSource } from "../lib/articleSource";
import { renderArticle, validate } from "../lib/gutenberg";
import { applyTypos, buildCompanionFields, buildFlags } from "../lib/articleOutput";
import { slugify } from "../lib/gutenberg";

const HISTORY_KEY = "hub.articleGenerator.history";
const HISTORY_LIMIT = 10;

/** History is per browser, not per account: it never leaves this machine. */
function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return []; // a corrupted entry is not worth a crash on a tool that regenerates
  }
}

const LEVEL_ICON = {
  error: AlertTriangle,
  warn: AlertTriangle,
  action: Info,
  info: Info,
};

function CopyPanel({ title, hint, value, lines }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section className="output-panel">
      <header>
        <h3>{title}</h3>
        <span className="muted">{lines}</span>
        <button className="chip solid" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </header>
      <p className="section-intro">{hint}</p>
      <pre className="output-code">{value}</pre>
    </section>
  );
}

export default function ArticleGenerator() {
  const [file, setFile] = useState(null);
  const [pasted, setPasted] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(loadHistory);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  }, [history]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const source = await readSource({ file, text: pasted });
      const workingTitle = title.trim() || source.title || file?.name || "";

      // The model sees text and gets back indices. The prose never makes the return trip.
      const data = await invokeFunction("analyze-article", {
        title: workingTitle,
        nodes: source.nodes.map((n) => ({
          type: n.type,
          level: n.level,
          text: n.type === "list" ? n.items.map((i) => i.text).join(" • ") : n.text,
        })),
      });

      const { nodes, applied } = applyTypos(source.nodes, data.typos);
      const markup = renderArticle(nodes, data);
      const problems = validate(markup);

      const bios = data.authorBios ?? [];
      const fields = buildCompanionFields({ title: workingTitle, analysis: data, bios });
      const flags = buildFlags({
        analysis: data,
        nodes,
        bios,
        warnings: source.warnings,
        appliedTypos: applied,
        links: source.links,
        problems,
      });

      const slug = slugify(workingTitle || "article");
      setResult({ markup, fields, flags, slug, title: workingTitle,
                  blocks: nodes.length, problems });
      setHistory((rows) => [
        { at: new Date().toISOString(), title: workingTitle, slug,
          blocks: nodes.length, flags: flags.length, markup, fields },
        ...rows.filter((r) => r.slug !== slug),
      ].slice(0, HISTORY_LIMIT));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [file, pasted, title]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) { setFile(dropped); setPasted(""); }
  };

  const canGenerate = !busy && (file || pasted.trim().length > 40);

  return (
    <div className="tool">
      <div className="tool-input">
        <div
          className={`dropzone ${dragging ? "over" : ""} ${file ? "filled" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".docx,.md,.markdown,.txt"
            hidden
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) { setFile(picked); setPasted(""); }
            }}
          />
          {file ? <FileText size={20} strokeWidth={1.75} />
                : <Upload size={20} strokeWidth={1.75} />}
          <div>
            <strong>{file ? file.name : "Drop a .docx, .md or .txt"}</strong>
            <span className="muted">
              {file
                ? "Click to choose a different file"
                : "The file is read here and never uploaded"}
            </span>
          </div>
          {file && (
            <button
              className="chip"
              onClick={(e) => { e.stopPropagation(); setFile(null); }}
            >
              Clear
            </button>
          )}
        </div>

        <div className="or-paste">
          <span>or paste the article</span>
          <textarea
            rows={8}
            placeholder="Paste the article text. Markdown headings and lists are understood; plain text becomes paragraphs."
            value={pasted}
            onChange={(e) => { setPasted(e.target.value); if (e.target.value) setFile(null); }}
          />
        </div>

        <div className="tool-actions">
          <input
            className="search"
            placeholder="Working title (optional, only used to name the photo placeholder)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button className="chip solid" onClick={generate} disabled={!canGenerate}>
            <Wand2 size={14} />
            {busy ? "Reading the article…" : "Generate"}
          </button>
        </div>

        {error && <div className="state error">{error}</div>}
      </div>

      {result && (
        <>
          {result.flags.length > 0 && (
            <section className="flags">
              <h3 className="block-title">Before you publish</h3>
              <ul>
                {result.flags.map((flag, i) => {
                  const Icon = LEVEL_ICON[flag.level] ?? Info;
                  return (
                    <li key={i} className={`flag ${flag.level}`}>
                      <Icon size={14} strokeWidth={2} />
                      <span>{flag.text}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <CopyPanel
            title="Block markup"
            hint="Paste into the WordPress editor via Code Editor view. The post title is not
                  in here: it goes in the title field and becomes the H1."
            lines={`${result.blocks} blocks`}
            value={result.markup}
          />

          <CopyPanel
            title={`Companion fields — ${result.slug}-fields.txt`}
            hint="Everything that lives outside the content area. Work down it in the post
                  sidebar and the meta boxes."
            lines=""
            value={result.fields}
          />
        </>
      )}

      {history.length > 0 && (
        <section className="activity-block">
          <h3 className="block-title">Recent runs</h3>
          <p className="section-intro">
            Kept in this browser only, never uploaded. The last {HISTORY_LIMIT} runs.
          </p>
          <div className="plain-list">
            {history.map((run) => (
              <div className="plain-row" key={run.at}>
                <FileText size={14} strokeWidth={1.75} />
                <span className="grow">{run.title || run.slug}</span>
                <span className="muted">{run.blocks} blocks</span>
                <span className="muted">
                  {new Date(run.at).toLocaleDateString("en-US",
                    { month: "short", day: "numeric" })}
                </span>
                <button
                  className="chip"
                  onClick={() => setResult({
                    markup: run.markup, fields: run.fields, flags: [],
                    slug: run.slug, title: run.title, blocks: run.blocks, problems: [],
                  })}
                >
                  Reopen
                </button>
              </div>
            ))}
          </div>
          <button className="chip danger" onClick={() => setHistory([])}>
            <Trash2 size={14} /> Clear history
          </button>
        </section>
      )}
    </div>
  );
}
