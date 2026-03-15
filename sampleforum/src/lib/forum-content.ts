import MarkdownIt from "markdown-it";

const decodeHtmlEntities = (value: string): string => {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
};

const escapeHtml = (value: string): string => {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const readHtmlAttributeValue = (tagSource: string, attributeName: string): string => {
  const tag = String(tagSource || "");
  const name = String(attributeName || "").trim();
  if (!tag || !name) return "";

  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, "i");
  const matched = tag.match(pattern);
  if (!matched) return "";
  return String(matched[1] || matched[2] || matched[3] || "").trim();
};

const htmlToPlainText = (value: string): string => {
  const raw = String(value || "");
  const withBreaks = raw
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = readHtmlAttributeValue(tag, "src");
      if (!src) return "";
      const alt = readHtmlAttributeValue(tag, "alt").replace(/[\[\]()]/g, "").trim();
      return ` ![${alt}](${src}) `;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|blockquote|pre|ul|ol)\s*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");

  return decodeHtmlEntities(withBreaks)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const looksLikeMarkdown = (value: string): boolean => {
  const text = String(value || "").trim();
  if (!text) return false;

  return /(^|\n)\s{0,3}(#{1,6}\s|[-*]\s+|\d+\.\s+|>\s+|```)|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\[[^\]\n]+\]\([^)]+\)|\[[^\]\n]+\]\[[^\]\n]+\]|^\s*\[[^\]\n]+\]:\s*https?:\/\/|\[\d+\]\s*\n\s*\(https?:\/\/[^\s)]+\)|!\[[^\]]*\]\([^)]+\)|`[^`\n]+`/m.test(
    text
  );
};

const markdownParser = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

const defaultLinkOpenRule = markdownParser.renderer.rules.link_open;
markdownParser.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const hrefIndex = token.attrIndex("href");
  const href = hrefIndex >= 0 ? String(token.attrs?.[hrefIndex]?.[1] || "").trim() : "";
  if (href && /^(https?:\/\/|mailto:)/i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }

  if (defaultLinkOpenRule) {
    return defaultLinkOpenRule(tokens, idx, options, env, self);
  }
  return self.renderToken(tokens, idx, options);
};

const normalizeMarkdownArtifacts = (value: string): string => {
  return String(value || "")
    .replace(/\[(\d+)\]\s*\n\s*\((https?:\/\/[^\s)]+)\)/g, "[$1]($2)")
    .replace(/(^|\n)\s*\((https?:\/\/[^\s)]+)\)\s*(?=\n|$)/g, "$1[$2]($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const renderMarkdownToHtml = (value: string): string => {
  const source = normalizeMarkdownArtifacts(String(value || "").replace(/\r\n?/g, "\n"));
  if (!source) return "";
  return markdownParser.render(source).trim();
};

const renderPlainTextParagraphs = (value: string): string => {
  const text = String(value || "").trim();
  if (!text) return "";

  return text
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `<p>${escapeHtml(item).replace(/\n/g, "<br />")}</p>`)
    .join("");
};

const allowedForumTags = new Set([
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "blockquote",
  "pre",
  "code",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "span",
  "div",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

const sanitizeAnchorHref = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw, "http://localhost");
    if (parsed.origin === "http://localhost") {
      return `${parsed.pathname || "/"}${parsed.search || ""}${parsed.hash || ""}`;
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
      return parsed.toString();
    }
  } catch (_error) {
    return "";
  }

  return "";
};

const sanitizeImageSrc = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw, "http://localhost");
    if (parsed.origin === "http://localhost") {
      return `${parsed.pathname || "/"}${parsed.search || ""}${parsed.hash || ""}`;
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch (_error) {
    return "";
  }

  return "";
};

const sanitizeForumHtml = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw || typeof DOMParser !== "function") return "";

  const parsed = new DOMParser().parseFromString(raw, "text/html");
  const body = parsed.body;
  if (!body) return "";

  const elements = Array.from(body.querySelectorAll("*"));
  elements.forEach((element) => {
    const tagName = element.tagName.toLowerCase();

    if (!allowedForumTags.has(tagName)) {
      const fragment = parsed.createDocumentFragment();
      while (element.firstChild) {
        fragment.appendChild(element.firstChild);
      }
      element.replaceWith(fragment);
      return;
    }

    Array.from(element.attributes).forEach((attribute) => {
      const name = String(attribute.name || "").toLowerCase();
      if (!name || name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        return;
      }
      if (tagName === "a" && (name === "href" || name === "target" || name === "rel")) {
        return;
      }
      if (tagName === "img" && (name === "src" || name === "alt" || name === "title")) {
        return;
      }
      if (tagName === "span" && name === "class") {
        return;
      }
      if ((tagName === "p" || /^h[1-6]$/.test(tagName) || tagName === "div") && name === "style") {
        return;
      }
      element.removeAttribute(attribute.name);
    });

    if (tagName === "a") {
      const href = sanitizeAnchorHref(element.getAttribute("href") || "");
      if (!href) {
        element.removeAttribute("href");
        element.removeAttribute("target");
        element.removeAttribute("rel");
        return;
      }

      element.setAttribute("href", href);
      if (/^(https?:\/\/|mailto:)/i.test(href)) {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      } else {
        element.removeAttribute("target");
        element.removeAttribute("rel");
      }
    }

    if (tagName === "img") {
      const src = sanitizeImageSrc(element.getAttribute("src") || "");
      if (!src) {
        element.removeAttribute("src");
      } else {
        element.setAttribute("src", src);
      }
      const alt = String(element.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
      if (alt) {
        element.setAttribute("alt", alt);
      } else {
        element.removeAttribute("alt");
      }
      const title = String(element.getAttribute("title") || "").replace(/\s+/g, " ").trim();
      if (title) {
        element.setAttribute("title", title);
      } else {
        element.removeAttribute("title");
      }
    }

    if (tagName === "span") {
      const classNames = (element.getAttribute("class") || "")
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (classNames.includes("spoiler")) {
        element.setAttribute("class", "spoiler");
      } else {
        element.removeAttribute("class");
      }
    }

    if (tagName === "p" || /^h[1-6]$/.test(tagName) || tagName === "div") {
      const styleValue = (element.getAttribute("style") || "").toString();
      const textAlignMatch = styleValue.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center|justify)\s*(?:;|$)/i);
      if (!textAlignMatch) {
        element.removeAttribute("style");
      } else {
        element.setAttribute("style", `text-align: ${String(textAlignMatch[1]).toLowerCase()};`);
      }
    }

    if (tagName === "p" && element.childElementCount === 0) {
      const paragraphText = String(element.textContent || "").replace(/\u00a0/g, " ");
      if (!paragraphText.trim()) {
        element.textContent = "";
      }
    }
  });

  Array.from(body.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, blockquote")).forEach((element) => {
    if (!(element instanceof HTMLElement)) return;
    if (element.childElementCount > 0) return;

    const source = String(element.textContent || "");
    if (!/[\r\n]/.test(source)) return;
    if (!source.replace(/[\r\n]+/g, "").trim()) return;

    const normalized = source.replace(/\r\n?/g, "\n");
    const parts = normalized.split("\n");
    if (parts.length <= 1) return;

    element.textContent = "";
    parts.forEach((part, index) => {
      if (part) {
        element.appendChild(parsed.createTextNode(part));
      }
      if (index < parts.length - 1) {
        element.appendChild(parsed.createElement("br"));
      }
    });
  });

  return body.innerHTML.trim();
};

const hasNonMarkdownSafeHtmlSignals = (value: string): boolean => {
  const html = String(value || "").trim();
  if (!html) return false;
  if (/<(a|video|audio|picture|source|iframe|pre|code|blockquote|ul|ol|li|h[1-6]|hr|table|thead|tbody|tr|th|td)\b/i.test(html)) {
    return true;
  }
  return /<span\b[^>]*\bclass\s*=\s*(?:"[^"]*\bspoiler\b[^"]*"|'[^']*\bspoiler\b[^']*'|[^\s>]*\bspoiler\b[^\s>]*)/i.test(
    html
  );
};

const mentionRegex = /(^|[^a-z0-9_])@([a-z0-9_]{1,24})/gi;

type MentionDecoratedItem = {
  userId?: string;
  username?: string;
  name?: string;
  userColor?: string;
};

const normalizeMentionDisplayName = (name: string, username: string): string => {
  const normalized = String(name || "").replace(/\s+/g, " ").trim();
  if (!normalized) return `@${username}`;
  return normalized;
};

const buildMentionLookupMap = (mentionItems: MentionDecoratedItem[] = []): Map<string, MentionDecoratedItem> => {
  const list = Array.isArray(mentionItems) ? mentionItems : [];
  const map = new Map<string, MentionDecoratedItem>();

  list.forEach((item) => {
    const username = String(item && item.username ? item.username : "").trim().toLowerCase();
    if (!/^[a-z0-9_]{1,24}$/.test(username)) return;

    map.set(username, {
      userId: String(item && item.userId ? item.userId : "").trim(),
      username,
      name: normalizeMentionDisplayName(String(item && item.name ? item.name : ""), username),
      userColor: String(item && item.userColor ? item.userColor : "").trim(),
    });
  });

  return map;
};

const shouldSkipMentionDecoration = (element: Element | null): boolean => {
  let current = element;
  while (current) {
    const tag = current.tagName.toLowerCase();
    if (tag === "a" || tag === "code" || tag === "pre" || tag === "script" || tag === "style" || tag === "textarea") {
      return true;
    }
    current = current.parentElement;
  }
  return false;
};

const buildMentionFragment = (
  documentRef: Document,
  text: string,
  mentionLookupMap: Map<string, MentionDecoratedItem>
): DocumentFragment | null => {
  const source = String(text || "");
  if (!source || source.indexOf("@") === -1) return null;

  const fragment = documentRef.createDocumentFragment();
  let cursor = 0;
  let hasMention = false;
  mentionRegex.lastIndex = 0;
  let match = mentionRegex.exec(source);

  while (match) {
    const fullMatch = String(match[0] || "");
    const prefix = String(match[1] || "");
    const username = String(match[2] || "").trim().toLowerCase();
    if (!username) {
      match = mentionRegex.exec(source);
      continue;
    }

    const mentionData = mentionLookupMap.get(username) || null;
    if (!mentionData) {
      match = mentionRegex.exec(source);
      continue;
    }

    const matchStart = Number(match.index) || 0;
    const mentionStart = matchStart + prefix.length;
    if (matchStart > cursor) {
      fragment.appendChild(documentRef.createTextNode(source.slice(cursor, matchStart)));
    }

    if (prefix) {
      fragment.appendChild(documentRef.createTextNode(prefix));
    }

    const mentionNode = documentRef.createElement("a");
    mentionNode.className = "mention";
    mentionNode.href = `/user/${encodeURIComponent(username)}`;
    mentionNode.setAttribute("data-mention-username", username);
    if (mentionData.userId) {
      mentionNode.setAttribute("data-mention-user-id", mentionData.userId);
    }
    mentionNode.textContent = mentionData.name || `@${username}`;
    if (mentionData.userColor) {
      mentionNode.style.setProperty("color", mentionData.userColor);
    }
    fragment.appendChild(mentionNode);
    hasMention = true;

    cursor = mentionStart + (`@${username}`).length;
    match = mentionRegex.exec(source);
  }

  if (!hasMention) return null;
  if (cursor < source.length) {
    fragment.appendChild(documentRef.createTextNode(source.slice(cursor)));
  }

  return fragment;
};

const decorateMentionsInHtml = (html: string, mentionItems: MentionDecoratedItem[] = []): string => {
  const source = String(html || "").trim();
  if (!source || source.indexOf("@") === -1) return source;

  const mentionLookupMap = buildMentionLookupMap(mentionItems);

  if (typeof DOMParser !== "function") {
    return source;
  }

  const parsed = new DOMParser().parseFromString(source, "text/html");
  const body = parsed.body;
  if (!body) return source;

  const walker = parsed.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  textNodes.forEach((textNode) => {
    const parent = textNode.parentElement;
    if (!parent || shouldSkipMentionDecoration(parent)) return;

    const replacement = buildMentionFragment(parsed, textNode.nodeValue || "", mentionLookupMap);
    if (!replacement) return;
    parent.replaceChild(replacement, textNode);
  });

  return body.innerHTML;
};

export const normalizeForumContentHtml = (
  value: string,
  mentionItems: MentionDecoratedItem[] = []
): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const hasHtmlTag = /<\/?[a-z][\s\S]*>/i.test(raw);
  if (hasHtmlTag) {
    const plain = htmlToPlainText(raw);
    const sanitized = sanitizeForumHtml(raw);
    if (sanitized) {
      if (!hasNonMarkdownSafeHtmlSignals(sanitized) && looksLikeMarkdown(plain)) {
        return decorateMentionsInHtml(renderMarkdownToHtml(plain), mentionItems);
      }
      return decorateMentionsInHtml(sanitized, mentionItems);
    }

    if (looksLikeMarkdown(plain)) {
      return decorateMentionsInHtml(renderMarkdownToHtml(plain), mentionItems);
    }

    return decorateMentionsInHtml(renderPlainTextParagraphs(plain), mentionItems);
  }

  if (looksLikeMarkdown(raw)) {
    return decorateMentionsInHtml(renderMarkdownToHtml(raw), mentionItems);
  }

  return decorateMentionsInHtml(renderPlainTextParagraphs(raw), mentionItems);
};

export const toPlainTextForUi = (value: string): string => {
  return htmlToPlainText(value);
};

const stripEmbeddedImagePayloadsForMeasure = (value: string): string => {
  return String(value || "").replace(/<img\b[^>]*\bsrc\s*=\s*(["'])data:image\/[^"]+\1[^>]*>/gi, (tag) => {
    const alt = readHtmlAttributeValue(tag, "alt");
    return alt ? `<img alt="${escapeHtml(alt)}">` : "<img>";
  });
};

export const measureForumTextLength = (value: string): number => {
  const text = toPlainTextForUi(stripEmbeddedImagePayloadsForMeasure(value))
    .replace(/\s+/g, " ")
    .trim();
  return text.length;
};
