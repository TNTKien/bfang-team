(() => {
  const authRoot = document.documentElement;
  const authModules = window.BfangAuthModules && typeof window.BfangAuthModules === "object"
    ? window.BfangAuthModules
    : {};

  const authConfig = window.__AUTH && typeof window.__AUTH === "object" ? window.__AUTH : {};
  if (typeof authModules.createCore !== "function" || typeof authModules.createUi !== "function") {
    return;
  }

  const core = authModules.createCore({ authRoot, authConfig });
  const ui = authModules.createUi({
    authProviderEnabled: core.authProviderEnabled,
    getPreferredAuthProvider: core.getPreferredAuthProvider,
    signInWithProvider: core.signInWithProvider,
    signOut: core.signOut
  });

  window.BfangAuth = {
    client: core.client,
    signIn: ui.signIn,
    signInWithProvider: core.signInWithProvider,
    signInWithGoogle: core.signInWithGoogle,
    signInWithDiscord: core.signInWithDiscord,
    signOut: core.signOut,
    getSession: core.getSession,
    getAccessToken: core.getAccessToken,
    getMeProfile: core.getMeProfile,
    refreshUi: core.refreshUi,
    setAvatarPreview: core.setAvatarPreview,
    clearAvatarPreview: core.clearAvatarPreview,
    me: null
  };

  core.setPublicApi(window.BfangAuth);
  core.loadInitialSession({
    shouldAutoOpenLoginDialogFromUrl: ui.shouldAutoOpenLoginDialogFromUrl,
    openLoginProviderDialog: ui.openLoginProviderDialog
  });
})();
