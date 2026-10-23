import { useEffect, useRef, useState } from 'react';
import { FileText, UploadSimple, WarningCircle, X } from '@phosphor-icons/react';
import type { KnowledgeBase } from '../types';
import { countKnowledge, type ImportDraft } from '../lib/importKnowledge';

interface ImportDialogProps {
  open: boolean;
  kb: KnowledgeBase;
  onClose: () => void;
  onImport: (draft: ImportDraft) => string | null;
}

const MAX_FILE_SIZE = 500_000;

export function ImportDialog({ open, kb, onClose, onImport }: ImportDialogProps) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const counts = countKnowledge(kb);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setText('');
    setFileName(undefined);
    setError(null);
    setDragActive(false);
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const readFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.txt') && !lower.endsWith('.md') && !lower.endsWith('.markdown')) {
      setError('仅支持导入 .txt、.md 或 .markdown 文件。');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('文件超过 500 KB。为保持本地索引轻量，请先拆分后再导入。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
      if (!title.trim()) {
        setTitle(file.name.replace(/\.[^.]+$/, ''));
      }
    } catch {
      setError('读取文件失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const submit = () => {
    if (!text.trim()) {
      setError('请粘贴正文或选择一个本地文本文件。');
      return;
    }
    if (text.trim().length < 12) {
      setError('正文至少需要 12 个可见字符。');
      return;
    }
    setError(null);
    const errorMessage = onImport({ title: title.trim(), text, fileName });
    if (errorMessage) setError(errorMessage);
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        data-testid="import-dialog"
        tabIndex={-1}
      >
        <div className="import-head">
          <div>
            <p className="eyebrow">LOCAL SOURCE</p>
            <h2 id="import-title">给蛛网添一份资料</h2>
            <p className="import-sub">文本只在当前浏览器内建立索引，不会上传到远程模型。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭导入面板">
            <X size={16} weight="regular" />
          </button>
        </div>

        <form
          className="import-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="field-label" htmlFor="import-name">
            主题名称
            <span>可选，留空时取正文开头</span>
          </label>
          <input
            id="import-name"
            className="text-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：检索系统设计笔记"
            autoFocus
          />

          <div
            className={`drop-zone${dragActive ? ' is-dragging' : ''}${fileName ? ' has-file' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void readFile(file);
            }}
          >
            <span className="drop-icon">
              {fileName ? <FileText size={20} weight="light" /> : <UploadSimple size={20} weight="light" />}
            </span>
            <div className="drop-copy">
              <strong>{fileName ?? (busy ? '正在读取文件…' : '拖入 TXT / Markdown，或选择文件')}</strong>
              <span>{fileName ? '文件内容已填入下方，可在导入前继续编辑' : 'Markdown 标题或空行会作为片段切分依据，最多 8 段'}</span>
            </div>
            <button
              type="button"
              className="small-button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              选择文件
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
                event.target.value = '';
              }}
            />
          </div>

          <label className="field-label" htmlFor="import-body">
            正文
            <span>{text.length.toLocaleString('zh-CN')} 字符</span>
          </label>
          <textarea
            id="import-body"
            className="text-area"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="粘贴你的笔记、说明或研究片段。内容将参与本地 BM25 索引。"
            rows={9}
          />

          {error ? (
            <div className="import-error" role="alert">
              <WarningCircle size={14} weight="regular" aria-hidden="true" />
              {error}
            </div>
          ) : null}

          <div className="import-guidance">
            <p>导入会新增一个独立主题、一个文档与最多 8 个可检索片段。</p>
            <p>当前查询快照保持只读；新资料会从下一次检索开始参与排名。</p>
          </div>

          <div className="import-footer">
            <div className="import-stats">
              <span>{counts.topics} 主题</span>
              <span>{counts.docs} 文档</span>
              <span>{counts.fragments} 片段</span>
            </div>
            <div className="import-actions">
              <button type="button" className="secondary-button" onClick={onClose}>
                取消
              </button>
              <button type="submit" className="primary-button" data-testid="commit-import">
                <UploadSimple size={15} weight="regular" aria-hidden="true" />
                加入知识库
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
