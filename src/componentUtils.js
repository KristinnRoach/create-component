// === Helpers for creating DOM components ===

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#x60;',
  '=': '&#x3D;',
  '/': '&#x2F;',
};

// Escape markup characters for HTML interpolation. Other contexts, such as
// URLs, need their own validation.
const escapeHtml = (value) =>
  String(value).replace(/[&<>"'`=\/]/g, (char) => HTML_ENTITIES[char]);

/**
 * Supported interpolation syntaxes for templates.
 * - ${prop} (legacy, for backward compatibility)
 * - [[prop]] (default, preferred for clarity and no JS conflicts)
 */
/** Matches both [[prop]] (preferred) and ${prop} (legacy) in a single pass */
const INTERPOLATION_REGEX = /\[\[([^\]]+)\]\]|\$\{([^}]+)\}/g;

/**
 * Interpolate props into a template string by replacing supported placeholders with the prop value.
 * Supports nested properties (e.g., ${user.name} or [[user.name]]).
 * Properties ending with "Html" are treated as raw HTML (unsafe) and not sanitized.
 * @param {string} templateStr - The template string containing placeholders.
 * @param {Object} props - The object of current property values.
 * @returns {string} The interpolated string.
 */
const interpolate = (templateStr, props) => {
  return templateStr.replace(
    INTERPOLATION_REGEX,
    (_, bracketKey, dollarKey) => {
      const trimmedKey = (bracketKey ?? dollarKey).trim();
      // Resolve nested properties (e.g., "user.name")
      const value = trimmedKey
        .split('.')
        .reduce((obj, prop) => obj?.[prop], props);
      if (value == null) return '';
      // Properties ending with "Html" are treated as raw/unsafe HTML
      const isHtml = trimmedKey.endsWith('Html');
      return isHtml ? String(value) : escapeHtml(value);
    },
  );
};

/**
 * Converts a template string and props into a DocumentFragment with interpolated HTML.
 * @param {string} templateStr - The template string with placeholders.
 * @param {Object} [props={}] - The props to interpolate.
 * @returns {DocumentFragment} The fragment with rendered HTML.
 */
const createDOMFragment = (templateStr, props = {}) => {
  const template = document.createElement('template');
  template.innerHTML = interpolate(templateStr, props);
  // This template is parsed for a single render, so its nodes can be moved.
  return template.content;
};

const getBindingText = (value) => {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Let the HTML parser handle strings that need input normalization.
  return typeof value === 'string' && !/[\r\0]/.test(value) ? value : null;
};

const prepareTextBinding = (template, props) => {
  const marker = 'kidlib-text-binding';
  if (typeof template !== 'string' || /[\r\0]/.test(template)) return null;
  const [match, extra] = template.matchAll(INTERPOLATION_REGEX);
  if (!match || extra || template.includes(marker)) return null;

  const key = (match[1] ?? match[2]).trim();
  if (!/^[a-zA-Z_$][\w$]*$/.test(key) || key.endsWith('Html')) return null;
  // Skip tag names and text that may continue an HTML character reference.
  if (!/>[^<>&]*$/.test(template.slice(0, match.index))) return null;
  if (!Object.prototype.hasOwnProperty.call(props, key)) return null;
  const value = getBindingText(props[key]);
  if (value === null) return null;

  // Find the placeholder in the parsed DOM so attributes and raw-text elements
  // cannot be mistaken for ordinary text.
  const content = createDOMFragment(template.replace(match[0], `<!--${marker}-->`));
  const comments = document.createTreeWalker(content, NodeFilter.SHOW_COMMENT);
  let placeholder = comments.nextNode();
  while (placeholder && placeholder.data !== marker) {
    placeholder = comments.nextNode();
  }
  const parent = placeholder?.parentElement;
  if (parent?.namespaceURI !== 'http://www.w3.org/1999/xhtml') return null;
  if (!parent.matches('button, div, em, h1, h2, h3, h4, h5, h6, label, p, span, strong')) {
    return null;
  }
  const children = Array.from(parent.childNodes);
  if (children.some((node) => node !== placeholder && node.nodeType !== Node.TEXT_NODE)) {
    return null;
  }

  const prefix = placeholder.previousSibling?.textContent ?? '';
  const suffix = placeholder.nextSibling?.textContent ?? '';
  parent.textContent = prefix + value + suffix;
  return { content, binding: { parent, key, prefix, suffix } };
};

// Build a DOM path (children indexes) from root->target for later lookup
const getPathForElement = (root, target) => {
  const path = [];
  let node = target;
  while (node && node !== root) {
    const parent = node.parentElement;
    if (!parent) break;
    const idx = Array.prototype.indexOf.call(parent.children, node);
    path.push(idx);
    node = parent;
  }
  return path.reverse();
};

// Resolve a DOM path to an element
const getElementByPath = (root, path) => {
  return path.reduce(
    (node, idx) => (node && node.children ? node.children[idx] : null),
    root,
  );
};

/**
 * Capture input state (values, selection, focus).
 */
const captureInputState = (element) => {
  return Array.from(element.querySelectorAll('input, textarea, select'), (el) => {
    const { name, id } = el;
    return {
      name,
      id,
      path: name || id ? null : getPathForElement(element, el),
      value: el.value,
      checked: el.checked,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
      wasFocused: document.activeElement === el,
    };
  });
};

// Use the native `CSS.escape` when available, otherwise fall back to a
// small escape function suitable for building ID/class selectors.
const cssEscape = (str) => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(String(str));
  }
  // Fallback for environments without `CSS.escape`:
  // escape characters that are unsafe in CSS identifiers by
  // prefixing them with a backslash.
  return String(str).replace(/[^_a-zA-Z0-9-]/g, (ch) => '\\' + ch);
};

/**
 * Restore input state.
 */
const restoreInputState = (element, states) => {
  states.forEach((state) => {
    let el = null;
    if (state.name) {
      // Safer lookup for name attributes: query all named controls and match
      // the `name` attribute value directly to avoid building fragile
      // attribute selectors. This avoids ambiguity and escaping pitfalls.
      const candidates = element.querySelectorAll(
        'input[name], textarea[name], select[name]',
      );
      for (const node of candidates) {
        if (node.getAttribute('name') === state.name) {
          el = node;
          break;
        }
      }
    } else if (state.id) {
      // Use cssEscape for ID selectors to avoid querySelector errors.
      try {
        el = element.querySelector('#' + cssEscape(state.id));
      } catch (e) {
        el = element.querySelector(`#${state.id}`);
      }
    } else if (state.path) {
      el = getElementByPath(element, state.path);
    }

    if (el) {
      el.value = state.value;
      if (state.checked !== undefined) el.checked = state.checked;
      if (state.selectionStart != null && el.setSelectionRange) {
        try {
          el.setSelectionRange(state.selectionStart, state.selectionEnd);
        } catch {}
      }
      if (state.wasFocused) {
        try {
          el.focus();
        } catch {}
      }
    }
  });
};

/**
 * Capture media state (currentTime, paused, volume, etc.).
 */
const captureMediaState = (element) => {
  return Array.from(element.querySelectorAll('video, audio')).map((el) => ({
    src: el.currentSrc || el.src,
    currentTime: el.currentTime,
    paused: el.paused,
    volume: el.volume,
    playbackRate: el.playbackRate,
    muted: el.muted,
  }));
};

/**
 * Restore media state.
 */
// Find a media element by matching resolved src properties to avoid selector pitfalls
const findMediaBySrc = (root, targetSrc) => {
  const list = root.querySelectorAll('video, audio');
  for (const node of list) {
    if (node.currentSrc === targetSrc || node.src === targetSrc) return node;
  }
  return null;
};

const restoreMediaState = (element, states) => {
  states.forEach((state) => {
    if (!state.src) return;
    const el = findMediaBySrc(element, state.src);
    if (el) {
      el.currentTime = state.currentTime;
      el.volume = state.volume;
      el.playbackRate = state.playbackRate;
      el.muted = state.muted;
      if (!state.paused) {
        el.play().catch(() => {});
      }
    }
  });
};

export {
  createDOMFragment as html,
  escapeHtml,
  getBindingText,
  INTERPOLATION_REGEX,
  interpolate,
  captureInputState,
  restoreInputState,
  captureMediaState,
  restoreMediaState,
  prepareTextBinding,
};
