import { useEffect, useRef, useState } from "react";
import { fetchForumLinkLabels } from "@/lib/forum-api";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { X } from "lucide-react";

type ForumRichContentProps = {
  html: string;
  className?: string;
  stripMedia?: boolean;
};

const toSafeText = (value: unknown): string => String(value == null ? "" : value).trim();

const parseComparablePath = (value: string): string => {
  const raw = toSafeText(value);
  if (!raw || typeof window === "undefined") return "";

  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return "";
    }

    const normalizedPath = (parsed.pathname || "/").replace(/\/+$/, "") || "/";
    return `${normalizedPath}${parsed.search || ""}`.toLowerCase();
  } catch (_error) {
    return "";
  }
};

const shouldReplaceAnchorText = (anchor: HTMLAnchorElement, hrefValue: string): boolean => {
  if (anchor.querySelector("img,svg,video,picture")) {
    return false;
  }

  const text = toSafeText(anchor.textContent);
  if (!text) return true;

  const comparableHref = parseComparablePath(hrefValue);
  const comparableText = parseComparablePath(text);

  if (comparableHref && comparableText && comparableHref === comparableText) {
    return true;
  }

  if (/^(https?:\/\/|www\.|\/)/i.test(text)) {
    return true;
  }

  return false;
};

const extractCandidateUrls = (html: string): string[] => {
  if (!html || typeof DOMParser !== "function") {
    return [];
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");
  const anchors = Array.from(parsed.body.querySelectorAll<HTMLAnchorElement>("a[href]"));
  if (!anchors.length) return [];

  return Array.from(
    new Set(
      anchors
        .map((anchor) => toSafeText(anchor.getAttribute("href") || anchor.href || ""))
        .filter(Boolean)
    )
  );
};

const removeEmbeddedMediaTags = (html: string): string => {
  const source = String(html || "");
  if (!source) return "";

  if (typeof DOMParser === "function") {
    const parsed = new DOMParser().parseFromString(source, "text/html");
    parsed.body
      .querySelectorAll("img, picture, source, video, audio, iframe, embed, object")
      .forEach((node) => {
        node.remove();
      });

    parsed.body.querySelectorAll("a").forEach((anchor) => {
      const hasVisualChildren = Boolean(anchor.querySelector("img,picture,source,video,audio,iframe,embed,object"));
      const text = toSafeText(anchor.textContent);
      if (!hasVisualChildren && text) return;
      if (!anchor.children.length && !text) {
        anchor.remove();
      }
    });

    return parsed.body.innerHTML;
  }

  return source
    .replace(/<\s*img\b[^>]*>/gi, "")
    .replace(/<\s*(picture|video|audio|iframe|embed|object)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*source\b[^>]*>/gi, "");
};

const resolveRenderedHtml = (html: string, stripMedia: boolean): string => {
  const source = String(html || "");
  return stripMedia ? removeEmbeddedMediaTags(source) : source;
};

export const ForumRichContent = ({ html, className, stripMedia = false }: ForumRichContentProps) => {
  const [renderedHtml, setRenderedHtml] = useState<string>(() => resolveRenderedHtml(html, stripMedia));
  const [viewerImage, setViewerImage] = useState<{ src: string; alt: string } | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const source = resolveRenderedHtml(html, stripMedia);
    setRenderedHtml(source);

    const candidateUrls = extractCandidateUrls(source);
    if (!candidateUrls.length || typeof DOMParser !== "function") {
      return;
    }

    let cancelled = false;

    const applyLabels = async () => {
      try {
        const labels = await fetchForumLinkLabels(candidateUrls);
        if (cancelled) return;

        const labelEntries = Object.entries(labels || {}).filter((entry) => toSafeText(entry[0]) && toSafeText(entry[1]));
        if (!labelEntries.length) {
          return;
        }

        const labelMap = new Map<string, string>(labelEntries.map(([url, label]) => [toSafeText(url), toSafeText(label)]));
        const parsed = new DOMParser().parseFromString(source, "text/html");
        const anchors = Array.from(parsed.body.querySelectorAll<HTMLAnchorElement>("a[href]"));
        if (!anchors.length) return;

        let changed = false;
        anchors.forEach((anchor) => {
          const hrefValue = toSafeText(anchor.getAttribute("href") || anchor.href || "");
          if (!hrefValue) return;

          const nextLabel = toSafeText(labelMap.get(hrefValue));
          if (!nextLabel) return;
          if (!shouldReplaceAnchorText(anchor, hrefValue)) return;
          if (toSafeText(anchor.textContent) === nextLabel) return;

          anchor.textContent = nextLabel;
          changed = true;
        });

        if (!changed || cancelled) {
          return;
        }

        setRenderedHtml(parsed.body.innerHTML);
      } catch (_error) {
        // ignore label failures, keep original content
      }
    };

    void applyLabels();

    return () => {
      cancelled = true;
    };
  }, [html, stripMedia]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    root.innerHTML = renderedHtml;
  }, [renderedHtml]);

  useEffect(() => {
    if (stripMedia) return;
    const root = contentRef.current;
    if (!root) return;

    const handleClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      const sourceUrl = toSafeText(target.getAttribute("src") || target.currentSrc || target.src || "");
      if (!sourceUrl || sourceUrl.includes("/stickers/")) return;
      setViewerImage({
        src: sourceUrl,
        alt: toSafeText(target.getAttribute("alt") || "Ảnh bài viết") || "Ảnh bài viết",
      });
    };

    root.addEventListener("click", handleClick);
    return () => {
      root.removeEventListener("click", handleClick);
    };
  }, [stripMedia]);

  return (
    <>
      <div ref={contentRef} className={className} />
      {!stripMedia ? (
        <Dialog open={Boolean(viewerImage)} onOpenChange={(open) => { if (!open) setViewerImage(null); }}>
          <DialogContent
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setViewerImage(null);
              }
            }}
            className="inset-0 left-0 top-0 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 items-center justify-center border-none bg-transparent p-0 shadow-none [&>button:not(.forum-image-viewer-close)]:hidden"
          >
            <DialogTitle className="sr-only">Xem ảnh gốc</DialogTitle>
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Đóng xem ảnh"
                onClick={() => setViewerImage(null)}
                className="forum-image-viewer-close fixed right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/72"
              >
                <X className="h-5 w-5" />
              </button>
            </DialogClose>
            {viewerImage ? (
              <img
                src={viewerImage.src}
                alt={viewerImage.alt}
                className="block h-auto max-h-screen w-auto max-w-[90vw] object-contain"
              />
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
};
