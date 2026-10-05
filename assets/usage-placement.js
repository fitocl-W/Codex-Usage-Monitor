(() => {
  const registry = window.__CODEX_USAGE_MONITOR_MODULES__ ||= {};
  const COMPOSER_SELECTORS = Object.freeze([
    ".composer-surface-chrome",
    '[data-testid="composer"]',
    '[data-testid*="composer-"]',
    '[class*="ComposerLayoutRoot"]',
  ]);
  const EDITABLE_SELECTOR = 'textarea, [contenteditable="true"]';
  const CONTROL_SELECTOR = 'button, [role="button"]';
  const APPROVAL_PATTERN = /(?:替我审批|请求批准|完全访问(?:权限)?|自定义(?:\s*\(config\.toml\))?|approve|approval|full access|custom\s*\(config\.toml\))/i;

  const box = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  };
  const isVisible = (node) => {
    const rect = node?.getBoundingClientRect();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  };
  const controlText = (node) => `${node?.getAttribute?.("aria-label") || ""} ${node?.getAttribute?.("title") || ""} ${node?.textContent || ""}`.trim();
  const isApprovalControl = (node) => APPROVAL_PATTERN.test(controlText(node));
  const composerSelector = COMPOSER_SELECTORS.join(", ");
  const clearPlacement=()=>registry.compact?.restoreNative();

  // ChatGPT Chat and Work share ComposerLayoutRoot and the top-level mode.
  // Use field metadata, never message contents or the global ChatGPT selector.
  const isChatGptComposer = (node) => {
    const fields = node.matches(EDITABLE_SELECTOR) ? [node] : [...node.querySelectorAll(EDITABLE_SELECTOR)];
    const labels = fields.flatMap((field) => ["aria-label", "placeholder", "data-placeholder"]
      .map((attribute) => field.getAttribute(attribute) || ""));
    if (labels.some((label) => /\bChatGPT\s+(?:Work\b|工作)/i.test(label))) return false;
    if (labels.some((label) => /\bChatGPT\b/i.test(label))) return true;
    for (let current = node; current; current = current.parentElement) {
      if (["data-above-composer-conversation-id", "data-conversation-id", "data-thread-id"]
        .some((attribute) => /^chatgpt\s*:/i.test(current.getAttribute(attribute) || ""))) return true;
    }
    return false;
  };

  const isDotComposer = (node) => {
    for (let current = node; current; current = current.parentElement) {
      if (current.style.getPropertyValue("--orbit-message-link-color")
        || current.style.getPropertyValue("--orbit-messages-content-x")) return true;
    }
    return false;
  };

  const findPlacement = (hostId, preferredComposer = null) => {
    const composers = [...document.querySelectorAll(composerSelector)]
      .filter((node) => isVisible(node) && !isChatGptComposer(node) && !isDotComposer(node));
    const visibleEditables = [...document.querySelectorAll(EDITABLE_SELECTOR)]
      .filter((node) => isVisible(node) && !node.closest(`#${hostId}`));
    const editables = visibleEditables.filter((node) => !isChatGptComposer(node) && !isDotComposer(node));
    const nearestComposer = (editable) => {
      const explicit = editable.closest(composerSelector);
      if (explicit && isVisible(explicit)) return { composer: explicit, strategy: "explicit-editable" };
      let current = editable.parentElement;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        const rect = box(current);
        if (rect && rect.height >= 56 && rect.height <= 260 && current.querySelectorAll(CONTROL_SELECTOR).length >= 2) {
          return { composer: current, strategy: `editable-ancestor-${depth + 1}` };
        }
      }
      return null;
    };
    const preferredEditable = preferredComposer && preferredComposer.isConnected && isVisible(preferredComposer)
      ? editables.find((editable) => preferredComposer.contains(editable))
      : null;
    const preferredMatch = preferredEditable ? nearestComposer(preferredEditable) : null;
    const candidates = editables
      .map((editable, order) => {
        const match = nearestComposer(editable);
        return match ? { ...match, editable, order } : null;
      })
      .filter(Boolean)
      .filter((candidate, index, all) => all.findIndex((item) => item.composer === candidate.composer) === index);
    const candidateScore = (candidate) => {
      const controls = [...candidate.composer.querySelectorAll(CONTROL_SELECTOR)]
        .filter((node) => isVisible(node) && !node.closest(`#${hostId}`));
      const composerBox = box(candidate.composer);
      return {
        approval: controls.some(isApprovalControl) ? 1 : 0,
        explicit: candidate.composer.matches(composerSelector) ? 1 : 0,
        x: composerBox?.x ?? Number.POSITIVE_INFINITY,
        order: candidate.order,
      };
    };
    const fallbackMatch = candidates.sort((left, right) => {
      const leftScore = candidateScore(left);
      const rightScore = candidateScore(right);
      return rightScore.approval - leftScore.approval
        || rightScore.explicit - leftScore.explicit
        || leftScore.x - rightScore.x
        || leftScore.order - rightScore.order;
    })[0] || (composers.length ? { composer: composers.at(-1), strategy: "explicit-composer" } : null);
    const match = preferredMatch || fallbackMatch;
    if (!match) {
      return {
        composer: null,
        strategy: "none",
        reason: visibleEditables.length && !editables.length
          ? visibleEditables.some(isDotComposer) ? "dot-composer" : "chatgpt-composer"
          : editables.length ? "composer-not-found-for-editable" : "visible-editable-not-found",
        editableCount: editables.length,
        composerCount: composers.length,
      };
    }
    return { ...match, reason: null, editableCount: editables.length, composerCount: composers.length };
  };

  registry.placement=Object.freeze({findPlacement,clearPlacement});
})();
