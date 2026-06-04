import { useCallback, useEffect, useState } from "react";
import {
  basename,
  error_message,
  open_externally,
  reveal_in_finder,
} from "@/lib/files";

interface EditorData {
  filePath?: string;
}

function read_data(): EditorData {
  return (window.muxy?.data ?? {}) as EditorData;
}

export function Editor() {
  const [data, setData] = useState<EditorData>(read_data);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep local state in sync with the tab's pushed data.
  useEffect(() => {
    const unsubscribe = muxy.onDataChange((next) => {
      setData((next ?? {}) as EditorData);
    });
    return unsubscribe;
  }, []);

  const { filePath } = data;

  // Load the file whenever the target path changes.
  useEffect(() => {
    if (!filePath) {
      setContent(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    muxy.files
      .read(filePath)
      .then((file) => {
        if (cancelled) return;
        setContent(file.content);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setContent(null);
        setError(error_message(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const onReveal = useCallback(() => {
    if (filePath) void reveal_in_finder(filePath);
  }, [filePath]);

  const onOpen = useCallback(() => {
    if (filePath) void open_externally(filePath);
  }, [filePath]);

  if (!filePath) {
    return (
      <div className="editor">
        <div className="editor-empty">No file open</div>
      </div>
    );
  }

  return (
    <div className="editor">
      <div className="editor-header">
        <span className="editor-filename">{basename(filePath)}</span>
        <div className="editor-actions">
          <button className="button" type="button" onClick={onReveal}>
            Reveal
          </button>
          <button className="button" type="button" onClick={onOpen}>
            Open
          </button>
        </div>
      </div>
      <div className="editor-body">
        {loading ? (
          <div className="editor-status">Loading…</div>
        ) : error ? (
          <div className="editor-status editor-error">{error}</div>
        ) : (
          <pre className="editor-content">{content}</pre>
        )}
      </div>
    </div>
  );
}
