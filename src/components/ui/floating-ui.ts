// Deferred editor focus must not steal focus from an active or closing Radix layer.
export function hasFloatingSurface(state?: 'open'): boolean {
  const selector = ':is([data-slot="popover-content"], [data-slot="dropdown-menu-content"], [data-slot="select-content"])';
  return !!document.querySelector(state ? `${selector}[data-state="${state}"]` : selector);
}
