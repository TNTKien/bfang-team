const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createWinterModeMiddleware,
  isWinterModeAllowedPath,
  normalizePathname,
} = require("../src/utils/winter-mode");

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
