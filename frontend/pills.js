// Single-choice pill buttons, used by the filter bar and each tab's controls.

function makePill({ value, label }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pill';
  button.dataset.value = value;
  button.textContent = label;
  return button;
}

/**
 * Turns `container` into a row of pills with one pressed.
 * onChange(value) runs when a different pill is clicked.
 * Returns { value, setOptions(options, selected), select(value), setDisabled(disabled) }.
 */
export function createPills(container, options, value, onChange = () => {}) {
  let current = value;

  const paint = () => {
    for (const pill of container.children) pill.setAttribute('aria-pressed', String(pill.dataset.value === current));
  };

  // Reuses existing pills so keyboard focus survives a re-render.
  const setOptions = (next, selected = current) => {
    current = selected;
    const existing = new Map([...container.children].map((pill) => [pill.dataset.value, pill]));
    const wanted = new Set(next.map((option) => option.value));
    for (const [optionValue, pill] of existing) if (!wanted.has(optionValue)) pill.remove();
    next.forEach((option, i) => {
      const pill = existing.get(option.value) ?? makePill(option);
      pill.textContent = option.label;
      if (container.children[i] !== pill) container.insertBefore(pill, container.children[i] ?? null);
    });
    paint();
  };

  container.addEventListener('click', (event) => {
    const pill = event.target.closest('button.pill');
    if (!pill || pill.disabled || pill.dataset.value === current) return;
    current = pill.dataset.value;
    paint();
    onChange(current);
  });

  setOptions(options, value);
  return {
    get value() { return current; },
    setOptions,
    select(next) { current = next; paint(); },
    setDisabled(disabled) { for (const pill of container.children) pill.disabled = disabled; },
  };
}
