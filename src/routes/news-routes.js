const {
  extractHashtags,
  getCategoryFromHashtags,
  getCategoryCounts,
  filterByCategory,
  getCategoryInfo,
  convertHashtagsToLinks
} = require("../news/utils/hashtag-helper");

const NEWS_BASE_PATH = "/tin-tuc";
const NEWS_ASSET_BASE_PATH = `${NEWS_BASE_PATH}/assets`;
const NEWS_NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, proxy-revalidate";

const createNewsRoutes = (app, deps) => {
  const {
    SEO_SITE_NAME,
    SEO_ROBOTS_INDEX,
    SEO_ROBOTS_NOINDEX,
    asyncHandler,
    buildSeoPayload,
    cssMinifier,
    crypto,
    express,
    fs,
    isJsMinifyEnabled,
    isNewsDatabaseConfigured,
    isProductionApp,
    minifyJs,
    newsDbAll,
    newsDbGet,
    path,
    team,
    toAbsolutePublicUrl
  } = deps;

  const newsProjectDir = path.join(__dirname, "..", "news");
  const newsPublicDir = path.join(newsProjectDir, "public");
  const newsCssDir = path.join(newsPublicDir, "css");
  const newsJsDir = path.join(newsPublicDir, "js");
  const newsViewsDir = path.join(newsProjectDir, "views");
  const newsDbConfigured = Boolean(isNewsDatabaseConfigured);
  const newsAssetNamePattern = /^[a-z0-9][a-z0-9._-]*$/i;

  const getMinifiedNewsCssPayload = (() => {
    const cssCache = new Map();

    return (fileName) => {
      const safeFileName = (fileName || "").toString().trim();
      if (!newsAssetNamePattern.test(safeFileName) || !safeFileName.toLowerCase().endsWith(".css")) {
        throw new Error("Invalid news css file name.");
      }

      const cssPath = path.join(newsCssDir, safeFileName);
      const stat = fs.statSync(cssPath);
      if (!stat.isFile()) {
        throw new Error("News stylesheet file unavailable.");
      }

      const mtimeMs = Number(stat.mtimeMs || 0);
      const cached = cssCache.get(safeFileName);
      if (cached && cached.mtimeMs === mtimeMs) {
        return cached.payload;
      }

      const sourceCss = fs.readFileSync(cssPath, "utf8");
      const result = cssMinifier.minify(sourceCss);
      if (Array.isArray(result.errors) && result.errors.length > 0) {
        throw new Error(result.errors.join("; "));
      }

      const minifiedCss = (result.styles || "").toString() || sourceCss;
      const payload = {
        content: minifiedCss,
        etag: `"${crypto.createHash("sha1").update(minifiedCss).digest("hex")}"`,
        lastModified: stat.mtime.toUTCString()
      };

      cssCache.set(safeFileName, {
        mtimeMs,
        payload
      });

      return payload;
    };
  })();

  const getMinifiedNewsJsPayload = (() => {
    const jsCache = new Map();

    return async (fileName) => {
      const safeFileName = (fileName || "").toString().trim();
      if (!newsAssetNamePattern.test(safeFileName) || !safeFileName.toLowerCase().endsWith(".js")) {
        throw new Error("Invalid news js file name.");
      }

      const scriptPath = path.join(newsJsDir, safeFileName);
      const stat = fs.statSync(scriptPath);
      if (!stat.isFile()) {
        throw new Error("News script file unavailable.");
      }

      const mtimeMs = Number(stat.mtimeMs || 0);
      const cached = jsCache.get(safeFileName);
      if (cached && cached.mtimeMs === mtimeMs) {
        return cached.payload;
      }

      const sourceJs = fs.readFileSync(scriptPath, "utf8");
      const result = await minifyJs(sourceJs, {
        compress: {
          passes: 2
        },
        mangle: true,
        format: {
          comments: false
        }
      });

      const minifiedJs = ((result && result.code) || "").toString().trim() || sourceJs;
      const payload = {
        content: minifiedJs,
        etag: `"${crypto.createHash("sha1").update(minifiedJs).digest("hex")}"`,
        lastModified: stat.mtime.toUTCString()
      };

      jsCache.set(safeFileName, {
        mtimeMs,
        payload
      });

      return payload;
    };
  })();

  if (fs.existsSync(newsPublicDir)) {
    if (isProductionApp) {
      app.get(`${NEWS_ASSET_BASE_PATH}/css/:fileName`, (req, res, next) => {
        const fileName = (req.params.fileName || "").toString().trim();
        if (!fileName) {
          return next();
        }

        try {
          const payload = getMinifiedNewsCssPayload(fileName);
          const requestEtag = (req.get("if-none-match") || "").toString();
          const requestModifiedSince = (req.get("if-modified-since") || "").toString();

          res.type("text/css; charset=utf-8");
          res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
          res.set("ETag", payload.etag);
          res.set("Last-Modified", payload.lastModified);
          res.set("X-Asset-Minified", "1");

          if (requestEtag.includes(payload.etag) || requestModifiedSince === payload.lastModified) {
            return res.status(304).end();
          }

          return res.send(payload.content);
        } catch (error) {
          if (error && error.code === "ENOENT") {
            return next();
          }
          console.warn(`Cannot serve minified ${NEWS_ASSET_BASE_PATH}/css/${fileName}.`, error);
          return next();
        }
      });
    }

    if (isJsMinifyEnabled) {
      app.get(`${NEWS_ASSET_BASE_PATH}/js/:fileName`, async (req, res, next) => {
        const fileName = (req.params.fileName || "").toString().trim();
        if (!fileName) {
          return next();
        }

        try {
          const payload = await getMinifiedNewsJsPayload(fileName);
          const requestEtag = (req.get("if-none-match") || "").toString();
          const requestModifiedSince = (req.get("if-modified-since") || "").toString();

          res.type("application/javascript; charset=utf-8");
          res.set(
            "Cache-Control",
            isProductionApp ? "public, max-age=86400, stale-while-revalidate=604800" : "no-cache"
          );
          res.set("ETag", payload.etag);
          res.set("Last-Modified", payload.lastModified);
          res.set("X-Asset-Minified", "1");

          if (requestEtag.includes(payload.etag) || requestModifiedSince === payload.lastModified) {
            return res.status(304).end();
          }

          return res.send(payload.content);
        } catch (error) {
          if (error && error.code === "ENOENT") {
            return next();
          }
          console.warn(`Cannot serve minified ${NEWS_ASSET_BASE_PATH}/js/${fileName}.`, error);
          return next();
        }
      });
    }

    app.use(
      NEWS_ASSET_BASE_PATH,
      express.static(newsPublicDir, {
        maxAge: isProductionApp ? "7d" : 0
      })
    );
  }

  const router = express.Router();

  const formatNewsDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = String(date.getFullYear());
    return `${day}/${month}/${year}`;
  };

  const normalizeMediaItem = (item) => {
    const normalized = item && typeof item === "object" ? { ...item } : {};
    const videoUrl = (normalized.video || "").toString().trim();
    const imageUrl = (normalized.image || "").toString().trim();
    const isVideoUrl = /\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(videoUrl);
    const rawId = normalized.id;
    const idText = rawId === null || rawId === undefined ? "" : String(rawId).trim();

    normalized.noidung = (normalized.noidung || "").toString();
    normalized.time = normalized.time || "";
    normalized.id = /^\d+$/.test(idText) ? idText : "0";
    normalized.video = isVideoUrl ? videoUrl : "";
    normalized.image = imageUrl || (!isVideoUrl ? videoUrl : "");
    return normalized;
  };

  const toNewsSectionUrl = (req, suffix = "") => {
    const base = toAbsolutePublicUrl(req, NEWS_BASE_PATH).replace(/\/+$/, "");
    const safeSuffix = (suffix || "").toString().replace(/^\/+/, "");
    if (!safeSuffix) return base;
    return `${base}/${safeSuffix}`;
  };

  const renderNewsTemplate = (req, res, templateName, payload = {}, statusCode = 200) => {
    const templatePath = path.join(newsViewsDir, `${templateName}.ejs`);
    res.status(statusCode);
    return res.render(templatePath, {
      ...payload,
      cspNonce: res.locals && res.locals.cspNonce ? res.locals.cspNonce : "",
      newsBasePath: NEWS_BASE_PATH,
      newsAssetPath: NEWS_ASSET_BASE_PATH,
      siteUrl: toNewsSectionUrl(req),
      mainSiteUrl: toAbsolutePublicUrl(req, "/"),
      formatNewsDate,
      extractHashtags,
      getCategoryFromHashtags,
      getCategoryInfo,
      convertHashtagsToLinks
    });
  };

  const renderNewsUnavailable = (req, res) => {
    return renderNewsTemplate(
      req,
      res,
      "404",
      {
        title: "Tin tức tạm thời gián đoạn"
      },
      503
    );
  };

  const renderMainNotFound = (req, res) => {
    return res.status(404).render("not-found", {
      title: "Không tìm thấy",
      team,
      seo: buildSeoPayload(req, {
        title: "Không tìm thấy",
        description: `Trang bạn yêu cầu không tồn tại trên ${SEO_SITE_NAME}.`,
        robots: SEO_ROBOTS_NOINDEX,
        canonicalPath: `${NEWS_BASE_PATH}${req.path || ""}`
      })
    });
  };

  router.use((req, res, next) => {
    res.set("Cache-Control", NEWS_NO_STORE_CACHE_CONTROL);
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    next();
  });

  router.get("/news/:id", (req, res) => {
    const id = (req.params.id || "").toString().trim();
    if (!id) {
      return res.redirect(302, NEWS_BASE_PATH);
    }
    return res.redirect(301, `${NEWS_BASE_PATH}/${encodeURIComponent(id)}`);
  });

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      if (!newsDbConfigured) {
        return renderNewsUnavailable(req, res);
      }

      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const category = (req.query.category || "all").toString().trim().toLowerCase() || "all";
      const limit = 10;
      const offset = (page - 1) * limit;

      const allNewsRows = await newsDbAll("SELECT * FROM news ORDER BY time DESC, id DESC");
      const allNews = allNewsRows.map(normalizeMediaItem);
      const filteredNews = filterByCategory(allNews, category);
      const totalNews = filteredNews.length;
      const totalPages = Math.max(1, Math.ceil(totalNews / limit));
      const paginatedNews = filteredNews.slice(offset, offset + limit);
      const categoryCounts = getCategoryCounts(allNews);
      const categoryInfo = getCategoryInfo(category);
      const seoImage = paginatedNews.length && paginatedNews[0].image
        ? paginatedNews[0].image
        : `${NEWS_ASSET_BASE_PATH}/images/avatar.svg`;

      return renderNewsTemplate(req, res, "index", {
        title: `${categoryInfo.name} - Tin tức Anime & Manga mới nhất`,
        seo: buildSeoPayload(req, {
          title: `${categoryInfo.name} - Tin tức Anime & Manga`,
          description: `Cập nhật tin tức Anime, Manga, Light Novel mới nhất mỗi ngày trên ${SEO_SITE_NAME}.`,
          canonicalPath: NEWS_BASE_PATH,
          image: seoImage,
          ogType: "website",
          robots: SEO_ROBOTS_INDEX,
          keywords: [
            "tin tức anime",
            "tin tức manga",
            "anime mới",
            "manga mới",
            "anime manga việt nam",
            SEO_SITE_NAME
          ]
        }),
        news: paginatedNews,
        currentPage: Math.min(page, totalPages),
        totalPages,
        category,
        categoryCounts,
        categoryInfo
      });
    })
  );

  router.get(
    "/:id(\\d+)",
    asyncHandler(async (req, res) => {
      if (!newsDbConfigured) {
        return renderNewsUnavailable(req, res);
      }

      const newsId = (req.params.id || "").toString().trim();
      if (!/^\d+$/.test(newsId)) {
        return renderMainNotFound(req, res);
      }

      try {
        if (BigInt(newsId) <= 0n) {
          return renderMainNotFound(req, res);
        }
      } catch (_error) {
        return renderMainNotFound(req, res);
      }

      const row = await newsDbGet("SELECT * FROM news WHERE id = ?", [newsId]);
      if (!row) {
        return renderMainNotFound(req, res);
      }

      const newsItem = normalizeMediaItem(row);
      const excerpt = newsItem.noidung.slice(0, 160).replace(/\s+/g, " ").trim();
      const seoImage = newsItem.image || `${NEWS_ASSET_BASE_PATH}/images/avatar.svg`;

      return renderNewsTemplate(req, res, "detail", {
        title: newsItem.noidung.slice(0, 60).trim(),
        seo: buildSeoPayload(req, {
          title: newsItem.noidung.slice(0, 70).trim(),
          description: excerpt,
          canonicalPath: `${NEWS_BASE_PATH}/${newsItem.id}`,
          image: seoImage,
          ogType: "article",
          robots: SEO_ROBOTS_INDEX,
          keywords: [
            "tin tức anime",
            "tin tức manga",
            newsItem.noidung.slice(0, 60)
          ]
        }),
        newsItem
      });
    })
  );

  router.get(
    "/api/news",
    asyncHandler(async (req, res) => {
      if (!newsDbConfigured) {
        return res.status(503).json({ ok: false, error: "Tin tức tạm thời gián đoạn." });
      }

      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(30, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
      const offset = (page - 1) * limit;
      const rows = await newsDbAll("SELECT * FROM news ORDER BY time DESC, id DESC LIMIT ? OFFSET ?", [limit, offset]);

      return res.json({
        ok: true,
        data: rows.map(normalizeMediaItem),
        page
      });
    })
  );

  router.get(
    "/sitemap.xml",
    asyncHandler(async (req, res) => {
      const baseUrl = toNewsSectionUrl(req);
      const urlEntries = [
        {
          loc: baseUrl,
          changefreq: "daily",
          priority: "0.8"
        }
      ];

      if (newsDbConfigured) {
        const rows = await newsDbAll("SELECT id, time FROM news ORDER BY time DESC, id DESC");
        rows.forEach((item) => {
          const id = (item && item.id !== undefined && item.id !== null ? String(item.id) : "").trim();
          if (!/^\d+$/.test(id)) return;

          const date = new Date(item.time);
          const lastmod = Number.isNaN(date.getTime()) ? "" : date.toISOString().split("T")[0];
          urlEntries.push({
            loc: `${baseUrl}/${id}`,
            lastmod,
            changefreq: "weekly",
            priority: "0.7"
          });
        });
      }

      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urlEntries.map((entry) => {
          const lines = [
            "  <url>",
            `    <loc>${entry.loc}</loc>`
          ];
          if (entry.lastmod) lines.push(`    <lastmod>${entry.lastmod}</lastmod>`);
          if (entry.changefreq) lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
          if (entry.priority) lines.push(`    <priority>${entry.priority}</priority>`);
          lines.push("  </url>");
          return lines.join("\n");
        }),
        "</urlset>"
      ].join("\n");

      res.type("application/xml");
      return res.send(xml);
    })
  );

  router.get("/robots.txt", (req, res) => {
    const baseUrl = toNewsSectionUrl(req);
    const robots = [
      "User-agent: *",
      "Allow: /",
      "",
      `Sitemap: ${baseUrl}/sitemap.xml`
    ].join("\n");

    res.type("text/plain");
    return res.send(robots);
  });

  router.get("/ads.txt", (_req, res) => {
    res.type("text/plain");
    return res.send("google.com, pub-6231599879955077, DIRECT, f08c47fec0942fa0");
  });

  router.use((req, res) => {
    if (req.path && req.path.startsWith("/api/")) {
      return res.status(404).json({ ok: false, error: "Không tìm thấy." });
    }
    return renderMainNotFound(req, res);
  });

  app.use(NEWS_BASE_PATH, router);
};

module.exports = createNewsRoutes;
