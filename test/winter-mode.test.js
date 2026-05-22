const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  WEB_UNLOCK_COOKIE_NAME,
  WEB_UNLOCK_HEADER_NAME,
  WEB_UNLOCK_RETURN_PARAM,
  buildWinterModeRedirectPath,
  createWinterModeMiddleware,
  isWinterModeBypassRequest,
  isWinterModeAllowedPath,
  normalizePathname,
} = require("../src/utils/winter-mode");

const getUserscriptPath = () => path.join(__dirname, "..", "public", "userscripts", "moetruyen-full-web.user.js");

const readUserscriptSource = () => fs.readFileSync(getUserscriptPath(), "utf8");

const createMemoryStorage = () => {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    }
  };
};

const runFullWebUserscript = ({ href, storage = createMemoryStorage() }) => {
  let currentHref = href;
  const replacements = [];
  const cookieWrites = [];
  const location = {
    get href() {
      return currentHref;
    },
    get hostname() {
      return new URL(currentHref).hostname;
    },
    get origin() {
      return new URL(currentHref).origin;
    },
    replace(nextHref) {
      replacements.push(nextHref);
      currentHref = nextHref;
    }
  };
  const document = {};
  Object.defineProperty(document, "cookie", {
    get() {
      return cookieWrites.join("; ");
    },
    set(value) {
      cookieWrites.push(String(value));
    }
  });

  vm.runInNewContext(readUserscriptSource(), {
    document,
    encodeURIComponent,
    URL,
    window: {
      location,
      sessionStorage: storage
    }
  }, { filename: getUserscriptPath() });

  return {
    cookieWrites,
    replacements
  };
};

test("normalizePathname keeps routing decisions path-only and slash-prefixed", () => {
  assert.equal(normalizePathname("forum?tab=hot"), "/forum");
  assert.equal(normalizePathname("/manga/demo#top"), "/manga/demo");
  assert.equal(normalizePathname(""), "/");
});

test("winter mode allows forum and forum support endpoints only", () => {
  assert.equal(isWinterModeAllowedPath({ path: "/forum" }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/forum/post/12" }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/m/forum/post/12" }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/auth/session" }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/notifications/stream" }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/messages/unread-count" }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/admin" }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/admin/manga/12" }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/admin", query: { next: "/forum/admin" } }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/user/forum_member" }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/comments/users/auth-user-1" }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/comments/reactions", body: { forumMode: true } }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/comments/123/delete", body: { forumMode: true } }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/comments/123/edit", body: { forumMode: "1" } }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/comments/123/like", body: { forumMode: "yes" } }), true);
  assert.equal(isWinterModeAllowedPath({ path: "/comments/123/report", body: { forumMode: "on" } }), true);

  assert.equal(isWinterModeAllowedPath({ path: "/" }), false);
  assert.equal(isWinterModeAllowedPath({ path: "/manga/demo" }), false);
  assert.equal(isWinterModeAllowedPath({ path: "/news" }), false);
  assert.equal(isWinterModeAllowedPath({ path: "/messages" }), false);
  assert.equal(isWinterModeAllowedPath({ path: "/comments/123/delete" }), false);
  assert.equal(isWinterModeAllowedPath({ path: "/comments/123/delete", body: { forumMode: false } }), false);
  assert.equal(isWinterModeAllowedPath({ path: "/comments/delete-capability" }), false);
});

test("winter mode middleware redirects HTML traffic to forum", () => {
  const middleware = createWinterModeMiddleware({ enabled: true });
  const req = { path: "/", method: "GET", query: {} };
  const calls = [];
  const res = {
    set(name, value) {
      calls.push(["set", name, value]);
      return this;
    },
    redirect(status, path) {
      calls.push(["redirect", status, path]);
      return this;
    },
  };

  middleware(req, res, () => calls.push(["next"]));

  assert.deepEqual(calls, [
    ["set", "X-Web-Winter-Mode", "1"],
    ["redirect", 302, "/forum"],
  ]);
});

test("winter mode redirect carries original path for the userscript restore flow", () => {
  const redirectPath = buildWinterModeRedirectPath({
    forumPath: "/forum",
    originalUrl: "/manga/demo?chapter=12"
  });

  assert.equal(redirectPath, `/forum?${WEB_UNLOCK_RETURN_PARAM}=%2Fmanga%2Fdemo%3Fchapter%3D12`);
  assert.equal(buildWinterModeRedirectPath({ forumPath: "/forum", originalUrl: "/forum/post/12" }), "/forum");
  assert.equal(buildWinterModeRedirectPath({ forumPath: "/forum", originalUrl: "https://evil.test/" }), "/forum");
});

test("winter mode bypass request accepts userscript cookie or configured token", () => {
  assert.equal(
    isWinterModeBypassRequest({
      headers: {
        cookie: `${WEB_UNLOCK_COOKIE_NAME}=1`
      }
    }),
    true
  );
  assert.equal(
    isWinterModeBypassRequest(
      {
        headers: {
          [WEB_UNLOCK_HEADER_NAME]: "secret-token"
        }
      },
      { token: "secret-token" }
    ),
    true
  );
  assert.equal(
    isWinterModeBypassRequest(
      {
        headers: {
          cookie: `${WEB_UNLOCK_COOKIE_NAME}=wrong`
        }
      },
      { token: "secret-token" }
    ),
    false
  );
  assert.equal(isWinterModeBypassRequest({ headers: {} }), false);
});

test("Tampermonkey userscript stays aligned with server unlock markers", () => {
  const scriptSource = readUserscriptSource();

  assert.match(scriptSource, new RegExp(`COOKIE_NAME = "${WEB_UNLOCK_COOKIE_NAME}"`));
  assert.match(scriptSource, new RegExp(`RETURN_PARAM = "${WEB_UNLOCK_RETURN_PARAM}"`));
  assert.match(scriptSource, /UNLOCK_ATTEMPT_STORAGE_KEY/);
  assert.match(scriptSource, /UNLOCK_DISABLED_STORAGE_KEY/);
  assert.match(scriptSource, /@match\s+https:\/\/truyen\.moe\/\*/);
  assert.match(scriptSource, /@match\s+https:\/\/\*\.truyen\.moe\/\*/);
  assert.match(scriptSource, /@run-at\s+document-start/);
});

test("Tampermonkey userscript also unlocks truyen.moe hosts", () => {
  const rootRun = runFullWebUserscript({
    href: `https://truyen.moe/forum?${WEB_UNLOCK_RETURN_PARAM}=%2Fmanga%2Fdemo`
  });
  assert.deepEqual(rootRun.replacements, ["https://truyen.moe/manga/demo"]);
  assert.match(rootRun.cookieWrites[0], new RegExp(`^${WEB_UNLOCK_COOKIE_NAME}=1;`));

  const subdomainRun = runFullWebUserscript({
    href: `https://cdn.truyen.moe/forum?${WEB_UNLOCK_RETURN_PARAM}=%2Fnews`
  });
  assert.deepEqual(subdomainRun.replacements, ["https://cdn.truyen.moe/news"]);
  assert.match(subdomainRun.cookieWrites[0], new RegExp(`^${WEB_UNLOCK_COOKIE_NAME}=1;`));
});

test("Tampermonkey userscript stops restoring after a rejected unlock attempt", () => {
  const storage = createMemoryStorage();
  const forumReturnHref = `https://moetruyen.net/forum?${WEB_UNLOCK_RETURN_PARAM}=%2Fmanga%2Fdemo%3Fchapter%3D12`;
  const targetHref = "https://moetruyen.net/manga/demo?chapter=12";

  const firstRun = runFullWebUserscript({ href: forumReturnHref, storage });
  assert.deepEqual(firstRun.replacements, [targetHref]);
  assert.match(firstRun.cookieWrites[0], new RegExp(`^${WEB_UNLOCK_COOKIE_NAME}=1;`));

  const bouncedRun = runFullWebUserscript({ href: forumReturnHref, storage });
  assert.deepEqual(bouncedRun.replacements, []);
  assert.match(bouncedRun.cookieWrites[0], new RegExp(`^${WEB_UNLOCK_COOKIE_NAME}=; Max-Age=0;`));

  const inactiveRun = runFullWebUserscript({ href: targetHref, storage });
  assert.deepEqual(inactiveRun.replacements, []);
  assert.match(inactiveRun.cookieWrites[0], new RegExp(`^${WEB_UNLOCK_COOKIE_NAME}=; Max-Age=0;`));
});

test("Tampermonkey userscript clears pending restore after a successful full-web page load", () => {
  const storage = createMemoryStorage();
  const forumReturnHref = `https://moetruyen.net/forum?${WEB_UNLOCK_RETURN_PARAM}=%2Fmanga%2Fdemo`;
  const targetHref = "https://moetruyen.net/manga/demo";

  assert.deepEqual(runFullWebUserscript({ href: forumReturnHref, storage }).replacements, [targetHref]);

  const acceptedRun = runFullWebUserscript({ href: targetHref, storage });
  assert.deepEqual(acceptedRun.replacements, []);
  assert.match(acceptedRun.cookieWrites[0], new RegExp(`^${WEB_UNLOCK_COOKIE_NAME}=1;`));

  const nextRestoreRun = runFullWebUserscript({ href: forumReturnHref, storage });
  assert.deepEqual(nextRestoreRun.replacements, [targetHref]);
});

test("winter mode middleware is transparent when disabled or path is allowed", () => {
  const disabledMiddleware = createWinterModeMiddleware({ enabled: false });
  const allowedMiddleware = createWinterModeMiddleware({ enabled: true });
  let disabledNextCount = 0;
  let allowedNextCount = 0;

  disabledMiddleware({ path: "/", method: "GET", query: {} }, {}, () => {
    disabledNextCount += 1;
  });
  allowedMiddleware({ path: "/forum/post/12", method: "GET", query: {} }, {}, () => {
    allowedNextCount += 1;
  });
  allowedMiddleware({ path: "/comments/12/delete", method: "POST", query: {}, body: { forumMode: true } }, {}, () => {
    allowedNextCount += 1;
  });

  assert.equal(disabledNextCount, 1);
  assert.equal(allowedNextCount, 2);
});

test("winter mode middleware bypasses full web traffic when userscript marker is present", () => {
  const calls = [];
  const middleware = createWinterModeMiddleware({
    enabled: true,
    onBypass(req, res) {
      req.unlocked = true;
      res.locals.webEnabled = true;
      calls.push(["onBypass"]);
    }
  });
  const req = {
    path: "/manga/demo",
    method: "GET",
    query: {},
    headers: {
      cookie: `${WEB_UNLOCK_COOKIE_NAME}=1`
    }
  };
  const res = {
    locals: {},
    set(name, value) {
      calls.push(["set", name, value]);
      return this;
    },
    redirect(status, path) {
      calls.push(["redirect", status, path]);
      return this;
    }
  };

  middleware(req, res, () => calls.push(["next"]));

  assert.equal(req.unlocked, true);
  assert.equal(res.locals.webEnabled, true);
  assert.deepEqual(calls, [
    ["set", "X-Web-Winter-Mode-Bypass", "1"],
    ["onBypass"],
    ["next"]
  ]);
});

test("winter mode middleware rejects non-forum JSON/write traffic", () => {
  const middleware = createWinterModeMiddleware({ enabled: true, wantsJson: () => true });
  const req = { path: "/api/private", method: "POST", query: {} };
  const calls = [];
  const res = {
    set(name, value) {
      calls.push(["set", name, value]);
      return this;
    },
    status(code) {
      calls.push(["status", code]);
      return this;
    },
    json(payload) {
      calls.push(["json", payload]);
      return this;
    },
  };

  middleware(req, res, () => calls.push(["next"]));

  assert.equal(calls[0][0], "set");
  assert.deepEqual(calls[1], ["status", 503]);
  assert.equal(calls[2][0], "json");
  assert.equal(calls[2][1].forumPath, "/forum");
});
