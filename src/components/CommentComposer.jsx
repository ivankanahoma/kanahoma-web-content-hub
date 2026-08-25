import { useRef, useState } from "react";
import { AtSign, ChevronUp, Link2, Lock, Mail, Paperclip, X } from "lucide-react";
import { invokeFunction } from "../lib/invoke";
import { SETTABLE_STATUSES } from "../lib/queue";

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
export default function CommentComposer({
  ticketId, requesterName, agents = [], onPosted,
}) {
  const [isPublic, setIsPublic] = useState(false);
  const [mentionQuery, setMentionQuery] = useState(null); // null = picker closed
  const [mentioned, setMentioned] = useState([]);
  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [posted, setPosted] = useState(false);
  const [empty, setEmpty] = useState(true);
  const [submitOpen, setSubmitOpen] = useState(false);

  const stop = (e) => e.stopPropagation();

  /** The text between the caret and the "@" that opened the picker, if any. */
  function readMentionQuery() {
    const selection = window.getSelection();
    if (!selection?.focusNode) return null;
    const upToCaret = String(selection.focusNode.textContent ?? "")
      .slice(0, selection.focusOffset);
    const match = /(?:^|\s)@([\w.-]*)$/.exec(upToCaret);
    return match ? match[1] : null;
  }

  const matches = mentionQuery == null ? [] : agents.filter((a) =>
    a.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6);

  /**
   * Replaces the half-typed "@que" with the full name. Mentions are plain text in the
   * comment; the notification comes from adding the person as a follower on the way out.
   */
  function pickMention(agent) {
    editorRef.current?.focus();
    for (let i = 0; i <= (mentionQuery?.length ?? 0); i++) {
      document.execCommand("delete", false);
    }
    document.execCommand("insertText", false, `@${agent.name} `);
    setMentioned((current) =>
      current.some((a) => a.id === agent.id) ? current : [...current, agent]);
    setMentionQuery(null);
    setEmpty(!editorRef.current?.textContent.trim());
  }

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

  async function send(status) {
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

      // Only the ones still written in the note: deleting the text removes the mention,
      // which is what someone would expect after taking the name back out.
      const text = editorRef.current?.textContent ?? "";
      const stillMentioned = isPublic
        ? []
        : mentioned.filter((a) => text.includes(`@${a.name}`)).map((a) => a.id);

      await invokeFunction("add-comment", {
        ticket_id: ticketId, html, attachments, public: isPublic,
        mentions: stillMentioned, status,
      });

      if (editorRef.current) editorRef.current.innerHTML = "";
      setFiles([]);
      setMentioned([]);
      setEmpty(true);
      setSubmitOpen(false);
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
            onClick={() => { setIsPublic(true); setMentionQuery(null); }}
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
        onInput={() => {
          setEmpty(!editorRef.current?.textContent.trim());
          setMentionQuery(isPublic ? null : readMentionQuery());
        }}
        onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
        onKeyDown={(e) => {
          stop(e);
          if (e.key === "Escape") setMentionQuery(null);
        }}
      />

      {matches.length > 0 && (
        <ul className="mention-picker">
          {matches.map((a) => (
            <li key={a.id}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pickMention(a); }}>
                <AtSign size={12} strokeWidth={2} /> {a.name}
              </button>
            </li>
          ))}
        </ul>
      )}

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
        {!isPublic && (
          <span className="note-hint">
            <AtSign size={12} strokeWidth={2} /> type @ to notify someone
          </span>
        )}
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

        {/* Zendesk's "submit as": the status is chosen at the moment of sending, so the
            two decisions that end a reply are one gesture rather than two. The trigger
            posts nothing on its own; one of the three does. */}
        <span
          className={`submit-as ${submitOpen ? "open" : ""}`}
          onMouseEnter={() => !nothingToSend && setSubmitOpen(true)}
          onMouseLeave={() => setSubmitOpen(false)}
        >
          <button
            className="button note-send"
            type="button"
            disabled={busy || nothingToSend}
            aria-haspopup="true"
            aria-expanded={submitOpen}
            onClick={() => setSubmitOpen((v) => !v)}
          >
            {busy ? "Sending…" : isPublic ? "Send public reply" : "Post note"}
            <ChevronUp size={13} strokeWidth={2} className="submit-chev" />
          </button>

          {submitOpen && !busy && (
            <span className="submit-menu" role="menu">
              {SETTABLE_STATUSES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitem"
                  className={`submit-option status-${option.value}`}
                  title={option.hint}
                  onClick={() => send(option.value)}
                >
                  <span className="dot" />
                  {option.label}
                </button>
              ))}
            </span>
          )}
        </span>
      </footer>
    </div>
  );
}
