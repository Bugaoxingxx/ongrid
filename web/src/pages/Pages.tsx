// Pages — operations view for hosted "artifacts": pages the agent / workflows
// generate via serve_page. Pages are private (authed) — thumbnails + preview
// fetch the HTML with the bearer and render it via a sandboxed iframe srcdoc.
// Sharing is an explicit, TTL-bounded mint that returns a public login-free link
// (mirrors reports). Sandbox (iframe + server CSP) means an LLM page can never
// touch the SPA session.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Eye, Loader2, Search, Share2, Trash2 } from 'lucide-react';

import { deletePage, fetchPageHTML, listPages, sharePage, type HostedPage } from '@/api/pages';
import { useI18n } from '@/i18n/locale';
import { useAuth } from '@/store/auth';
import { PageHeader, Button, EmptyState } from '@/components/ui';
import { Modal } from '@/components/Modal';

const THUMB_W = 1100;

// PageThumb renders a page as a scaled-down thumbnail: it fetches the HTML (the
// route is authed) and draws it into a sandboxed srcdoc iframe scaled to the
// card width, pointer-events-none so it's a static picture.
function PageThumb({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) setScale(el.clientWidth / THUMB_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    fetchPageHTML(id)
      .then((h) => alive && setHtml(h))
      .catch(() => alive && setHtml('<!doctype html><body></body>'));
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <div ref={ref} className="relative h-40 w-full overflow-hidden bg-white">
      {html != null && (
        <iframe
          title="thumbnail"
          srcDoc={html}
          sandbox=""
          tabIndex={-1}
          scrolling="no"
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          style={{ width: THUMB_W, height: 900, transform: `scale(${scale})` }}
        />
      )}
    </div>
  );
}

export default function PagesPage() {
  const { tr } = useI18n();
  const role = useAuth((s) => s.role);
  const canWrite = role !== 'viewer';

  const [items, setItems] = useState<HostedPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<HostedPage | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await listPages();
      setItems(r.items ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load preview HTML (authed) when a page is opened.
  useEffect(() => {
    if (!preview) {
      setPreviewHtml(null);
      return;
    }
    let alive = true;
    setPreviewHtml(null);
    fetchPageHTML(preview.id)
      .then((h) => alive && setPreviewHtml(h))
      .catch(() => alive && setPreviewHtml('<!doctype html><body style="font-family:sans-serif;padding:2rem;color:#888">加载失败 / failed to load</body>'));
    return () => {
      alive = false;
    };
  }, [preview]);

  const onDelete = async (p: HostedPage) => {
    if (!window.confirm(tr(`删除页面「${p.title || p.id}」？分享链接将立即失效。`, `Delete page "${p.title || p.id}"? Its share links die immediately.`))) return;
    setBusyId(p.id);
    try {
      await deletePage(p.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  // Share mints a TTL-bounded public link and copies the absolute URL.
  const onShare = async (p: HostedPage) => {
    setSharingId(p.id);
    try {
      const r = await sharePage(p.id);
      const link = window.location.origin + r.path;
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        window.prompt(tr('复制此公开分享链接：', 'Copy this public share link:'), link);
      }
      setCopiedId(p.id);
      window.setTimeout(() => setCopiedId((c) => (c === p.id ? null : c)), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSharingId(null);
    }
  };
  const shareHint = tr(
    '生成 30 天有效的公开链接并复制：凭链接任何人可看、无需登录；删除该页即失效',
    'Mint + copy a 30-day public link: anyone with it can view, no login; delete the page to revoke',
  );

  const relTime = (iso: string) => {
    if (!iso) return '—';
    const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return tr('刚刚', 'just now');
    const m = Math.floor(sec / 60);
    if (m < 60) return tr(`${m} 分钟前`, `${m}m ago`);
    const h = Math.floor(m / 60);
    if (h < 24) return tr(`${h} 小时前`, `${h}h ago`);
    const d = Math.floor(h / 24);
    if (d < 30) return tr(`${d} 天前`, `${d}d ago`);
    return new Date(iso).toLocaleDateString();
  };

  const shown = items.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (p.title ?? '').toLowerCase().includes(q) || p.id.includes(q);
  });

  return (
    <main className="anim-fade flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title={tr('产物', 'Artifacts')}
        subtitle={tr(
          `Agent 与工作流通过 serve_page 生成的网页 · 共 ${items.length} 个`,
          `Web pages the agent & workflows generate via serve_page · ${items.length} total`,
        )}
      />
      {items.length > 0 && (
        <div className="border-b border-zinc-800 px-6 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative block w-64">
              <span className="sr-only">{tr('搜索', 'Search')}</span>
              <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tr('搜索页面…', 'Search pages…')}
                className="w-full rounded-md border border-zinc-800 bg-zinc-950/40 py-1.5 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
            </label>
            <span className="ml-auto text-xs text-zinc-500">
              {tr(`${items.length} 个 · 匹配 ${shown.length}`, `${items.length} total · ${shown.length} matched`)}
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <div className="mb-4 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">{error}</div>
        )}
        {loading ? (
          <div className="py-16 text-center text-xs text-zinc-500">{tr('加载中…', 'Loading…')}</div>
        ) : items.length === 0 ? (
          <EmptyState
            title={tr('还没有生成的页面', 'No generated pages yet')}
            hint={tr('让工作流或助理用 serve_page 生成一个网页报告，它会出现在这里。', 'Have a workflow or the assistant generate a web report via serve_page — it shows up here.')}
            className="flex flex-col items-center gap-2 py-20 text-center"
          />
        ) : shown.length === 0 ? (
          <div className="py-16 text-center text-xs text-zinc-500">{tr('无匹配的页面', 'No matching pages')}</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((p) => (
              <div
                key={p.id}
                className="group flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 transition-colors hover:border-zinc-700"
              >
                <button
                  type="button"
                  onClick={() => setPreview(p)}
                  className="relative block w-full border-b border-zinc-800 text-left"
                  title={tr('预览', 'Preview')}
                >
                  <PageThumb id={p.id} />
                  <span className="absolute inset-0 flex items-center justify-center bg-zinc-950/0 opacity-0 transition-opacity group-hover:bg-zinc-950/30 group-hover:opacity-100">
                    <span className="inline-flex items-center gap-1 rounded-md bg-zinc-900/90 px-2.5 py-1 text-xs font-medium text-zinc-100 ring-1 ring-inset ring-zinc-700">
                      <Eye size={13} /> {tr('预览', 'Preview')}
                    </span>
                  </span>
                </button>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-zinc-200" title={p.title}>
                      {p.title || tr('（未命名页面）', '(untitled page)')}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">{relTime(p.created_at)}</div>
                  </div>
                  <div className="mt-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void onShare(p)}
                      disabled={sharingId === p.id}
                      title={shareHint}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                        copiedId === p.id ? 'text-emerald-400' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      {sharingId === p.id ? <Loader2 size={13} className="animate-spin" /> : copiedId === p.id ? <Check size={13} /> : <Share2 size={13} />}
                      {copiedId === p.id ? tr('已复制', 'Copied') : tr('分享', 'Share')}
                    </button>
                    {canWrite && (
                      <Button
                        variant="danger"
                        onClick={() => void onDelete(p)}
                        disabled={busyId === p.id}
                        className="ml-auto whitespace-nowrap"
                      >
                        {busyId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && (
        <Modal open onClose={() => setPreview(null)} size="lg" title={preview.title || tr('页面预览', 'Page preview')}>
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-[11px] text-zinc-500">
              <span className="truncate font-mono">{preview.id}</span>
              <button
                type="button"
                onClick={() => void onShare(preview)}
                disabled={sharingId === preview.id}
                title={shareHint}
                className={`ml-auto inline-flex shrink-0 items-center gap-1 ${copiedId === preview.id ? 'text-emerald-400' : 'text-indigo-400 hover:text-indigo-300'}`}
              >
                {sharingId === preview.id ? <Loader2 size={11} className="animate-spin" /> : copiedId === preview.id ? <Check size={11} /> : <Share2 size={11} />}
                {copiedId === preview.id ? tr('已复制公开链接', 'Public link copied') : tr('生成分享链接', 'Share link')}
              </button>
            </div>
            {previewHtml == null ? (
              <div className="flex h-[60vh] w-full items-center justify-center rounded-md border border-zinc-800 bg-white text-xs text-zinc-400">
                <Loader2 size={16} className="mr-2 animate-spin" /> {tr('加载中…', 'Loading…')}
              </div>
            ) : (
              <iframe
                title={preview.title || 'page'}
                srcDoc={previewHtml}
                sandbox=""
                className="h-[60vh] w-full rounded-md border border-zinc-800 bg-white"
              />
            )}
          </div>
        </Modal>
      )}
    </main>
  );
}
