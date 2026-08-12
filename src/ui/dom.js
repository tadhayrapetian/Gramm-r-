// The smallest DOM helper that makes the screens readable.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** A sentence with ___ in it, rendered with the blank as a visible slot. */
export function sentence(text, blankLabel = '') {
  const parts = String(text).split('___');
  const nodes = [];
  parts.forEach((part, i) => {
    if (part) nodes.push(document.createTextNode(part));
    if (i < parts.length - 1) nodes.push(h('span', { class: 'blank' }, blankLabel));
  });
  return nodes;
}
