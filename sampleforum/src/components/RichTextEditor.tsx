import { useEditor, EditorContent } from "@tiptap/react";
import { type Editor, Mark, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TiptapImage from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { NodeSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useRef, useState, memo, type ChangeEvent } from "react";
import {
  Bold, Italic, Underline as UnderlineIcon,
  Heading1, Heading2, Heading3,
  List, ListOrdered, Quote,
  ImageIcon, Link2,
  AlignLeft, AlignCenter, AlignRight,
  Check, Loader2, Smile, EyeOff,
} from "lucide-react";
import { fetchMentionCandidates, fetchStickerManifest } from "@/lib/forum-api";
import { normalizeForumContentHtml } from "@/lib/forum-content";

const EMOJI_LIST = [
  "😀","😁","😂","😅","😊","😍","😘","😭",
  "😡","🤔","👍","👏","🙏","🔥","✨","❤️",
];

const CLIENT_UPLOAD_MAX_FILE_BYTES = 12 * 1024 * 1024;
const CLIENT_UPLOAD_MAX_JSON_BYTES = 740 * 1024;
const CLIENT_RESIZE_MAX_HEIGHT = 1500;
const CLIENT_UPLOAD_WEBP_QUALITY = 0.6;
const FALLBACK_AVATAR_SRC = "/logobfang.svg";

const estimateDataUrlBytes = (dataUrl: string): number => {
  const payload = String(dataUrl || "").split(",")[1] || "";
  if (!payload) return 0;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
};

const readDraftFromStorage = (storageKey: string): string => {
  if (!storageKey) return "";
  try {
    return localStorage.getItem(storageKey) || "";
  } catch (_error) {
    return "";
  }
};

const writeDraftToStorage = (storageKey: string, value: string): boolean => {
  if (!storageKey) return false;
  try {
    localStorage.setItem(storageKey, value);
    return true;
  } catch (_error) {
    return false;
  }
};

const escapeHtml = (value: string): string =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const buildEditorHtmlFromPlainText = (value: string): string => {
  const normalized = String(value || "").replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return "";

  const lines = normalized.split("\n");
  const paragraphs: string[] = [];
  let currentParagraphLines: string[] = [];
  let pendingBlankLineCount = 0;

  const flushCurrentParagraph = () => {
    if (!currentParagraphLines.length) return;
    paragraphs.push(`<p>${currentParagraphLines.map((line) => escapeHtml(line)).join("<br />")}</p>`);
    currentParagraphLines = [];
  };

  for (const line of lines) {
    const isBlankLine = line.trim() === "";

    if (isBlankLine) {
      if (currentParagraphLines.length > 0 || pendingBlankLineCount > 0) {
        pendingBlankLineCount += 1;
      }
      continue;
    }

    if (pendingBlankLineCount > 0) {
      flushCurrentParagraph();
      for (let index = 0; index < pendingBlankLineCount; index += 1) {
        paragraphs.push("<p></p>");
      }
      pendingBlankLineCount = 0;
    }

    if (!currentParagraphLines.length) {
      currentParagraphLines = [line];
    } else {
      currentParagraphLines.push(line);
    }
  }

  flushCurrentParagraph();
  return paragraphs.join("");
};

export const normalizeDraftHtmlForEditor = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const hasHtmlTag = /<\/?[a-z][\s\S]*>/i.test(raw);

  if (!hasHtmlTag) {
    return /[\r\n]/.test(raw) ? buildEditorHtmlFromPlainText(raw) : raw;
  }

  if (!/[\r\n]/.test(raw)) return raw;
  return normalizeForumContentHtml(raw);
};

const SpoilerMark = Mark.create({
  name: "spoiler",
  parseHTML() {
    return [{ tag: "span.spoiler" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "spoiler" }), 0];
  },
});

const readFileAsDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Không thể đọc ảnh."));
    reader.readAsDataURL(file);
  });
};

const resizeImageForUpload = async (file: File): Promise<string> => {
  const sourceDataUrl = await readFileAsDataUrl(file);

  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      const sourceWidth = Number(image.width) || 0;
      const sourceHeight = Number(image.height) || 0;
      if (!sourceWidth || !sourceHeight) {
        reject(new Error("Không đọc được kích thước ảnh."));
        return;
      }

      const scale = sourceHeight > CLIENT_RESIZE_MAX_HEIGHT ? CLIENT_RESIZE_MAX_HEIGHT / sourceHeight : 1;
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Không thể xử lý ảnh trên trình duyệt."));
        return;
      }

      context.drawImage(image, 0, 0, width, height);
      let output = "";
      try {
        output = canvas.toDataURL("image/webp", CLIENT_UPLOAD_WEBP_QUALITY);
      } catch (_err) {
        output = "";
      }

      if (!output || output === "data:," || !output.startsWith("data:image/")) {
        output = sourceDataUrl;
      }

      resolve(output);
    };
    image.onerror = () => reject(new Error("Ảnh không hợp lệ hoặc không hỗ trợ."));
    image.src = sourceDataUrl;
  });
};

const isValidIpv4Host = (hostname: string): boolean => {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
  return hostname.split(".").every((segment) => {
    const value = Number(segment);
    return Number.isFinite(value) && value >= 0 && value <= 255;
  });
};

const isValidHostnameForLink = (hostname: string): boolean => {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized) return false;

  if (normalized === "localhost") return true;
  if (isValidIpv4Host(normalized)) return true;
  if (normalized.includes(":")) return true;
  if (!normalized.includes(".")) return false;

  return normalized
    .split(".")
    .every((label) => /^[a-z0-9-]{1,63}$/i.test(label) && !label.startsWith("-") && !label.endsWith("-"));
};

const renderChildrenAsMarkdown = (node: ParentNode, inPre = false): string => {
  return Array.from(node.childNodes)
    .map((child) => renderNodeAsMarkdown(child, inPre))
    .join("");
};

const renderNodeAsMarkdown = (node: Node, inPre = false): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    if (inPre) return text;
    return text.replace(/\s+/g, " ");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();

  if (tag === "br") return "\n";
  if (tag === "hr") return "\n---\n\n";

  if (tag === "strong" || tag === "b") {
    const inner = renderChildrenAsMarkdown(element, inPre).trim();
    return inner ? `**${inner}**` : "";
  }

  if (tag === "em" || tag === "i") {
    const inner = renderChildrenAsMarkdown(element, inPre).trim();
    return inner ? `*${inner}*` : "";
  }

  if (tag === "s" || tag === "strike" || tag === "del") {
    const inner = renderChildrenAsMarkdown(element, inPre).trim();
    return inner ? `~~${inner}~~` : "";
  }

  if (tag === "code") {
    const inner = inPre ? element.textContent || "" : renderChildrenAsMarkdown(element, inPre).trim();
    if (!inner) return "";
    return inPre ? inner : `\`${inner}\``;
  }

  if (tag === "pre") {
    const codeText = (element.textContent || "").replace(/\n+$/g, "");
    if (!codeText.trim()) return "";
    return `\n\`\`\`\n${codeText}\n\`\`\`\n\n`;
  }

  if (tag === "a") {
    const href = (element.getAttribute("href") || "").trim();
    const inner = renderChildrenAsMarkdown(element, inPre).trim() || href;
    if (!inner) return "";
    return href ? `[${inner}](${href})` : inner;
  }

  if (tag === "img") {
    const src = (element.getAttribute("src") || "").trim();
    const alt = (element.getAttribute("alt") || "").trim();
    if (!src) return alt;
    return `![${alt}](${src})`;
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1)) || 1;
    const inner = renderChildrenAsMarkdown(element, inPre).trim();
    if (!inner) return "";
    return `${"#".repeat(level)} ${inner}\n\n`;
  }

  if (tag === "blockquote") {
    const inner = renderChildrenAsMarkdown(element, inPre)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `> ${line}`)
      .join("\n");
    return inner ? `${inner}\n\n` : "";
  }

  if (tag === "ul" || tag === "ol") {
    const isOrdered = tag === "ol";
    const items = Array.from(element.children).filter((child) => child.tagName.toLowerCase() === "li");
    if (!items.length) {
      const fallback = renderChildrenAsMarkdown(element, inPre).trim();
      return fallback ? `${fallback}\n\n` : "";
    }

    const lines = items
      .map((item, index) => {
        const inner = renderChildrenAsMarkdown(item, inPre)
          .replace(/\s*\n\s*/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!inner) return "";
        return isOrdered ? `${index + 1}. ${inner}` : `- ${inner}`;
      })
      .filter(Boolean);

    return lines.length ? `${lines.join("\n")}\n\n` : "";
  }

  if (tag === "p" || tag === "div" || tag === "section" || tag === "article") {
    const inner = renderChildrenAsMarkdown(element, inPre).trim();
    return inner ? `${inner}\n\n` : "";
  }

  return renderChildrenAsMarkdown(element, inPre);
};

const convertHtmlToMarkdown = (html: string): string => {
  const raw = String(html || "").trim();
  if (!raw) return "";

  const doc = new DOMParser().parseFromString(raw, "text/html");
  const markdown = renderChildrenAsMarkdown(doc.body)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return markdown;
};

interface RichTextEditorProps {
  content?: string;
  onUpdate?: (html: string) => void;
  onPasteImageFile?: (file: File) => boolean;
  placeholder?: string;
  minHeight?: string;
  maxHeight?: string;
  compact?: boolean;
  autoFocus?: boolean;
  draftKey?: string;
  clearDraftOnUnmount?: boolean;
  mentionRootCommentId?: number;
  compactToolbarExtra?: React.ReactNode;
  footerContent?: React.ReactNode;
}

const ToolBtn = memo(function ToolBtn({ active, onClick, children, title, disabled = false }: {
  active?: boolean; onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); if (!disabled) onClick(); }}
      className={`p-1 rounded transition-colors ${
        disabled
          ? "text-muted-foreground/45 cursor-not-allowed"
          : active
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
      }`}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
});

export const RichTextEditor = memo(function RichTextEditor({
  content = "", onUpdate, placeholder = "Viết nội dung...",
  onPasteImageFile,
  minHeight = "200px", maxHeight, compact = false, autoFocus = false, draftKey,
  clearDraftOnUnmount = false,
  mentionRootCommentId,
  compactToolbarExtra,
  footerContent,
}: RichTextEditorProps) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiTab, setEmojiTab] = useState<"emoji" | "sticker">("emoji");
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionUsers, setMentionUsers] = useState<
    Array<{ id: number; username: string; name?: string; displayName?: string; avatarUrl?: string; roleLabel?: string }>
  >([]);
  const [stickerCatalog, setStickerCatalog] = useState<Array<{ code: string; label: string; src: string }>>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageUploadNotice, setImageUploadNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const [hasTextSelection, setHasTextSelection] = useState(false);
  const draftTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const draftStorageKey = draftKey ? `draft_${draftKey}` : "";

  const ensureTrailingParagraph = useCallback((editorInstance: Editor | null) => {
    if (!editorInstance) return;
    const editorState = editorInstance.state;
    const doc = editorState.doc;
    if (!doc.childCount) {
      return;
    }

    let trailingEmptyParagraphCount = 0;
    for (let index = doc.childCount - 1; index >= 0; index -= 1) {
      const node = doc.child(index);
      const isEmptyParagraph = node.type.name === "paragraph" && node.content.size === 0;
      if (!isEmptyParagraph) {
        break;
      }
      trailingEmptyParagraphCount += 1;
    }

    const trailingStartIndex = doc.childCount - trailingEmptyParagraphCount;
    const previousNode = trailingStartIndex > 0 ? doc.child(trailingStartIndex - 1) : null;
    const previousIsImage = Boolean(
      previousNode &&
        (previousNode.type.name === "image" ||
          (previousNode.type.name === "paragraph" &&
            previousNode.childCount === 1 &&
            previousNode.firstChild?.type?.name === "image"))
    );

    if (!previousIsImage || trailingEmptyParagraphCount > 0) {
      return;
    }

    const paragraphType = editorState.schema.nodes.paragraph;
    if (!paragraphType) {
      return;
    }

    const paragraphNode = paragraphType.createAndFill();
    if (!paragraphNode) {
      return;
    }

    editorInstance.view.dispatch(editorState.tr.insert(doc.content.size, paragraphNode));
  }, []);

  const initialContent = draftStorageKey
    ? normalizeDraftHtmlForEditor(readDraftFromStorage(draftStorageKey) || content)
    : normalizeDraftHtmlForEditor(content);

  const handleImageFile = useCallback(async (file: File, editorInstance: Editor | null) => {
    if (!file || !file.type.startsWith("image/")) return;

    if (file.size > CLIENT_UPLOAD_MAX_FILE_BYTES) {
      setImageUploadNotice({ type: "error", text: "Ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 12MB." });
      window.setTimeout(() => setImageUploadNotice(null), 2600);
      return;
    }

    setIsUploadingImage(true);
    setImageUploadNotice(null);
    try {
      const dataUrl = await resizeImageForUpload(file);
      const payloadBytes = estimateDataUrlBytes(dataUrl);
      if (!payloadBytes || payloadBytes > CLIENT_UPLOAD_MAX_JSON_BYTES) {
        throw new Error("Ảnh quá lớn sau khi nén. Vui lòng cắt nhỏ ảnh hoặc chọn ảnh khác.");
      }

      if (editorInstance) {
        const inserted = editorInstance
          .chain()
          .focus()
          .setImage({ src: dataUrl, alt: file.name || "Ảnh bài viết" })
          .run();

        if (!inserted) {
          throw new Error("Không thể chèn ảnh vào khung soạn thảo.");
        }
      }
      setImageUploadNotice({ type: "success", text: "Đã lưu ảnh tạm trên trình duyệt." });
    } catch (error) {
      setImageUploadNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Lưu ảnh tạm thất bại.",
      });
    } finally {
      setIsUploadingImage(false);
      window.setTimeout(() => setImageUploadNotice(null), 2200);
    }
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: "bg-muted rounded-md p-3 font-mono text-sm my-2" } },
        blockquote: { HTMLAttributes: { class: "border-l-2 border-primary pl-4 italic text-muted-foreground my-2" } },
      }),
      Underline,
      SpoilerMark,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline cursor-pointer" } }),
      TiptapImage.configure({
        allowBase64: true,
        HTMLAttributes: { class: "rounded-lg max-w-full my-2" },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialContent,
    autofocus: autoFocus,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onUpdate?.(html);

      // Check for @mention trigger
      const { from } = editor.state.selection;
      const textBefore = editor.state.doc.textBetween(Math.max(0, from - 20), from);
      const atMatch = textBefore.match(/@(\w*)$/);
      if (atMatch) {
        setMentionQuery(atMatch[1]);
        setShowMentions(true);
      } else {
        setShowMentions(false);
      }

      if (draftStorageKey) {
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        draftTimerRef.current = setTimeout(() => {
          const saved = writeDraftToStorage(draftStorageKey, html);
          if (!saved) {
            setImageUploadNotice({
              type: "error",
              text: "Không đủ bộ nhớ trình duyệt để lưu nháp. Hãy bớt ảnh hoặc đăng bài sớm hơn.",
            });
            window.setTimeout(() => setImageUploadNotice(null), 2600);
          }
        }, 1000);
      }
    },
    editorProps: {
      attributes: {
        class: compact
          ? "prose prose-invert prose-sm max-w-none break-words focus:outline-none text-foreground text-sm leading-relaxed"
          : "prose prose-invert prose-sm max-w-none break-words focus:outline-none text-foreground [&_p]:my-0 [&_p]:leading-relaxed",
        style: compact
          ? "min-height: 32px; overflow-wrap: anywhere; word-break: break-word;"
          : `min-height: ${minHeight};${maxHeight ? ` max-height: ${maxHeight};` : ""} overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; overflow-wrap: anywhere; word-break: break-word; padding-bottom: 5rem;`,
      },
      handleKeyDown: (view, event) => {
        if (event.key !== "Backspace" && event.key !== "Delete") {
          return false;
        }

        const { selection, doc } = view.state;
        if (!selection.empty) {
          return false;
        }

        const lastNode = doc.lastChild;
        if (!lastNode || lastNode.type.name !== "paragraph" || lastNode.content.size !== 0) {
          return false;
        }

        const previousNode = doc.childCount > 1 ? doc.child(doc.childCount - 2) : null;
        const previousIsImage = Boolean(
          previousNode &&
            (previousNode.type.name === "image" ||
              (previousNode.type.name === "paragraph" &&
                previousNode.childCount === 1 &&
                previousNode.firstChild?.type?.name === "image"))
        );

        if (!previousIsImage || selection.$from.parent !== lastNode) {
          return false;
        }

        const atParagraphStart = selection.$from.parentOffset === 0;
        const atParagraphEnd = selection.$from.parentOffset === lastNode.content.size;

        const getChildOffset = (childIndex: number): number => {
          let offset = 0;
          for (let index = 0; index < childIndex; index += 1) {
            offset += doc.child(index).nodeSize;
          }
          return offset;
        };

        if (event.key === "Backspace" && atParagraphStart) {
          const previousNodeIndex = doc.childCount - 2;
          if (previousNodeIndex >= 0) {
            const previousNodeOffset = getChildOffset(previousNodeIndex);
            const previousNodeSelection = NodeSelection.create(doc, previousNodeOffset);
            event.preventDefault();
            view.dispatch(view.state.tr.setSelection(previousNodeSelection).scrollIntoView());
            return true;
          }
        }

        if (event.key === "Delete" && atParagraphEnd) {
          event.preventDefault();
          return true;
        }

        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (!moved && event.dataTransfer?.files?.length) {
          const file = event.dataTransfer.files[0];
          if (file.type.startsWith("image/")) {
            event.preventDefault();
            if (editor) {
              void handleImageFile(file, editor);
            }
            return true;
          }
        }
        return false;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of Array.from(items)) {
            if (item.type.startsWith("image/")) {
              event.preventDefault();
              const file = item.getAsFile();
              if (file) {
                if (typeof onPasteImageFile === "function") {
                  const handled = onPasteImageFile(file);
                  if (handled) {
                    return true;
                  }
                }
                if (editor) {
                  void handleImageFile(file, editor);
                }
              }
              return true;
            }
          }
        }

        const plainPayload = event.clipboardData?.getData("text/plain") || "";
        if (plainPayload.trim() && /\r?\n/.test(plainPayload)) {
          event.preventDefault();
          const htmlToInsert = buildEditorHtmlFromPlainText(plainPayload);
          if (htmlToInsert && editor) {
            editor.chain().focus().insertContent(htmlToInsert).run();
          }
          return true;
        }

        const htmlPayload = (event.clipboardData?.getData("text/html") || "").trim();
        if (htmlPayload && /<\/?[a-z][\s\S]*>/i.test(htmlPayload)) {
          event.preventDefault();
          const markdown = convertHtmlToMarkdown(htmlPayload);
          const fallbackText = plainPayload.trim();
          const textToInsert = markdown || fallbackText;
          const htmlToInsert = buildEditorHtmlFromPlainText(textToInsert);
          if (htmlToInsert && editor) {
            editor.chain().focus().insertContent(htmlToInsert).run();
          }
          return true;
        }

        const trimmedPlainPayload = plainPayload.trim();
        if (trimmedPlainPayload && /<\/?[a-z][\s\S]*>/i.test(trimmedPlainPayload)) {
          event.preventDefault();
          const markdown = convertHtmlToMarkdown(trimmedPlainPayload);
          const normalizedText = markdown || trimmedPlainPayload.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          const htmlToInsert = buildEditorHtmlFromPlainText(normalizedText);
          if (htmlToInsert && editor) {
            editor.chain().focus().insertContent(htmlToInsert).run();
          }
          return true;
        }

        return false;
      },
    },
  });

  useEffect(() => {
    if (!editor) {
      setHasTextSelection(false);
      return;
    }

    const updateSelectionState = () => {
      const selection = editor.state.selection;
      setHasTextSelection(!selection.empty && selection.from !== selection.to);
    };

    updateSelectionState();
    editor.on("selectionUpdate", updateSelectionState);
    editor.on("transaction", updateSelectionState);

    return () => {
      editor.off("selectionUpdate", updateSelectionState);
      editor.off("transaction", updateSelectionState);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const handleTransaction = () => {
      ensureTrailingParagraph(editor);
    };

    handleTransaction();
    editor.on("transaction", handleTransaction);

    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor, ensureTrailingParagraph]);

  useEffect(() => {
    if (!editor) return;
    onUpdate?.(editor.getHTML());
  }, [editor, onUpdate]);

  useEffect(() => {
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      if (clearDraftOnUnmount && draftStorageKey) {
        try {
          localStorage.removeItem(draftStorageKey);
        } catch (_error) {
          // Ignore storage cleanup failures.
        }
      }
    };
  }, [clearDraftOnUnmount, draftStorageKey]);

  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowEmoji(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showEmoji]);

  useEffect(() => {
    if (!showLinkForm) return;
    if (!hasTextSelection) {
      setShowLinkForm(false);
    }
  }, [hasTextSelection, showLinkForm]);

  useEffect(() => {
    let cancelled = false;

    fetchStickerManifest()
      .then((items) => {
        if (!cancelled) {
          setStickerCatalog(Array.isArray(items) ? items : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStickerCatalog([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showMentions) {
      setMentionUsers([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const payload = await fetchMentionCandidates({
          query: mentionQuery,
          limit: 5,
          postId: mentionRootCommentId,
        });
        if (!cancelled) {
          setMentionUsers(Array.isArray(payload.users) ? payload.users : []);
        }
      } catch (_error) {
        if (!cancelled) {
          setMentionUsers([]);
        }
      }
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mentionQuery, showMentions, mentionRootCommentId]);

  const addImage = useCallback(() => {
    if (isUploadingImage) return;
    const picker = fileInputRef.current;
    if (!picker) return;
    picker.click();
  }, [isUploadingImage]);

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const picker = event.currentTarget;
      const file = picker.files?.[0];
      if (file && editor) {
        void handleImageFile(file, editor);
      }
      picker.value = "";
    },
    [editor, handleImageFile]
  );

  const openLinkForm = useCallback(() => {
    if (!editor || !hasTextSelection) {
      setShowLinkForm(false);
      return;
    }
    const currentHref = editor.getAttributes("link")?.href;
    setLinkUrl(typeof currentHref === "string" ? currentHref : "");
    setLinkError("");
    setShowLinkForm(true);
  }, [editor, hasTextSelection]);

  const submitLink = useCallback(() => {
    if (!editor || !hasTextSelection) return;
    const normalized = linkUrl.trim();
    if (!normalized) {
      setLinkError("Vui lòng nhập URL hợp lệ.");
      return;
    }
    let href = normalized;
    if (!/^https?:\/\//i.test(href)) {
      href = `https://${href}`;
    }

    try {
      const parsed = new URL(href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        setLinkError("Chỉ hỗ trợ liên kết http/https.");
        return;
      }
      if (!isValidHostnameForLink(parsed.hostname || "")) {
        setLinkError("URL phải là liên kết đầy đủ, ví dụ https://example.com.");
        return;
      }
    } catch (_err) {
      setLinkError("URL không hợp lệ.");
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setShowLinkForm(false);
    setLinkError("");
  }, [editor, hasTextSelection, linkUrl]);

  const clearLink = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setShowLinkForm(false);
    setLinkError("");
  }, [editor]);

  const insertEmoji = useCallback((emoji: string) => {
    editor?.chain().focus().insertContent(emoji).run();
    setShowEmoji(false);
  }, [editor]);

  const insertSticker = useCallback((url: string) => {
    editor?.chain().focus().setImage({ src: url }).run();
    setShowEmoji(false);
  }, [editor]);

  const toggleSpoiler = useCallback(() => {
    if (!editor || !hasTextSelection) return;
    editor
      .chain()
      .focus()
      .toggleMark("spoiler")
      .run();
  }, [editor, hasTextSelection]);

  const insertMention = useCallback((username: string) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(Math.max(0, from - 20), from);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      const deleteFrom = from - atMatch[0].length;
      editor.chain().focus()
        .deleteRange({ from: deleteFrom, to: from })
        .insertContent(`@${username} `)
        .run();
    }
    setShowMentions(false);
  }, [editor]);

  const filteredUsers = mentionUsers;

  if (!editor) return null;

  const ic = "h-3.5 w-3.5";

  return (
    <div
      className={`rounded-lg border border-border bg-secondary overflow-visible relative ${
        !compact ? "flex h-full min-h-0 flex-col" : ""
      }`}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-px flex-wrap border-b border-border px-1 py-0.5 bg-card/50">
        <ToolBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="In đậm">
          <Bold className={ic} />
        </ToolBtn>
        <ToolBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="In nghiêng">
          <Italic className={ic} />
        </ToolBtn>
        <ToolBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Gạch chân">
          <UnderlineIcon className={ic} />
        </ToolBtn>

        {!compact && (
          <>
            <div className="w-px h-4 bg-border mx-0.5" />
            <ToolBtn active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="H1">
              <Heading1 className={ic} />
            </ToolBtn>
            <ToolBtn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="H2">
              <Heading2 className={ic} />
            </ToolBtn>
            <ToolBtn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="H3">
              <Heading3 className={ic} />
            </ToolBtn>
          </>
        )}

        <div className="w-px h-4 bg-border mx-0.5" />

        <ToolBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Danh sách">
          <List className={ic} />
        </ToolBtn>
        <ToolBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Danh sách số">
          <ListOrdered className={ic} />
        </ToolBtn>

        {!compact && (
          <>
            <ToolBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Trích dẫn">
              <Quote className={ic} />
            </ToolBtn>
            <div className="w-px h-4 bg-border mx-0.5" />
            <ToolBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Căn trái">
              <AlignLeft className={ic} />
            </ToolBtn>
            <ToolBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Căn giữa">
              <AlignCenter className={ic} />
            </ToolBtn>
            <ToolBtn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Căn phải">
              <AlignRight className={ic} />
            </ToolBtn>
            <div className="w-px h-4 bg-border mx-0.5" />
            <ToolBtn onClick={addImage} title="Tải hình ảnh" disabled={isUploadingImage}>
              {isUploadingImage ? <Loader2 className={`${ic} animate-spin`} /> : <ImageIcon className={ic} />}
            </ToolBtn>
            <ToolBtn
              active={editor.isActive("link")}
              onClick={openLinkForm}
              title={hasTextSelection ? "Liên kết" : "Bôi đen văn bản để chèn liên kết"}
              disabled={!hasTextSelection}
            >
              <Link2 className={ic} />
            </ToolBtn>
          </>
        )}

        {compact && compactToolbarExtra ? (
          <>
            <div className="w-px h-4 bg-border mx-0.5" />
            {compactToolbarExtra}
          </>
        ) : null}

        <ToolBtn
          active={editor.isActive("spoiler")}
          onClick={toggleSpoiler}
          title={hasTextSelection ? "Spoiler" : "Bôi đen văn bản để chèn spoiler"}
          disabled={!hasTextSelection}
        >
          <EyeOff className={ic} />
        </ToolBtn>

        {/* Emoji picker */}
        <div className="relative ml-auto" ref={pickerRef}>
          <ToolBtn onClick={() => setShowEmoji(!showEmoji)} title="Emoji & Sticker">
            <Smile className={ic} />
          </ToolBtn>

          {showEmoji && (
            <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-xl z-50 w-60 animate-scale-in overflow-hidden">
              <div className="flex border-b border-border">
                <button
                  type="button"
                  onClick={() => setEmojiTab("emoji")}
                  className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
                    emojiTab === "emoji" ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Emoji
                </button>
                <button
                  type="button"
                  onClick={() => setEmojiTab("sticker")}
                  className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
                    emojiTab === "sticker" ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Sticker
                </button>
              </div>

              {emojiTab === "emoji" ? (
                <div className="grid grid-cols-8 gap-0 p-1.5 max-h-36 overflow-y-auto">
                  {EMOJI_LIST.map((e) => (
                    <button type="button" key={e} onClick={() => insertEmoji(e)} className="flex items-center justify-center w-7 h-7 hover:bg-accent rounded text-base transition-colors">
                      {e}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-2 max-h-40 overflow-y-auto">
                  {stickerCatalog.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground mb-1">Sticker</p>
                      <div className="grid grid-cols-4 gap-1">
                        {stickerCatalog.map((sticker) => (
                          <button
                            type="button"
                            key={sticker.code}
                            onClick={() => insertSticker(sticker.src)}
                            className="flex items-center justify-center p-1 hover:bg-accent rounded-md transition-colors"
                            title={sticker.label || sticker.code}
                          >
                            <img src={sticker.src} alt={sticker.label || sticker.code} className="w-8 h-8 max-w-full object-contain" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">Chưa tải được danh sách sticker.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!compact && (isUploadingImage || imageUploadNotice) ? (
        <div className="px-2.5 py-1 border-b border-border text-[11px]">
          {isUploadingImage ? (
            <span className="text-muted-foreground inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Đang xử lý ảnh...
            </span>
          ) : imageUploadNotice ? (
            <span
              className={`inline-flex items-center gap-1.5 ${
                imageUploadNotice.type === "success" ? "text-emerald-400" : "text-destructive"
              }`}
            >
              {imageUploadNotice.type === "success" ? <Check className="h-3 w-3" /> : null}
              {imageUploadNotice.text}
            </span>
          ) : null}
        </div>
      ) : null}

      {!compact && showLinkForm ? (
        <div className="px-2.5 py-2 border-b border-border bg-card/40 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={linkUrl}
              onChange={(event) => {
                setLinkUrl(event.target.value);
                if (linkError) setLinkError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitLink();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setShowLinkForm(false);
                }
              }}
              placeholder="https://example.com"
              className="flex-1 rounded-md bg-secondary border border-border text-xs px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={submitLink}
              className="text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Áp dụng
            </button>
            <button
              type="button"
              onClick={clearLink}
              className="text-xs px-2 py-1 rounded-md bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              Bỏ link
            </button>
          </div>
          {linkError ? <p className="text-[11px] text-destructive">{linkError}</p> : null}
        </div>
      ) : null}

      {/* Editor content */}
      <div className={compact ? "px-2.5 py-1.5" : "min-h-0 flex-1 overflow-hidden p-3"}>
        <EditorContent editor={editor} />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* @mention dropdown */}
      {showMentions && filteredUsers.length > 0 && (
        <div className="absolute left-4 bottom-full mb-1 bg-card border border-border rounded-lg shadow-xl z-50 min-w-[180px] py-1 animate-scale-in">
          {filteredUsers.map((u) => (
            <button
              type="button"
              key={u.id}
              onClick={() => insertMention(u.username)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors"
            >
              <img
                src={u.avatarUrl || FALLBACK_AVATAR_SRC}
                alt={u.username}
                className="w-5 h-5 rounded-full"
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = FALLBACK_AVATAR_SRC;
                }}
              />
              <span className="min-w-0 text-left">
                <span className="block truncate text-foreground font-medium">
                  {u.name || u.displayName || `@${u.username}`}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  @{u.username}{u.roleLabel ? ` · ${u.roleLabel}` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {footerContent ? (
        <div className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-secondary px-2.5 py-1 min-h-7 flex items-center">{footerContent}</div>
      ) : draftStorageKey && readDraftFromStorage(draftStorageKey) ? (
        <div className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-secondary px-2.5 py-1 min-h-7 flex items-center">
          <span className="text-xs text-muted-foreground">Bản nháp đã được tự động lưu</span>
        </div>
      ) : null}
    </div>
  );
});
