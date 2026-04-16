# createComponent

Lightweight, reactive vanilla JS component factory with automatic input state preservation.

## Basic Usage

```js
import createComponent from './createComponent.js';

const card = createComponent({
  initialProps: { name: 'Ada', count: 0 },
  template: `
    <h2>[[name]]</h2>
    <p>Count: [[count]]</p>
  `,
  parent: document.body,
});

// Update props
card.name = 'Grace';
card.count++;
card.update({ name: 'Alan', count: 10 });
```

## Event Handlers

- Use any `on<event>` attribute in the template (not just `onclick`).
- Handler names must match keys in the `handlers` object.
- All handlers survive re-renders automatically.

```js
const counter = createComponent({
  initialProps: { count: 0 },
  template: `
    <button onclick="increment">Count: [[count]]</button>
    <button onclick="decrement">-</button>
    <img src="[[photoURL]]" onerror="handleImgError" />
    <input type="text" onchange="handleChange" />
  `,
  handlers: {
    increment: () => counter.count++,
    decrement: () => counter.count--,
    handleImgError: (e) => {
      e.target.style.display = 'none';
    },
    handleChange: (e) => console.log(e.target.value),
  },
  parent: document.body,
});
```

### Custom Events

- Any `on<event>` attribute maps to `addEventListener(event, handler)`.
- Custom events must be dispatched manually (not user-triggered):

```js
const widget = createComponent({
  template: `<div onrequestcoolstuff="docoolstuff">Woah!</div>`,
  handlers: {
    docoolstuff: (e) => console.log('Cool!', e.detail),
  },
  parent: document.body,
});

// Fire manually
widget
  .querySelector('div')
  .dispatchEvent(
    new CustomEvent('requestcoolstuff', { detail: { level: 'max' } }),
  );
```

Stick to standard DOM events (`click`, `error`, `change`, etc.) for most cases.

## Inputs

```js
const form = createComponent({
  initialProps: { label: 'Name' },
  template: `
    <label>[[label]]</label>
    <input type="text" placeholder="Type here" />
  `,
  parent: document.body,
});

// User's typed text is preserved during re-renders
form.label = 'Full Name'; // Input value stays intact
```

## Options

- `initialProps`: Initial properties (object)
- `template`: Template string (string)
- `parent`: Parent element (HTMLElement, optional)
- `containerTag`: Root element tag (default: 'div')
- `className`: CSS class (optional)
- `handlers`: Event handlers (object, optional)
- `onMount`: Called after first render (function, optional)
- `onCleanup`: Cleanup function or array (optional)
- `autoAppend`: Auto-append to parent (default: true)
- `preserveInputState`: Preserve input/media state (default: true)
- `templateFns`: Custom template functions for `[[prefix:key]]` placeholders (object, optional)

## Custom Template Functions (`templateFns`)

- Use `templateFns` to add custom placeholder logic in templates: `[[prefix:key]]`.
- Each key is a prefix (letters/numbers/underscores only), value is a function `(key) => string` or `{ resolve, onChange }`.
- Example: translation or formatting.

```js
const comp = createComponent({
  template: `<span>[[t:greeting]] [[user]]</span>`,
  initialProps: { user: 'Ada' },
  templateFns: {
    t: (key) => ({ greeting: 'Hello', bye: 'Goodbye' })[key] || key,
  },
});
// Renders: <span>Hello Ada</span>
```

// Advanced: reactive templateFns can use `{ resolve, onChange }` for auto re-render (see source for details).

## Nested Properties

```js
const profile = createComponent({
  initialProps: { user: { name: 'Ada', age: 30 } },
  template: `<p>[[user.name]] is [[user.age]]</p>`,
});
```

## Template Syntax & Limitations

**Supported:**

- `[[prop]]` — simple property
- `[[user.name]]` — nested property
- `[[contentHtml]]` — raw HTML (props ending with `Html`)

**Not supported:**

- Expressions, method calls, arithmetic, or string methods (e.g., `[[count > 0 ? 'yes' : 'no']]`, `[[items.length]]`, `[[price * 1.1]]`, `[[name.toUpperCase()]]`)

Templates use string interpolation only. Expressions are treated as property paths and return an empty string if not found.

**Workaround:** Use listeners for dynamic behavior:

```js
const toggle = createComponent({
  initialProps: { count: 0 },
  template: `<span class="badge">[[count]]</span>`,
});

toggle.onPropUpdated('count', (count) => {
  // Always re-query elements inside the callback
  const badge = toggle.querySelector('.badge');
  if (badge) badge.style.display = count > 0 ? 'flex' : 'none';
});
```

**Template String Escaping:**
Use `[[prop]]` in template literals to avoid JS interpolation issues.

```js
// Preferred
template: `<div>[[count]]</div>`;
// Legacy (still supported):
// template: `<div>${'${'}count${'}'}</div>`
```

## Raw HTML (XSS Risk)

- Properties ending with `Html` are NOT sanitized.

```js
const card = createComponent({
  initialProps: {
    safeText: '<script>alert(1)</script>', // Sanitized
    iconHtml: '<i data-lucide="user"></i>', // Raw HTML
  },
  template: `
    <div>[[safeText]]</div>
    <div>[[iconHtml]]</div>
  `,
});
```

## Cleanup

- `dispose()` removes listeners and detaches from DOM.
- `onCleanup` can be a function or array of functions.

```js
component.dispose();

const authComponent = createComponent({
  initialProps: { user: null },
  template: `<div>[[user.name]]</div>`,
  onCleanup: () => unsubscribeAuth(),
  parent: document.body,
});

const component = createComponent({
  initialProps: {
    /* ... */
  },
  template: `/* ... */`,
  onCleanup: [
    () => clearInterval(intervalId),
    () => removeEventListener('resize', handler),
    () => websocket.close(),
  ],
  parent: document.body,
});
```

## onMount

- Called once after the first render (after append if `autoAppend` is true).

```js
const comp = createComponent({
  initialProps: { text: 'Hello' },
  template: `<div>[[text]]</div>`,
  parent: document.body,
  onMount: (el) => {
    el.setAttribute('data-mounted', '1');
  },
});
```

## Listeners

- `onPropUpdated(prop, callback)`: React to a specific prop change. Always re-query elements inside the callback.
- `onRender(callback)`: Runs after any prop change and re-render. Use for multiple props or when you need the full props object.
- `onAnyPropUpdated(callback)`: Runs on any prop change, even if not in the template or before re-render. Use for performance-critical or advanced scenarios.

**Rule of thumb:**

- Most cases: `onPropUpdated`
- Multiple props: `onRender`
- Advanced/performance: `onAnyPropUpdated`

```js
toggle.onPropUpdated('count', (count) => {
  const badge = toggle.querySelector('.badge');
  if (badge) badge.textContent = count;
});

card.onRender(({ name, email }) => {
  console.log(`Card updated: ${name} (${email})`);
});

card.onAnyPropUpdated(({ props, changedKeys }) => {
  if (changedKeys.includes('count')) {
    // React immediately, even if 'count' isn't in template
  }
});
```

## Limitations

- Only properties defined in `initialProps` are reactive. Setting or updating new properties later will not make them reactive or trigger listeners/renders.
- The entire container is re-rendered on any prop change that affects the template. For large templates, this may be inefficient.
- All `on*` attributes are stripped from the DOM on every render for security. Only attributes whose values match a key in the `handlers` map get bound as event listeners — inline JS (e.g., `onerror="alert(1)"`) is never executed.
