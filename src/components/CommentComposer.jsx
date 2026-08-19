import { useRef, useState } from "react";
import { Link2, Lock, Mail, Paperclip, Send, X } from "lucide-react";
import { invokeFunction } from "../lib/invoke";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

/** Files travel as base64 in the JSON body, so they are read here rather than streamed. */
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

const prettySize = (bytes) => bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * The comment composer, open inside an expanded ticket rather than behind a button.
 *
 * It starts on Internal note and says so in three places at once: the switch, the cream
 * Zendesk colouring, and the Send button. Switching to Public reply changes all three,
 * because the whole box changing colour is what someone notices when they are not
 * reading. A public reply is emailed to the requester and cannot be unsent, so it also
 * asks once before sending; an internal note never does.
 */
export default function CommentComposer({ ticketId, requesterName, onPosted }) {
  const [isPublic, setIsPublic] = useState(false);
  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [posted, setPosted] = useState(false);
  const [empty, setEmpty] = useState(true);

  const stop = (e) => e.stopPropagation();

  /** Paste as plain text: whatever came from Word or a browser is not worth carrying. */
  const onPaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  };

  const addLink = () => {
    const url = window.prompt("Link to:", "https://");
    if (!url || !/^(https?:\/\/|mailto:)/i.test(url)) return;
    editorRef.current?.focus();
    // execCommand is deprecated and still the only thing every browser agrees on for
    // linking a selection inside a contenteditable.
    document.execCommand("createLink", false, url);
    setEmpty(!editorRef.current?.textContent.trim());
  };

  const onPick = async (e) => {
    setProblem(null);
    const picked = [...(e.target.files ?? [])];
    e.target.value = "";
    const tooBig = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setProblem(`${tooBig.name} is over 5 MB.`);
      return;
    }
    const next = [...files, ...picked];
    if (next.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) {
      setProblem("Those attachments add up to over 8 MB.");
      return;
    }
    setFiles(next);
  };

  async function send() {
    if (isPublic) {
      const who = requesterName ? `to ${requesterName}` : "to the requester";
      if (!window.confirm(
        `Send this as a public reply ${who}? They receive it by email and it cannot be ` +
        `unsent.`)) return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const html = editorRef.current?.innerHTML ?? "";
      const attachments = await Promise.all(files.map(async (f) => ({
        filename: f.name,
        contentType: f.type || "application/octet-stream",
        data: await readAsBase64(f),
      })));

      await invokeFunction("add-comment", {
        ticket_id: ticketId, html, attachments, public: isPublic,
      });

      if (editorRef.current) editorRef.current.innerHTML = "";
      setFiles([]);
      setEmpty(true);
      setPosted(true);
      setTimeout(() => setPosted(false), 2600);
      await onPosted?.();
    } catch (e) {
      setProblem(e.message);
    }
    setBusy(false);
  }

  const nothingToSend = empty && !files.length;

  return (
    <div className={`note-composer ${isPublic ? "is-public" : ""}`} onClick={stop}>
      <header>
        <span className="chip-pair note-switch">
          <button
            type="button"
            className="chip"
            aria-pressed={!isPublic}
            onClick={() => setIsPublic(false)}
          >
            <Lock size={12} strokeWidth={2} /> Internal note
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={isPublic}
            onClick={() => setIsPublic(true)}
          >
            <Mail size={12} strokeWidth={2} /> Public reply
          </button>
        </span>
        <span className="note-scope">
          {isPublic
            ? `Emailed to ${requesterName || "the requester"}`
            : "Not visible to the requester"}
        </span>
      </header>

      <div
        ref={editorRef}
        className="note-editor"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="Internal note"
        data-placeholder={isPublic ? "Write a reply to the requester…"
                            : "Write an internal note…"}
        onPaste={onPaste}
        onInput={() => setEmpty(!editorRef.current?.textContent.trim())}
        onKeyDown={stop}
      />

      {files.length > 0 && (
        <ul className="note-files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <Paperclip size={12} strokeWidth={2} />
              <span className="grow">{f.name}</span>
              <span className="muted">{prettySize(f.size)}</span>
              <button
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer>
        <button className="note-tool" onClick={addLink} title="Add a link" type="button">
          <Link2 size={16} strokeWidth={1.8} />
        </button>
        <button
          className="note-tool"
          onClick={() => fileRef.current?.click()}
          title="Attach a file"
          type="button"
        >
          <Paperclip size={16} strokeWidth={1.8} />
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={onPick} />

        <span className="grow">
          {posted && (
            <span className="note-posted">
              {isPublic ? "Reply sent" : "Note posted"}
            </span>
          )}
          {problem && <span className="inline-error">{problem}</span>}
        </span>

        <button
          className="button note-send"
          onClick={send}
          disabled={busy || nothingToSend}
          type="button"
        >
          <Send size={13} strokeWidth={2} />
          {busy ? "Sending…" : isPublic ? "Send public reply" : "Post note"}
        </button>
      </footer>
    </div>
  );
}
