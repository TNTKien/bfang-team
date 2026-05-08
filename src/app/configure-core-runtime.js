const configureCoreRuntime = (app, deps) => {
  const {
    SEO_ROBOTS_INDEX,
    SEO_ROBOTS_NOINDEX,
    appRootDir,
    adminConfig,
    adultContentControlEnabled,
    asyncHandler,
    buildContentSecurityPolicy,
    buildSeoPayload,
    cacheBust,
    clearAllAuthSessionState,
    compression,
    crypto,
    cssMinifier,
    dbGet,
    ensureLeadingSlash,
    express,
    formatDate,
    formatDateTime,
    formatTimeAgo,
    fs,
    getAuthPublicConfigForRequest,
    isProductionApp,
    isServerSessionVersionMismatch,
    loadSessionUserById,
    parseEnvBoolean,
    passport,
    path,
    publicDir,
    requireSameOriginForAdminWrites,
    siteConfig,
    serverAssetVersion,
    session,
    sessionStore,
    sharp,
    stickersDir,
    trustProxy,
    uploadDir,
  } = deps;

app.set("view engine", "ejs");
  app.set("views", path.join(appRootDir, "views"));
if (trustProxy) {
  app.set("trust proxy", 1);
}
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const shouldCompressResponse = (req, res) => {
  const pathValue = ensureLeadingSlash(req && req.path ? req.path : "/");
  const acceptHeader = (req && req.headers && req.headers.accept ? req.headers.accept : "")
    .toString()
    .toLowerCase();

  if (pathValue === "/notifications/stream" || acceptHeader.includes("text/event-stream")) {
    return false;
  }

  return compression.filter(req, res);
};

const shouldPrepareInitialAuthState = (req) => {
  if (!req || req.method !== "GET") return false;
  const acceptHeader = (req.get("accept") || "").toString().toLowerCase();
  return acceptHeader.includes("text/html") || acceptHeader.includes("application/xhtml+xml");
};

const buildSignedOutInitialAuthState = () => ({
  hasServerState: true,
  signedIn: false,
  session: null
});

const loadInitialPublishNavState = async (userId) => {
  const safeUserId = (userId || "").toString().trim();
  if (!safeUserId || typeof dbGet !== "function") {
    return { inTeam: false };
  }

  const membership = await dbGet(
    `
      SELECT tm.team_id
      FROM translation_team_members tm
      JOIN translation_teams t ON t.id = tm.team_id
      WHERE tm.user_id = ?
        AND tm.status = 'approved'
        AND t.status = 'approved'
      ORDER BY CASE WHEN tm.role = 'leader' THEN 0 ELSE 1 END ASC, tm.reviewed_at DESC, tm.requested_at DESC
      LIMIT 1
    `,
    [safeUserId]
  );

  return {
    inTeam: Boolean(membership && membership.team_id)
  };
};

const buildInitialAuthStateForRequest = async (req) => {
  if (!shouldPrepareInitialAuthState(req)) {
    return null;
  }

  const authUserId = (req && req.session && req.session.authUserId ? req.session.authUserId : "")
    .toString()
    .trim();
  if (!authUserId) {
    return buildSignedOutInitialAuthState();
  }

  try {
    const user = typeof loadSessionUserById === "function" ? await loadSessionUserById(authUserId) : null;
    if (!user || !user.id) {
      return buildSignedOutInitialAuthState();
    }

    const publishNav = await loadInitialPublishNavState(user.id);

    return {
      hasServerState: true,
      signedIn: true,
      session: {
        user
      },
      publishNav
    };
  } catch (error) {
    console.warn("Cannot prepare initial auth state.", error);
    return buildSignedOutInitialAuthState();
  }
};

const staticImageFilePattern = /\.(avif|gif|jpe?g|png|svg|webp)$/i;
const staticImageCacheControl = "public, max-age=31536000, immutable";
const staticUploadCacheControl = "public, max-age=604800, stale-while-revalidate=86400";
const coverVariantFileNamePattern = /^[a-z0-9][a-z0-9._-]*\.(avif|jpe?g|png|webp)$/i;
const coverVariantCacheFilePattern = /^([a-z0-9][a-z0-9._-]*)\.([a-f0-9]{16})\.webp$/i;
const coverVariantRootDir = path.join(uploadDir, "covers", ".variants");
const coverVariantEncodingVersion = "v3";
const coverVariantDir = path.join(coverVariantRootDir, coverVariantEncodingVersion);
const coverVariantMaxFilesPerSource = 18;
const coverVariantMaxAgeMs = 21 * 24 * 60 * 60 * 1000;
const coverVariantCleanupIntervalMs = 6 * 60 * 60 * 1000;
const coverVariantRatioProfiles = [
  { key: "r4x3", value: 4 / 3 },
  { key: "r3x2", value: 3 / 2 }
];
const inFlightCoverVariantBuilds = new Map();

if (!fs.existsSync(coverVariantDir)) {
  fs.mkdirSync(coverVariantDir, { recursive: true });
}

const parseVariantNumber = (value, min, max) => {
  const parsed = Number.parseInt((value == null ? "" : String(value)).trim(), 10);
  if (!Number.isFinite(parsed)) return 0;
  const lower = Number.isFinite(min) ? Math.floor(min) : parsed;
  const upper = Number.isFinite(max) ? Math.floor(max) : parsed;
  return Math.min(Math.max(parsed, lower), upper);
};

const buildVariantDimensionBuckets = () => {
  const values = [];
  const pushRange = (start, end, step) => {
    for (let value = start; value <= end; value += step) {
      values.push(value);
    }
  };

  pushRange(120, 300, 6);
  pushRange(304, 480, 8);
  pushRange(492, 800, 12);
  pushRange(820, 1400, 20);

  return values;
};

const coverVariantDimensionBuckets = buildVariantDimensionBuckets();

const snapVariantDimension = (value, min, max) => {
  const parsed = parseVariantNumber(value, min, max);
  if (!parsed) return 0;

  for (const bucket of coverVariantDimensionBuckets) {
    if (bucket >= parsed) {
      return Math.min(bucket, max);
    }
  }

  return max;
};

const normalizeVariantQuality = (value) => {
  const parsed = parseVariantNumber(value, 55, 100);
  if (!parsed) return 95;
  if (parsed >= 97) return 100;
  if (parsed >= 93) return 95;
  if (parsed >= 89) return 90;
  if (parsed >= 84) return 85;
  return 80;
};

const resolveCoverVariantRatio = (width, height) => {
  if (!width || !height) {
    return null;
  }

  const requestedRatio = height / width;
  let bestMatch = null;

  coverVariantRatioProfiles.forEach((profile) => {
    const delta = Math.abs(requestedRatio - profile.value);
    if (!bestMatch || delta < bestMatch.delta) {
      bestMatch = { profile, delta };
    }
  });

  if (bestMatch && bestMatch.delta <= 0.08) {
    return bestMatch.profile;
  }

  const normalizedRatio = Math.round(requestedRatio * 1000) / 1000;
  return {
    key: `r${String(normalizedRatio).replace(/\./g, "_")}`,
    value: normalizedRatio
  };
};

const cleanupCoverVariantCache = async () => {
  let rootEntries = [];
  try {
    rootEntries = await fs.promises.readdir(coverVariantRootDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  await Promise.all(
    rootEntries.map(async (entry) => {
      const entryName = (entry && entry.name ? entry.name : "").toString();
      const entryPath = path.join(coverVariantRootDir, entryName);

      if (entry && entry.isFile && entry.isFile() && coverVariantCacheFilePattern.test(entryName)) {
        await fs.promises.unlink(entryPath).catch(() => undefined);
        return;
      }

      if (entry && entry.isDirectory && entry.isDirectory() && entryName !== coverVariantEncodingVersion) {
        await fs.promises.rm(entryPath, { recursive: true, force: true }).catch(() => undefined);
      }
    })
  );

  let versionEntries = [];
  try {
    versionEntries = await fs.promises.readdir(coverVariantDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  const variantFiles = [];
  for (const entry of versionEntries) {
    if (!entry || !entry.isFile || !entry.isFile()) continue;
    const entryName = (entry.name || "").toString();
    const match = coverVariantCacheFilePattern.exec(entryName);
    if (!match) continue;

    const filePath = path.join(coverVariantDir, entryName);
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) continue;

    variantFiles.push({
      filePath,
      fileName: entryName,
      sourceKey: match[1].toLowerCase(),
      mtimeMs: Number(stat.mtimeMs || 0)
    });
  }

  const now = Date.now();
  const staleFiles = [];
  const groupedFiles = new Map();

  variantFiles.forEach((file) => {
    if (file.mtimeMs && now - file.mtimeMs > coverVariantMaxAgeMs) {
      staleFiles.push(file.filePath);
      return;
    }

    const currentGroup = groupedFiles.get(file.sourceKey) || [];
    currentGroup.push(file);
    groupedFiles.set(file.sourceKey, currentGroup);
  });

  const overflowFiles = [];
  groupedFiles.forEach((filesForSource) => {
    filesForSource.sort((left, right) => right.mtimeMs - left.mtimeMs);
    filesForSource.slice(coverVariantMaxFilesPerSource).forEach((file) => {
      overflowFiles.push(file.filePath);
    });
  });

  const filesToDelete = [...new Set([...staleFiles, ...overflowFiles])];
  await Promise.all(filesToDelete.map((targetPath) => fs.promises.unlink(targetPath).catch(() => undefined)));
};

cleanupCoverVariantCache().catch((error) => {
  console.warn("Cannot clean cover variant cache.", error);
});

setInterval(() => {
  cleanupCoverVariantCache().catch((error) => {
    console.warn("Cannot clean cover variant cache.", error);
  });
}, coverVariantCleanupIntervalMs).unref();

app.use(
  compression({
    threshold: 1024,
    filter: shouldCompressResponse
  })
);

const forceSecureCookie = parseEnvBoolean(process.env.SESSION_COOKIE_SECURE, isProductionApp);
const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const enableCsp = parseEnvBoolean(process.env.CSP_ENABLED, true);
const cspReportOnly = parseEnvBoolean(process.env.CSP_REPORT_ONLY, false);
const applyNoStoreResponseHeaders = (res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("CDN-Cache-Control", "no-store");
  res.set("Cloudflare-CDN-Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
};

if (isProductionApp && forceSecureCookie && !trustProxy) {
  console.warn("APP_ENV=production + SESSION_COOKIE_SECURE=true; nếu chạy sau reverse proxy, hãy đặt TRUST_PROXY=1.");
}

app.use((req, res, next) => {
  const nonce = crypto.randomBytes(18).toString("base64");
  res.locals.cspNonce = nonce;

  if (enableCsp) {
    const policy = buildContentSecurityPolicy(nonce);
    if (cspReportOnly) {
      res.set("Content-Security-Policy-Report-Only", policy);
    } else {
      res.set("Content-Security-Policy", policy);
    }
  }

  if (isProductionApp && req.secure) {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
});

app.use((req, res, next) => {
  const pathValue = ensureLeadingSlash(req.path || "/");
  const isAdminPath = pathValue === "/admin" || pathValue.startsWith("/admin/");
  const isAccountPath = pathValue === "/account" || pathValue.startsWith("/account/");
  const isAuthPath = pathValue.startsWith("/auth/");
  const isPrivatePath = isAdminPath || isAccountPath || isAuthPath;
  const robotsValue = isPrivatePath ? SEO_ROBOTS_NOINDEX : SEO_ROBOTS_INDEX;

  res.locals.authPublicConfig = getAuthPublicConfigForRequest(req);
  res.locals.assetVersion = app.locals.assetVersion;
  res.locals.siteConfig = siteConfig;
  res.locals.newsPageEnabled = Boolean(app.locals && app.locals.newsPageEnabled);
  res.locals.forumPageEnabled = Boolean(app.locals && app.locals.forumPageEnabled);
  res.locals.adultContentControlEnabled = Boolean(adultContentControlEnabled);

  res.locals.seo = buildSeoPayload(req, {
    canonicalPath: pathValue,
    robots: robotsValue,
    ogType: pathValue === "/" ? "website" : "article"
  });
  res.locals.requestPath = pathValue;
  res.locals.isAdminPath = isAdminPath;

  if (isPrivatePath) {
    res.set("X-Robots-Tag", SEO_ROBOTS_NOINDEX);
    applyNoStoreResponseHeaders(res);
  }

  next();
});

app.use(
  session({
    store: sessionStore,
    name: "bfang.sid",
    secret: adminConfig.sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: trustProxy,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: forceSecureCookie,
      maxAge: SESSION_COOKIE_MAX_AGE_MS
    }
  })
);
app.use(passport.initialize());
app.use((req, _res, next) => {
  if (isServerSessionVersionMismatch(req)) {
    clearAllAuthSessionState(req);
  }
  next();
});
app.use((req, res, next) => {
  const authPublicConfig =
    res.locals && res.locals.authPublicConfig && typeof res.locals.authPublicConfig === "object"
      ? { ...res.locals.authPublicConfig }
      : {};

  buildInitialAuthStateForRequest(req)
    .then((initialState) => {
      if (initialState) {
        authPublicConfig.initialState = initialState;
      }
      res.locals.authPublicConfig = authPublicConfig;
      next();
    })
    .catch((error) => {
      console.warn("Cannot attach initial auth state.", error);
      res.locals.authPublicConfig = authPublicConfig;
      next();
    });
});
app.use((req, res, next) => {
  const originalRender = res.render.bind(res);
  res.render = (...args) => {
    res.vary("Cookie");
    const authUserId = (req && req.session && req.session.authUserId ? req.session.authUserId : "")
      .toString()
      .trim();
    if (authUserId) {
      applyNoStoreResponseHeaders(res);
    }
    return originalRender(...args);
  };
  next();
});

const browserImageCompressionAssetPath = path.join(
  appRootDir,
  "node_modules",
  "browser-image-compression",
  "dist",
  "browser-image-compression.js"
);
const browserImageCompressionFallbackAssetPath = path.join(
  publicDir,
  "vendor",
  "browser-image-compression",
  "browser-image-compression.js"
);

const sendBrowserImageCompressionFallback = (res) => {
  if (fs.existsSync(browserImageCompressionFallbackAssetPath)) {
    return res.sendFile(browserImageCompressionFallbackAssetPath);
  }
  return res.send("window.imageCompression = window.imageCompression || null;");
};
app.use(requireSameOriginForAdminWrites);
  app.use("/vendor/emoji-mart", express.static(path.join(appRootDir, "node_modules", "emoji-mart")));
  app.use(
    "/vendor/emoji-mart-data",
    express.static(path.join(appRootDir, "node_modules", "@emoji-mart", "data"))
  );
app.get("/vendor/browser-image-compression/browser-image-compression.js", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  res.type("application/javascript; charset=utf-8");

  if (!fs.existsSync(browserImageCompressionAssetPath)) {
    return sendBrowserImageCompressionFallback(res);
  }

  return res.sendFile(browserImageCompressionAssetPath, (error) => {
    if (error && !res.headersSent) {
      sendBrowserImageCompressionFallback(res);
    }
  });
});
const stickerManifestFilePattern = /^([a-z0-9_-]+)\.(png|webp|gif|jpe?g|avif)$/i;

const buildStickerLabel = (code) => {
  const raw = (code || "").toString().trim();
  if (!raw) return "Sticker";

  return raw
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      if (/^\d+$/.test(part)) {
        return part.padStart(2, "0");
      }
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
};

const readStickerManifest = async () => {
  let entries = [];
  try {
    entries = await fs.promises.readdir(stickersDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry && entry.isFile && entry.isFile())
    .map((entry) => {
      const fileName = (entry.name || "").toString().trim();
      const matched = stickerManifestFilePattern.exec(fileName);
      if (!matched) return null;
      const code = matched[1].toLowerCase();
      return {
        code,
        label: buildStickerLabel(code),
        src: `/stickers/${fileName}`
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.code.localeCompare(right.code, "en", { numeric: true, sensitivity: "base" }));
};

app.get(
  "/stickers/manifest.json",
  asyncHandler(async (req, res) => {
    try {
      const stickers = await readStickerManifest();
      const payload = { stickers };
      const payloadText = JSON.stringify(payload);
      const etag = `"${crypto.createHash("sha1").update(payloadText).digest("hex")}"`;
      const requestEtag = (req.get("if-none-match") || "").toString();

      res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      res.set("ETag", etag);

      if (requestEtag.includes(etag)) {
        return res.status(304).end();
      }

      return res.json(payload);
    } catch (error) {
      console.warn("Cannot build sticker manifest.", error);
      return res.status(500).json({
        error: "Không thể tải danh sách sticker."
      });
    }
  })
);

app.use(
  "/stickers",
  express.static(stickersDir, {
    maxAge: "365d",
    immutable: true
  })
);

const getMinifiedStylesheetPayload = (() => {
  const stylesheetPath = path.join(publicDir, "styles.css");
  let cachedMtimeMs = -1;
  let cachedPayload = null;

  return () => {
    const stat = fs.statSync(stylesheetPath);
    const mtimeMs = Number(stat.mtimeMs || 0);
    if (cachedPayload && cachedMtimeMs === mtimeMs) {
      return cachedPayload;
    }

    const sourceCss = fs.readFileSync(stylesheetPath, "utf8");
    const result = cssMinifier.minify(sourceCss);
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      throw new Error(result.errors.join("; "));
    }

    const minifiedCss = (result.styles || "").toString() || sourceCss;
    const etag = `"${crypto.createHash("sha1").update(minifiedCss).digest("hex")}"`;
    const lastModified = stat.mtime.toUTCString();
    cachedMtimeMs = mtimeMs;
    cachedPayload = {
      css: minifiedCss,
      etag,
      lastModified
    };
    return cachedPayload;
  };
})();

if (isProductionApp) {
  app.get("/styles.css", (req, res, next) => {
    try {
      const payload = getMinifiedStylesheetPayload();
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

      return res.send(payload.css);
    } catch (error) {
      console.warn("Cannot serve minified /styles.css in production.", error);
      return next();
    }
  });
}

const builtRootScriptDir = path.join(publicDir, "build", "js");
const builtRootScriptNamePattern = /^[a-z0-9_-]+$/i;

const sendBuiltRootScript = (scriptName, cacheControl = null) => (req, res, next) => {
  const safeScriptName = (scriptName || "").toString().trim();
  if (!builtRootScriptNamePattern.test(safeScriptName)) {
    return next();
  }

  const scriptPath = path.join(builtRootScriptDir, `${safeScriptName}.js`);
  if (!fs.existsSync(scriptPath)) {
    return next();
  }

  res.type("application/javascript; charset=utf-8");
  res.set(
    "Cache-Control",
    cacheControl || (isProductionApp ? "public, max-age=86400, stale-while-revalidate=604800" : "no-cache")
  );
  res.set("X-Asset-Built-By", "vite");
  return res.sendFile(scriptPath, (error) => {
    if (!error) return;
    if (error.code === "ENOENT") {
      return next();
    }
    return next(error);
  });
};

app.get("/sw.js", (_req, res, next) => {
  res.type("application/javascript; charset=utf-8");
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.set("Service-Worker-Allowed", "/");
  return sendBuiltRootScript("sw", "no-cache, no-store, must-revalidate")(_req, res, next);
});

app.get("/sw-register.js", (_req, res, next) => {
  const cacheControl = isProductionApp ? "public, max-age=3600, stale-while-revalidate=86400" : "no-cache";
  res.type("application/javascript; charset=utf-8");
  res.set("Cache-Control", cacheControl);
  return sendBuiltRootScript("sw-register", cacheControl)(_req, res, next);
});

app.get(/^\/([a-z0-9_-]+)\.js$/i, (req, res, next) => {
  const scriptName = req && req.params && req.params[0] ? String(req.params[0]).trim() : "";
  if (!scriptName || scriptName === "sw" || scriptName === "sw-register") {
    return next();
  }

  return sendBuiltRootScript(scriptName)(req, res, next);
});

app.get("/manifest.webmanifest", (req, res) => {
  const brandingConfig =
    siteConfig && siteConfig.branding && typeof siteConfig.branding === "object"
      ? siteConfig.branding
      : {};
  const seoConfig =
    siteConfig && siteConfig.seo && typeof siteConfig.seo === "object"
      ? siteConfig.seo
      : {};
  const siteName =
    (brandingConfig.siteName || process.env.SITE_NAME || "BFANG Team")
      .toString()
      .trim() || "BFANG Team";
  const shortNameSeed = (brandingConfig.brandMark || siteName).toString().trim() || siteName;
  const shortName = shortNameSeed.slice(0, 30).trim() || siteName.slice(0, 30).trim() || "BFANG";
  const description =
    (seoConfig.defaultDescription || `${siteName} - Doc truyen tranh online mien phi.`)
      .toString()
      .trim();
  const themeColor = "#0f0f11";
  const payload = {
    id: "/",
    name: siteName,
    short_name: shortName,
    description,
    lang: "vi",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: themeColor,
    theme_color: themeColor,
    categories: ["books", "entertainment"],
    prefer_related_applications: false,
    icons: [
      {
        src: "/logobfang.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      },
      {
        src: "/pwa/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/pwa/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/pwa/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };

  const payloadText = JSON.stringify(payload);
  const etag = `"${crypto.createHash("sha1").update(payloadText).digest("hex")}"`;
  const requestEtag = (req.get("if-none-match") || "").toString();

  res.type("application/manifest+json; charset=utf-8");
  res.set(
    "Cache-Control",
    isProductionApp ? "public, max-age=3600, stale-while-revalidate=86400" : "no-cache"
  );
  res.set("ETag", etag);

  if (requestEtag.includes(etag)) {
    return res.status(304).end();
  }

  return res.send(payloadText);
});

const llmsCacheControl = isProductionApp
  ? "public, max-age=1800, stale-while-revalidate=86400"
  : "no-cache";

const sendLlmsTextFile = (fileName, options = {}) => (req, res, next) => {
  const targetFilePath = path.join(publicDir, fileName);
  res.type("text/plain; charset=utf-8");
  res.set("Cache-Control", llmsCacheControl);
  res.set("X-Robots-Tag", SEO_ROBOTS_INDEX);

  if (options.alternatePath) {
    res.append("Link", `<${options.alternatePath}>; rel="alternate"; type="text/plain"`);
  }

  return res.sendFile(targetFilePath, (error) => {
    if (!error) return;
    if (error.code === "ENOENT") {
      return next();
    }
    return next(error);
  });
};

app.get("/llms.txt", sendLlmsTextFile("llms.txt", { alternatePath: "/llms-full.txt" }));
app.get("/llms-full.txt", sendLlmsTextFile("llms-full.txt", { alternatePath: "/llms.txt" }));

const wasmAssetFileNamePattern = /^[a-z0-9._-]+\.wasm$/i;
app.get("/wasm/:fileName", (req, res, next) => {
  const fileName = (req.params.fileName || "").toString().trim();
  if (!wasmAssetFileNamePattern.test(fileName)) return next();

  const wasmPath = path.join(publicDir, "wasm", fileName);
  res.type("application/wasm");
  res.set(
    "Cache-Control",
    isProductionApp ? "public, max-age=31536000, immutable" : "no-cache"
  );
  return res.sendFile(wasmPath, (error) => {
    if (!error) return;
    if (error.code === "ENOENT") return next();
    return next(error);
  });
});

app.use(express.static(publicDir));

app.get("/uploads/covers/:fileName", async (req, res, next) => {
  // Cover variants are pre-generated at upload time (standard/medium/small).
  // Keep this legacy route as a passthrough for backward compatibility.
  return next();

  const requestedWidth = parseVariantNumber(req.query.w, 120, 1400);
  const requestedHeight = parseVariantNumber(req.query.h, 120, 1800);
  if (!requestedWidth && !requestedHeight) return next();

  const fileName = (req.params.fileName || "").toString().trim();
  if (!coverVariantFileNamePattern.test(fileName)) return next();

  const resolvedQuality = normalizeVariantQuality(req.query.q);
  const resolvedWidth = requestedWidth ? snapVariantDimension(requestedWidth, 120, 1400) : 0;
  let resolvedHeight = requestedHeight ? snapVariantDimension(requestedHeight, 120, 1800) : 0;
  let ratioKey = "none";

  if (resolvedWidth && resolvedHeight) {
    const ratioProfile = resolveCoverVariantRatio(requestedWidth, requestedHeight);
    if (ratioProfile) {
      ratioKey = ratioProfile.key;
      resolvedHeight = Math.min(1800, Math.max(120, Math.ceil(resolvedWidth * ratioProfile.value)));
    }
  }

  if (!resolvedWidth && !resolvedHeight) return next();

  const sourcePath = path.join(uploadDir, "covers", fileName);

  try {
    const sourceStat = await fs.promises.stat(sourcePath);
    if (!sourceStat.isFile()) return next();

    const sourceSignature = `${coverVariantEncodingVersion}|${fileName}|${Number(sourceStat.mtimeMs || 0)}|${resolvedWidth}|${resolvedHeight}|${resolvedQuality}|${ratioKey}`;
    const variantHash = crypto.createHash("sha1").update(sourceSignature).digest("hex").slice(0, 16);
    const variantName = `${path.parse(fileName).name}.${variantHash}.webp`;
    const variantPath = path.join(coverVariantDir, variantName);

    const ensureVariantReady = async () => {
      try {
        await fs.promises.access(variantPath, fs.constants.F_OK);
        return;
      } catch (_missingError) {
        // Build below.
      }

      let pendingBuild = inFlightCoverVariantBuilds.get(variantPath);
      if (!pendingBuild) {
        pendingBuild = (async () => {
          try {
            await fs.promises.access(variantPath, fs.constants.F_OK);
            return;
          } catch (_stillMissingError) {
            // Build below.
          }

          const transformer = sharp(sourcePath).rotate();

          if (resolvedWidth && resolvedHeight) {
            transformer.resize({
              width: resolvedWidth,
              height: resolvedHeight,
              fit: "cover",
              position: "centre",
              kernel: sharp.kernel.lanczos3,
              fastShrinkOnLoad: false,
              withoutEnlargement: true
            });
          } else if (resolvedWidth) {
            transformer.resize({
              width: resolvedWidth,
              fit: "inside",
              kernel: sharp.kernel.lanczos3,
              fastShrinkOnLoad: false,
              withoutEnlargement: true
            });
          } else {
            transformer.resize({
              height: resolvedHeight,
              fit: "inside",
              kernel: sharp.kernel.lanczos3,
              fastShrinkOnLoad: false,
              withoutEnlargement: true
            });
          }

          const webpOptions = {
            quality: resolvedQuality,
            effort: 5,
            smartSubsample: true,
            preset: "picture"
          };

          if (resolvedQuality >= 100) {
            webpOptions.nearLossless = true;
          }

          await transformer.webp(webpOptions).toFile(variantPath);
        })();

        inFlightCoverVariantBuilds.set(variantPath, pendingBuild);
        pendingBuild.finally(() => {
          inFlightCoverVariantBuilds.delete(variantPath);
        }).catch(() => undefined);
      }

      await pendingBuild;
    };

    await ensureVariantReady();

    const etag = `"${variantHash}"`;
    const requestEtag = (req.get("if-none-match") || "").toString();
    res.set("Cache-Control", isProductionApp ? staticImageCacheControl : "public, max-age=3600");
    res.set("ETag", etag);

    if (requestEtag.includes(etag)) {
      return res.status(304).end();
    }

    res.type("image/webp");
    return res.sendFile(variantPath);
  } catch (error) {
    if (error && error.code === "ENOENT") return next();
    console.warn(`Cannot serve optimized cover variant for ${fileName}.`, error);
    return next();
  }
});

app.use(
  "/uploads",
  express.static(uploadDir, {
    maxAge: isProductionApp ? "7d" : 0,
    setHeaders: (res, servedPath) => {
      if (!isProductionApp) return;
      const targetPath = (servedPath || "").toString();
      if (staticImageFilePattern.test(targetPath)) {
        res.set("Cache-Control", staticImageCacheControl);
        return;
      }
      res.set("Cache-Control", staticUploadCacheControl);
    }
  })
);

app.locals.formatDate = formatDate;
app.locals.formatDateTime = formatDateTime;
app.locals.formatTimeAgo = formatTimeAgo;
app.locals.cacheBust = cacheBust;
app.locals.assetVersion = serverAssetVersion;
app.locals.siteConfig = siteConfig;
app.locals.adultContentControlEnabled = Boolean(adultContentControlEnabled);
};

module.exports = configureCoreRuntime;
